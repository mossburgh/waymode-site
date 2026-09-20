// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableCSSFileLoading":true,"disableJavaScriptFileLoading":true,"disableIframePageLoading":true}}
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, expect, it, vi } from "vitest";
import { runSiteRequest } from "./runtime.js";
vi.mock("./analytics.js", () => ({}));
vi.mock("./runtime.js", async (original) => ({
  ...(await original()),
  runSiteRequest: vi.fn(),
}));

beforeAll(async () => {
  const html = readFileSync(resolve("public/index.html"), "utf8");
  const page = document.createElement("template");
  page.innerHTML = html;
  page.content
    .querySelectorAll("script,link,iframe")
    .forEach((el) => el.remove());
  document.body.replaceChildren(page.content);
  history.replaceState(null, "", "/");
  await import("./navbar.js");
});
const bar = () => document.querySelector(".bar-context > span").textContent;
const proof = () =>
  [...document.querySelectorAll("summary")].find(
    (el) => el.textContent === "Where is the proof?",
  );
const hover = (el) =>
  el.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));

it("tracks both disclosure states without moving the pointer", async () => {
  const summary = proof();
  summary.parentElement.open = false;
  hover(summary);
  expect(bar()).toBe("Open “Where is the proof?”");
  summary.parentElement.open = true;
  await vi.waitFor(() => expect(bar()).toBe("Close “Where is the proof?”"));
  summary.parentElement.open = false;
  await vi.waitFor(() => expect(bar()).toBe("Open “Where is the proof?”"));
});
it("refreshes when keyboard focus stays on a changed control", async () => {
  const summary = proof();
  summary.focus();
  summary.parentElement.open = true;
  await vi.waitFor(() => expect(bar()).toBe("Close “Where is the proof?”"));
  expect(document.activeElement).toBe(summary);
});
it("tracks asynchronous copy progress, success, and label reset", async () => {
  const button = document.querySelector("[data-copy-install]");
  const label = button.querySelector("[data-copy-label]");
  hover(button);
  expect(bar()).toBe("Copy install prompt");
  button.disabled = true;
  await vi.waitFor(() => expect(bar()).toBe("Copying install prompt…"));
  label.textContent = "Copied";
  button.disabled = false;
  await vi.waitFor(() => expect(bar()).toBe("Copied install prompt"));
  label.textContent = "Copy prompt";
  await vi.waitFor(() => expect(bar()).toBe("Copy install prompt"));
});
it("closes chat and previews the page control receiving focus", () => {
  document.querySelector('[aria-label="Message Waymode"]').focus();
  expect(document.querySelector(".waymode-conversation").hidden).toBe(false);
  proof().focus();
  expect(document.querySelector(".waymode-conversation").hidden).toBe(true);
  expect(document.querySelector(".bar-context").hidden).toBe(false);
  expect(bar()).toBe("Close “Where is the proof?”");
});
it("keeps a draft when focus moves to a page control", () => {
  const input = document.querySelector('[aria-label="Message Waymode"]');
  input.value = "My unfinished request";
  input.focus();
  proof().focus();
  expect(input.value).toBe("My unfinished request");
  expect(document.querySelector(".bar-context").hidden).toBe(true);
  input.value = "";
});
it("drops a preview when its containing disclosure closes", async () => {
  const summary = proof();
  summary.parentElement.open = true;
  const link = summary.parentElement.querySelector("a");
  hover(link);
  expect(document.querySelector(".bar-context").hidden).toBe(false);
  summary.parentElement.open = false;
  await vi.waitFor(() =>
    expect(document.querySelector(".bar-context").hidden).toBe(true),
  );
});

it("keeps SDK disclosure attributes aligned after later native toggles", async () => {
  const summary = proof();
  summary.setAttribute("role", "button");
  summary.setAttribute("aria-expanded", "false");
  summary.parentElement.open = true;
  await vi.waitFor(() =>
    expect(summary.getAttribute("aria-expanded")).toBe("true"),
  );
  summary.parentElement.open = false;
  await vi.waitFor(() =>
    expect(summary.getAttribute("aria-expanded")).toBe("false"),
  );
});

it("replaces send with Stop and preserves a draft when cancelled", async () => {
  vi.mocked(runSiteRequest).mockImplementationOnce(
    (_goal, { signal }) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("Stopped", "AbortError")),
          { once: true },
        );
      }),
  );
  document
    .querySelector('[data-goal="Show me how to install Waymode"]')
    .click();
  const stop = document.querySelector('[aria-label="Stop Waymode"]');
  expect(stop.textContent).toBe("■");
  expect(stop.disabled).toBe(false);
  const input = document.querySelector('[aria-label="Message Waymode"]');
  input.value = "My next request";
  stop.click();
  await vi.waitFor(() =>
    expect(
      document.querySelector('[aria-label="Send message"]'),
    ).not.toBeNull(),
  );
  expect(document.querySelector(".chat-result").textContent).toBe("Stopped.");
  expect(input.value).toBe("My next request");
  input.value = "";
});
it.each(["completed", "failure"])("restores Send after %s", async (reason) => {
  if (reason === "failure") {
    vi.mocked(runSiteRequest).mockRejectedValueOnce(
      new Error("Gateway unavailable"),
    );
  } else {
    vi.mocked(runSiteRequest).mockResolvedValueOnce({ reason, actions: 0 });
  }
  document
    .querySelector('[data-goal="Show me how to install Waymode"]')
    .click();
  await vi.waitFor(() =>
    expect(
      document.querySelector('[aria-label="Send message"]'),
    ).not.toBeNull(),
  );
  expect(document.querySelector(".tool-outcome").textContent).toBe(
    reason === "failure" ? "Failed" : "Finished",
  );
  expect(document.querySelectorAll(".tool-call")).toHaveLength(1);
});

it("explains the shared limit and leaves Send available", async () => {
  vi.mocked(runSiteRequest).mockRejectedValueOnce(
    new Error(
      "Decision request failed (429). Check the server connection and credential.",
    ),
  );
  document
    .querySelector('[data-goal="Show me how to install Waymode"]')
    .click();
  await vi.waitFor(() =>
    expect(document.querySelector(".tool-outcome").textContent).toBe(
      "Limit reached",
    ),
  );
  expect(document.querySelector(".chat-result").textContent).toContain(
    "Try again later",
  );
  expect(document.querySelector('[aria-label="Send message"]')).not.toBeNull();
});
