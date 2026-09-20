// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { beforeEach, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  init: vi.fn(),
  capture: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
}));
vi.mock("posthog-js/full/no-external", () => ({ default: sdk }));
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
  document.body.innerHTML = new DOMParser().parseFromString(
    readFileSync("public/index.html", "utf8"),
    "text/html",
  ).body.innerHTML;
});
const activity = () =>
  document.dispatchEvent(
    new CustomEvent("waymode:activity", {
      detail: { surface: "site", kind: "run", data: { goal: "Open settings" } },
    }),
  );
it("does not load or capture when no PostHog project is configured", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ enabled: false })),
  );
  await import("./analytics.js");
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  activity();
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.capture).not.toHaveBeenCalled();
  expect(document.querySelector("#analytics-consent").hidden).toBe(true);
});
it("requires consent, captures runtime details, stops on withdrawal, and allows re-enabling", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        key: "phc_test_public_project_key",
        host: "https://us.i.posthog.com",
      }),
    ),
  );
  await import("./analytics.js");
  await vi.waitFor(() =>
    expect(document.querySelector("#analytics-preferences").hidden).toBe(false),
  );
  activity();
  expect(sdk.init).not.toHaveBeenCalled();
  document.querySelector('[data-choice="yes"]').click();
  await vi.waitFor(() =>
    expect(sdk.startSessionRecording).toHaveBeenCalledOnce(),
  );
  activity();
  expect(sdk.capture).toHaveBeenCalledWith("waymode_activity", {
    surface: "site",
    kind: "run",
    data: { goal: "Open settings" },
  });
  document.querySelector('[data-choice="no"]').click();
  expect(sdk.stopSessionRecording).toHaveBeenCalledOnce();
  sdk.capture.mockClear();
  activity();
  expect(sdk.capture).not.toHaveBeenCalled();
  document.querySelector('[data-choice="yes"]').click();
  await vi.waitFor(() =>
    expect(sdk.startSessionRecording).toHaveBeenCalledTimes(2),
  );
  expect(sdk.init).toHaveBeenCalledOnce();
  document.querySelector('[data-choice="no"]').click();
});

it("honors GPC even when an old consent choice says yes", async () => {
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    value: true,
  });
  localStorage.setItem("waymode-analytics-consent", "yes");
  localStorage.setItem(
    "ph_phc_test_public_project_key_posthog",
    "old identifier",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      Response.json({
        key: "phc_test_public_project_key",
        host: "https://us.i.posthog.com",
      }),
    ),
  );
  await import("./analytics.js");
  await vi.waitFor(() =>
    expect(document.querySelector("#analytics-preferences").hidden).toBe(false),
  );
  activity();
  expect(sdk.init).not.toHaveBeenCalled();
  expect(sdk.capture).not.toHaveBeenCalled();
  Object.defineProperty(navigator, "globalPrivacyControl", {
    configurable: true,
    value: false,
  });
});
