// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { awaitAppResult } from "./studio-result.js";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});
const fixture = () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const controller = new AbortController();
  const send = (data: unknown, source = frame.contentWindow) =>
    window.dispatchEvent(
      new MessageEvent("message", { origin: location.origin, source, data }),
    );
  return { frame, controller, send };
};
it("ignores a result from another frame and requires saved-state verification", async () => {
  const { frame, controller, send } = fixture();
  const promise = awaitAppResult(frame, controller.signal);
  send({ type: "waymode:result", reason: "completed", verified: true }, window);
  send({ type: "waymode:result", reason: "completed", verified: false });
  await expect(promise).rejects.toThrow("did not verify completion");
});
it("accepts only a completed and verified result from the live app", async () => {
  const { frame, controller, send } = fixture();
  const promise = awaitAppResult(frame, controller.signal);
  send({ type: "waymode:result", reason: "completed", verified: true });
  await expect(promise).resolves.toBeUndefined();
});
it("stops waiting on takeover without treating a late result as completion", async () => {
  const { frame, controller, send } = fixture();
  const promise = awaitAppResult(frame, controller.signal);
  controller.abort();
  send({ type: "waymode:result", reason: "completed", verified: true });
  await expect(promise).rejects.toThrow("interrupted");
});
it("times out instead of advancing a story with missing proof", async () => {
  vi.useFakeTimers();
  const { frame, controller } = fixture();
  const result = awaitAppResult(frame, controller.signal);
  await Promise.all([
    expect(result).rejects.toThrow("timed out"),
    vi.advanceTimersByTimeAsync(30_000),
  ]);
});

it("keeps a watched scene waiting through a long pause", async () => {
  vi.useFakeTimers();
  const { frame, controller, send } = fixture();
  const done = vi.fn();
  const result = awaitAppResult(frame, controller.signal, 0).then(done);
  await vi.advanceTimersByTimeAsync(60000);
  expect(done).not.toHaveBeenCalled();
  send({ type: "waymode:result", reason: "completed", verified: true });
  await result;
  expect(done).toHaveBeenCalledOnce();
});
