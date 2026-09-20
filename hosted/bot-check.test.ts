import { DatabaseSync } from "node:sqlite";
import type { SqlStorage } from "@cloudflare/workers-types";
import { afterEach, expect, it, vi } from "vitest";
import { Store } from "./store.js";
import { BotCheck, requireVerification } from "./bot-check.js";
const databases: DatabaseSync[] = [];
afterEach(() => {
  databases.splice(0).forEach((db) => db.close());
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function setup() {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  const sql = {
    exec(query: string, ...args: (string | number)[]) {
      const rows = db.prepare(query).all(...args);
      return { toArray: () => rows };
    },
  } as unknown as SqlStorage;
  const store = new Store(sql);
  const visitor = store.create("network-a");
  const bot = new BotCheck(
    { TURNSTILE_SECRET: "test-secret", TURNSTILE_SITE_KEY: "public" },
    store,
  );
  const config = bot.config(visitor, "network-a");
  return { store, visitor, bot, config };
}
it("binds grants to the session and network and expires them after fifteen minutes", async () => {
  vi.useFakeTimers();
  const { store, visitor, bot, config } = setup();
  expect(() => requireVerification(store, visitor, "network-a")).toThrow(
    "security check",
  );
  const fetcher = vi.fn().mockResolvedValue(
    Response.json({
      success: true,
      hostname: "waymode.ai",
      action: "waymode",
      cdata: config.nonce,
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  await bot.verify(
    visitor,
    "network-a",
    "192.0.2.1",
    { token: "valid" },
    new AbortController().signal,
  );
  expect(fetcher).toHaveBeenCalledOnce();
  expect(() => requireVerification(store, visitor, "network-a")).not.toThrow();
  expect(() => requireVerification(store, visitor, "network-b")).toThrow(
    "security check",
  );
  expect(() =>
    requireVerification(store, store.create("network-a"), "network-a"),
  ).toThrow("security check");
  vi.advanceTimersByTime(15 * 60000);
  expect(() => requireVerification(store, visitor, "network-a")).toThrow(
    "security check",
  );
});
it.each([
  { success: false },
  { hostname: "attacker.example" },
  { action: "elsewhere" },
  { cdata: "other-session" },
])("fails closed for invalid Cloudflare evidence: %j", async (override) => {
  const { store, visitor, bot, config } = setup();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        success: true,
        hostname: "waymode.ai",
        action: "waymode",
        cdata: config.nonce,
        ...override,
      }),
    ),
  );
  await expect(
    bot.verify(
      visitor,
      "network-a",
      null,
      { token: "invalid" },
      new AbortController().signal,
    ),
  ).rejects.toThrow("security check failed");
  expect(() => requireVerification(store, visitor, "network-a")).toThrow(
    "security check",
  );
});
it("rejects wrong-network challenges, missing secrets, and Cloudflare outages", async () => {
  const { store, visitor, bot } = setup();
  const fetcher = vi.fn().mockRejectedValue(new Error("network unavailable"));
  vi.stubGlobal("fetch", fetcher);
  const args = [
    null,
    { token: "token" },
    new AbortController().signal,
  ] as const;
  await expect(bot.verify(visitor, "network-b", ...args)).rejects.toThrow(
    "Reload",
  );
  await expect(
    new BotCheck({}, store).verify(visitor, "network-a", ...args),
  ).rejects.toThrow("Reload");
  expect(fetcher).not.toHaveBeenCalled();
  await expect(bot.verify(visitor, "network-a", ...args)).rejects.toThrow(
    "network unavailable",
  );
  expect(() => requireVerification(store, visitor, "network-a")).toThrow(
    "security check",
  );
});
