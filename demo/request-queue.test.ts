import { expect, it, vi } from "vitest";
import { createRequestQueue } from "./request-queue.js";

const deferred = () => {
  let finish = () => {};
  const promise = new Promise<void>((resolve) => {
    finish = resolve;
  });
  return { promise, finish: () => finish() };
};

it("waits for a watched request to stop before executing the visitor's request", async () => {
  const old = deferred();
  const execute = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(undefined);
  const cancel = vi.fn();
  const submit = createRequestQueue(execute, cancel);
  const watching = submit("Watch theme change", true);
  const visitor = submit("Open settings here");
  expect(cancel).toHaveBeenCalledOnce();
  expect(execute).toHaveBeenCalledTimes(1);
  old.finish();
  await Promise.all([watching, visitor]);
  expect(execute).toHaveBeenNthCalledWith(2, "Open settings here", false);
});

it("runs only the latest visitor request when several arrive during cancellation", async () => {
  const old = deferred();
  const execute = vi
    .fn()
    .mockReturnValueOnce(old.promise)
    .mockResolvedValue(undefined);
  const submit = createRequestQueue(execute, vi.fn());
  const watching = submit("Watch", true);
  const first = submit("Dark mode");
  const latest = submit("Light mode");
  old.finish();
  await Promise.all([watching, first, latest]);
  expect(execute).toHaveBeenCalledTimes(2);
  expect(execute).toHaveBeenLastCalledWith("Light mode", false);
});

it("does not cancel a visitor-owned request or interrupt a run for an empty prompt", async () => {
  const old = deferred();
  const execute = vi.fn().mockReturnValue(old.promise);
  const cancel = vi.fn();
  const submit = createRequestQueue(execute, cancel);
  const visitor = submit("Open settings");
  await submit("   ");
  await submit("Another request");
  expect(cancel).not.toHaveBeenCalled();
  expect(execute).toHaveBeenCalledOnce();
  old.finish();
  await visitor;
});
