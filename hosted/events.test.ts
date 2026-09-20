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
it("bounds replay bytes even when a visitor generates large trace entries", async () => {
  const events = new Events();
  const visitor = { id: "large", expires: Date.now() + 3600000 } as Visitor;
  for (let n = 0; n < 100; n++) {
    events.emit(visitor, "large", "x".repeat(60000));
  }
  const reader = events.watch(visitor).body!.getReader();
  await reader.read();
  const first = await reader.read();
  const wire = new TextDecoder().decode(first.value);
  expect(wire).toContain('"id":99');
  await reader.cancel();
});
it("closes slow readers instead of growing their queues without a bound", async () => {
  const events = new Events();
  const visitor = { id: "slow", expires: Date.now() + 3600000 } as Visitor;
  const reader = events.watch(visitor).body!.getReader();
  for (let n = 0; n < 50; n++) {
    events.emit(visitor, "large", "x".repeat(60000));
  }
  let bytes = 0;
  let chunk = await reader.read();
  while (!chunk.done) {
    bytes += chunk.value.byteLength;
    chunk = await reader.read();
  }
  expect(bytes).toBeLessThanOrEqual(512 * 1024);
});
