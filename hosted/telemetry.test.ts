import { expect, it, vi } from "vitest";
import { logRequest } from "./telemetry.js";
it("logs bounded request fields and can wrap immutable responses", () => {
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const response = logRequest(
    new Request("https://waymode.ai/api/v1/private-person?key=secret", {
      headers: { Cookie: "secret" },
    }),
    Response.redirect("https://waymode.ai/"),
    performance.now(),
  );
  expect(response.headers.get("X-Request-ID")).toMatch(/^[a-f0-9-]{36}$/);
  expect(log.mock.calls[0]?.[0]).toMatchObject({
    route: "unknown",
    status: 302,
  });
  expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  expect(JSON.stringify(log.mock.calls)).not.toContain("private-person");
  log.mockRestore();
});

it("keeps concurrent model usage tied to its own request", async () => {
  const { inRequestScope, logModel } = await import("./telemetry.js");
  const log = vi.spyOn(console, "info").mockImplementation(() => {});
  const run = (id: string) =>
    inRequestScope(
      new Request("https://waymode.ai/api/v1/decisions", {
        headers: { "X-Waymode-Request-ID": id },
      }),
      async () => {
        await Promise.resolve();
        logModel({ elapsedMs: 20, inputTokens: 10 });
      },
    );
  await Promise.all([run("first-request"), run("second-request")]);
  expect(
    log.mock.calls.map(([value]) => (value as { requestId: string }).requestId),
  ).toEqual(["first-request", "second-request"]);
  log.mockRestore();
});
