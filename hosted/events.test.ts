import { afterEach, expect, it, vi } from "vitest";
import { Events } from "./events.js";
import type { Visitor } from "./store.js";

afterEach(() => vi.useRealTimers());
it("cancels stream timers when an expired visitor is pruned", async () => {
  vi.useFakeTimers();
  const events = new Events();
  const visitor = { id: "visitor", expires: Date.now() + 10 } as Visitor;
  const reader = events.watch(visitor).body!.getReader();
  await reader.read();
  vi.advanceTimersByTime(11);
  events.prune();
  expect(await reader.read()).toEqual({ done: true, value: undefined });
  expect(() => vi.advanceTimersByTime(60000)).not.toThrow();
  expect(vi.getTimerCount()).toBe(0);
});
