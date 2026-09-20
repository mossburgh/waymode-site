import { expect, it, vi } from "vitest";
import { retryModel } from "./model-retry.js";
const failure = () =>
  Object.assign(new Error("upstream"), { name: "GatewayInternalServerError" });
it("retries one transient provider failure through the full attempt", async () => {
  const run = vi
    .fn()
    .mockRejectedValueOnce(failure())
    .mockResolvedValue("done");
  await expect(retryModel(run, new AbortController().signal)).resolves.toBe(
    "done",
  );
  expect(run).toHaveBeenCalledTimes(2);
});
it("bounds failures and returns a service status instead of a client error", async () => {
  const run = vi.fn().mockRejectedValue(failure());
  await expect(
    retryModel(run, new AbortController().signal),
  ).rejects.toMatchObject({ status: 503 });
  expect(run).toHaveBeenCalledTimes(2);
});
it("does not retry quotas, validation, or stopped requests", async () => {
  const run = vi.fn().mockRejectedValue(new Error("quota"));
  await expect(retryModel(run, new AbortController().signal)).rejects.toThrow(
    "quota",
  );
  expect(run).toHaveBeenCalledOnce();
  run.mockClear();
  const stop = new AbortController();
  stop.abort();
  await expect(retryModel(run, stop.signal)).rejects.toThrow();
  expect(run).not.toHaveBeenCalled();
});

it("does not retry gateway billing or authorization rejections disguised as internal errors", async () => {
  const error = Object.assign(new Error("billing unavailable"), {
    name: "GatewayInternalServerError",
    statusCode: 403,
  });
  const run = vi.fn().mockRejectedValue(error);
  await expect(
    retryModel(run, new AbortController().signal),
  ).rejects.toMatchObject({ status: 503 });
  expect(run).toHaveBeenCalledOnce();
});
