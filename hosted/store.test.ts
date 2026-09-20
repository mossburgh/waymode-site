import { DatabaseSync } from "node:sqlite";
import type { SqlStorage } from "@cloudflare/workers-types";
import { it, expect, beforeEach, afterEach, vi } from "vitest";
import { Store } from "./store.js";
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());
const database = () => {
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec: (query: string, ...args: (string | number)[]) => ({
      toArray: () => db.prepare(query).all(...args),
    }),
  };
  // Cloudflare executes immediately; SQLite is the real storage engine in both environments.
  const storage = {
    exec: (query: string, ...args: (string | number)[]) => {
      const rows = sql.exec(query, ...args).toArray();
      return { toArray: () => rows };
    },
  } as unknown as SqlStorage;
  return { storage, close: () => db.close() };
};
it("keeps state and call reservations across store recreation", () => {
  const db = database();
  const store = new Store(db.storage);
  const visitor = store.create("ip-a");
  visitor.app.preferences.dark = true;
  store.save(visitor);
  for (let n = 0; n < 60; n++) {
    store.model(visitor, "ip-a");
    vi.advanceTimersByTime(31000);
  }
  const restarted = new Store(db.storage);
  expect(
    restarted.visitor(`__Host-waymode_session=${visitor.id}`)?.app.preferences
      .dark,
  ).toBe(true);
  expect(() => restarted.model(visitor, "ip-a")).toThrow("limit");
  expect(restarted.create("ip-b").app.preferences.dark).toBe(false);
  expect(
    restarted.visitor(
      "__Host-waymode_session=00000000-0000-0000-0000-000000000000",
    ),
  ).toBeUndefined();
  db.close();
});
it("does not let a rejected session drain the shared model quota", () => {
  const db = database();
  const store = new Store(db.storage);
  const visitor = store.create("ip-a");
  for (let n = 0; n < 60; n++) {
    store.model(visitor, "ip-a");
    vi.advanceTimersByTime(31000);
  }
  for (let n = 0; n < 700; n++) {
    expect(() => store.model(visitor, "ip-a")).toThrow("limit");
  }
  const other = store.create("ip-b");
  expect(() => store.model(other, "ip-b")).not.toThrow();
  db.close();
});
it("stops fresh sessions from bypassing the site-wide model quota", () => {
  const db = database();
  const store = new Store(db.storage);
  for (let n = 0; n < 10; n++) {
    const visitor = store.create(`ip-${n}`);
    for (let call = 0; call < 60; call++) {
      store.model(visitor, `ip-${n}`);
      vi.advanceTimersByTime(31000);
    }
  }
  const fresh = store.create("ip-new");
  expect(() => store.model(fresh, "ip-new")).toThrow("limit");
  db.close();
});
it("limits fast calls without charging rejected attempts to the daily allowance", () => {
  const db = database();
  const store = new Store(db.storage);
  const visitor = store.create("ip-burst");
  for (let n = 0; n < 12; n++) {
    store.model(visitor, "ip-burst");
  }
  expect(() => store.model(visitor, "ip-burst")).toThrow("limit");
  vi.advanceTimersByTime(60001);
  expect(() => store.model(visitor, "ip-burst")).not.toThrow();
  db.close();
});

it("keeps the network secret across restarts and rotates it daily", () => {
  const db = database();
  const first = new Store(db.storage).networkSecret();
  expect(new Store(db.storage).networkSecret()).toBe(first);
  vi.advanceTimersByTime(86400000);
  expect(new Store(db.storage).networkSecret()).not.toBe(first);
  db.close();
});
