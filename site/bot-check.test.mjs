// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { ensureModelAccess } from "./bot-check.js";
afterEach(() => vi.unstubAllGlobals());
it("does not cancel another caller's shared check", async () => {
  let release;
  const fetcher = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  vi.stubGlobal("fetch", fetcher);
  const first = new AbortController();
  const second = new AbortController();
  const a = ensureModelAccess(first.signal);
  const b = ensureModelAccess(second.signal);
  first.abort();
  await expect(a).rejects.toThrow();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(false);
  release(Response.json({ verification: { required: false } }));
  await expect(b).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledOnce();
});
it("cancels a check when its last caller stops and permits retry", async () => {
  const fetcher = vi.fn(
    (_url, { signal }) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(signal.reason)),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  const first = new AbortController();
  const promise = ensureModelAccess(first.signal);
  first.abort();
  await expect(promise).rejects.toThrow();
  expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
  fetcher.mockResolvedValue(
    Response.json({ verification: { required: false } }),
  );
  await expect(
    ensureModelAccess(new AbortController().signal),
  ).resolves.toBeUndefined();
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("removes the modal if Turnstile cannot render", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        verification: { required: true, sitekey: "test", nonce: "test" },
      }),
    ),
  );
  vi.stubGlobal("turnstile", {
    render: () => {
      throw new Error("render failed");
    },
    remove: vi.fn(),
  });
  await expect(ensureModelAccess(new AbortController().signal)).rejects.toThrow(
    "render failed",
  );
  expect(document.querySelector("dialog")).toBeNull();
});
