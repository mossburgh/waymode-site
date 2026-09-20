// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { ensureModelAccess } from "./bot-check.js";
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
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

function setupChallenge(render = () => "widget") {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url) =>
      Promise.resolve(
        Response.json(
          url === "/api/v1/session"
            ? {
                verification: {
                  required: true,
                  sitekey: "test",
                  nonce: "test",
                },
              }
            : {},
        ),
      ),
    ),
  );
  const api = { render: vi.fn(render), remove: vi.fn() };
  vi.stubGlobal("turnstile", api);
  return api;
}
async function cancelCheck(promise) {
  document.querySelector("[data-cancel]").click();
  await expect(promise).rejects.toThrow("cancelled");
  expect(document.querySelector("dialog")).toBeNull();
}
it("offers retry if Turnstile cannot render and still permits cancellation", async () => {
  setupChallenge(() => {
    throw new Error("render failed");
  });
  const promise = ensureModelAccess(new AbortController().signal);
  await vi.waitFor(() =>
    expect(document.querySelector("[data-retry]")?.hidden).toBe(false),
  );
  expect(document.querySelector('[role="status"]').textContent).toBe(
    "render failed",
  );
  await cancelCheck(promise);
});
it("stops a silent spinner after 30 seconds and retries the original request", async () => {
  vi.useFakeTimers();
  const api = setupChallenge();
  const promise = ensureModelAccess(new AbortController().signal);
  await vi.advanceTimersByTimeAsync(0);
  const first = api.render.mock.calls[0][1];
  await vi.advanceTimersByTimeAsync(30000);
  expect(api.remove).toHaveBeenCalledWith("widget");
  expect(document.querySelector('[role="status"]').textContent).toContain(
    "took too long",
  );
  expect(document.querySelector("[data-retry]").hidden).toBe(false);
  first.callback("late-token");
  expect(fetch).toHaveBeenCalledTimes(1);
  document.querySelector("[data-retry]").click();
  await vi.advanceTimersByTimeAsync(0);
  expect(api.render).toHaveBeenCalledTimes(2);
  api.render.mock.calls[1][1].callback("fresh-token");
  await expect(promise).resolves.toBeUndefined();
  expect(fetch).toHaveBeenLastCalledWith(
    "/api/v1/verify",
    expect.objectContaining({
      body: JSON.stringify({ token: "fresh-token" }),
    }),
  );
  expect(document.querySelector("dialog")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
it("aborts pending verification when the visitor cancels", async () => {
  const api = setupChallenge();
  const promise = ensureModelAccess(new AbortController().signal);
  await vi.waitFor(() => expect(api.render).toHaveBeenCalledOnce());
  fetch.mockImplementationOnce(
    (_url, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
      }),
  );
  api.render.mock.calls[0][1].callback("pending-token");
  const verificationSignal = fetch.mock.calls[1][1].signal;
  await cancelCheck(promise);
  expect(verificationSignal.aborted).toBe(true);
});
it.each(["expired-callback", "timeout-callback"])(
  "offers a manual retry for %s",
  async (callback) => {
    const api = setupChallenge();
    const promise = ensureModelAccess(new AbortController().signal);
    await vi.waitFor(() => expect(api.render).toHaveBeenCalledOnce());
    api.render.mock.calls[0][1][callback]();
    await vi.waitFor(() =>
      expect(document.querySelector("[data-retry]").hidden).toBe(false),
    );
    expect(api.render).toHaveBeenCalledOnce();
    await cancelCheck(promise);
  },
);
it("does not grant access when server verification rejects the token", async () => {
  const api = setupChallenge();
  const promise = ensureModelAccess(new AbortController().signal);
  await vi.waitFor(() => expect(api.render).toHaveBeenCalledOnce());
  fetch.mockResolvedValueOnce(new Response(null, { status: 403 }));
  api.render.mock.calls[0][1].callback("rejected-token");
  await vi.waitFor(() =>
    expect(document.querySelector("[data-retry]").hidden).toBe(false),
  );
  expect(document.querySelector('[role="status"]').textContent).toContain(
    "failed",
  );
  await cancelCheck(promise);
});
