import { DatabaseSync } from "node:sqlite";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { afterEach, expect, it } from "vitest";
import worker, { Showcase } from "./worker.js";

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function app() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  const ctx = {
    storage: {
      sql: {
        exec(query: string, ...args: (string | number)[]) {
          const rows = db.prepare(query).all(...args);
          return { toArray: () => rows };
        },
      },
      setAlarm: async () => {},
    },
    waitUntil: () => {},
  } as unknown as DurableObjectState;
  return new Showcase(ctx, { AI_GATEWAY_API_KEY: "", WAYMODE_MODEL: "" });
}
const request = (path: string, cookie = "", body?: unknown) =>
  new Request(`https://waymode.ai/api/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
async function session(site: Showcase) {
  const response = await site.fetch(request("session"));
  const setCookie = response.headers.get("set-cookie")!;
  return {
    cookie: setCookie.split(";")[0]!,
    setCookie,
    body: (await response.json()) as { traceChannel: string },
  };
}
it("keeps the bearer credential out of the stable public trace label", async () => {
  const site = app();
  const first = await session(site);
  const token = first.cookie.split("=")[1]!;
  expect(first.setCookie).toContain("HttpOnly; Secure; SameSite=Strict");
  expect(JSON.stringify(first.body)).not.toContain(token);
  expect(first.body.traceChannel).toMatch(/^daylist-[a-f0-9]{64}$/);
  const repeat = await site.fetch(request("session", first.cookie));
  expect(await repeat.json()).toEqual(first.body);
  expect((await session(site)).body.traceChannel).not.toBe(
    first.body.traceChannel,
  );
  const forged = await site.fetch(
    request("daylist", `waymode_session=${first.body.traceChannel.slice(8)}`),
  );
  expect(forged.status).toBe(401);
});
it("isolates visitor state, action handles, and trace streams", async () => {
  const site = app();
  const a = await session(site);
  const b = await session(site);
  const patch = request("daylist", a.cookie, { preferences: { dark: true } });
  await site.fetch(new Request(patch, { method: "PATCH" }));
  const other = await site.fetch(request("daylist", b.cookie));
  expect(await other.json()).toMatchObject({ preferences: { dark: false } });
  const started = await site.fetch(
    request("actions/start", a.cookie, { goal: "Turn on dark mode" }),
  );
  const handle = (await started.json()) as { session: string };
  const stolen = await site.fetch(
    request("actions", b.cookie, { ...handle, operation: "observe" }),
  );
  expect(stolen.status).toBe(409);
  const trace = await site.fetch(request("trace", b.cookie));
  const reader = trace.body!.getReader();
  const initial = await reader.read();
  expect(new TextDecoder().decode(initial.value)).toBe(": connected\n\n");
  const ownEvent = await reader.read();
  const wire = new TextDecoder().decode(ownEvent.value);
  expect(wire).not.toContain('"dark":true');
  expect(wire).not.toContain(a.cookie.split("=")[1]!);
  await reader.cancel();
});
it("rejects missing sessions and oversized JSON without exposing internals", async () => {
  const site = app();
  expect((await site.fetch(request("daylist"))).status).toBe(401);
  const visitor = await session(site);
  const response = await site.fetch(
    request("decisions", visitor.cookie, { goal: "x".repeat(17000) }),
  );
  expect(response.status).toBe(413);
  expect(await response.json()).toEqual({ error: "Request is too large." });
  const invalid = await site.fetch(
    request("presentation", visitor.cookie, { goal: 12 }),
  );
  expect(await invalid.json()).toEqual({
    error: "The request could not be completed.",
  });
});
it("rejects foreign origins and mutations without Origin before reaching the app", async () => {
  const env = {
    AI_GATEWAY_API_KEY: "",
    WAYMODE_MODEL: "",
    SHOWCASE: {
      getByName() {
        throw new Error("Must not reach the app");
      },
    },
  };
  for (const init of [
    { method: "POST" },
    { method: "POST", headers: { Origin: "https://other.example" } },
    { method: "GET", headers: { Origin: "https://other.example" } },
  ]) {
    const response = await worker.fetch(
      new Request("https://waymode.ai/api/v1/decisions", init),
      env,
    );
    expect(response.status).toBe(403);
  }
});
