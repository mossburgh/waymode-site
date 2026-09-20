import { expect, it, vi, afterEach } from "vitest";
import { readJson } from "./http.js";
afterEach(() => vi.useRealTimers());
it("cancels an oversized body without reading the rest", async () => {
  const cancelled = vi.fn();
  const body = new ReadableStream({
    start(c) {
      c.enqueue(new Uint8Array(17000));
    },
    cancel: cancelled,
  });
  const request = new Request("https://waymode.ai/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
  await expect(readJson(request)).rejects.toMatchObject({ status: 413 });
  expect(cancelled).toHaveBeenCalledOnce();
});
it("ends a body that never finishes", async () => {
  vi.useFakeTimers();
  const cancelled = vi.fn();
  const body = new ReadableStream({ cancel: cancelled });
  const request = new Request("https://waymode.ai/api", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
  const result = readJson(request).catch((error: unknown) => error);
  await vi.advanceTimersByTimeAsync(10001);
  expect(await result).toMatchObject({ status: 408 });
  expect(cancelled).toHaveBeenCalledOnce();
});
