// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { analyticsOptions, redactUrls } from "./analytics-policy.js";
import { cleanActivity } from "./activity.js";
it("keeps prompt content and runtime evidence while redacting credentials", () => {
  const result = cleanActivity({
    kind: "run",
    data: {
      goal: "Show me dark mode",
      inputTokens: 32,
      Cookie: "secret",
      nested: { apiKey: "secret" },
    },
  });
  expect(result.data.goal).toBe("Show me dark mode");
  expect(result.data.inputTokens).toBe(32);
  expect(JSON.stringify(result)).not.toContain("secret");
  expect(cleanActivity({ goal: "api_key=abcdef" }).goal).toBe(
    "api_key=[redacted]",
  );
});
it("strips URL queries and fragments from events, heatmap keys, and replay metadata", () => {
  const input = {
    $current_url: "https://waymode.ai/?token=secret#secret",
    $snapshot_data: [{ data: { href: "https://waymode.ai/?email=secret" } }],
    heatmap: { "https://waymode.ai/?secret": [1] },
  };
  expect(JSON.stringify(redactUrls(input))).not.toContain("secret");
});
it("records only designated prompt inputs, keeping network bodies and passwords private", () => {
  const config = analyticsOptions("https://us.i.posthog.com");
  const prompt = document.createElement("input");
  prompt.setAttribute("data-analytics-prompt", "");
  const password = document.createElement("input");
  password.type = "password";
  expect(config.session_recording.maskInputFn("Show settings", prompt)).toBe(
    "Show settings",
  );
  expect(config.session_recording.maskInputFn("secret", password)).toBe(
    "******",
  );
  expect(config.session_recording.recordBody).toBe(false);
  expect(config.session_recording.recordHeaders).toBe(false);
  expect(config.enable_recording_console_log).toBe(false);
  expect(config.session_recording.maskCapturedNetworkRequestFn({})).toBeNull();
  expect(config.session_recording.maskAttributeFn("value", "secret")).toBe("");
});

it("preserves event timestamps and masks token fields and partial typed secrets", () => {
  const timestamp = new Date("2026-09-20T12:00:00Z");
  expect(redactUrls({ timestamp }).timestamp).toBe(timestamp);
  expect(JSON.stringify(redactUrls({ timestamp }))).toContain(
    timestamp.toISOString(),
  );
  expect(
    cleanActivity({ access_token: "hidden", authToken: "hidden" }),
  ).toEqual({ access_token: "[redacted]", authToken: "[redacted]" });
  for (const goal of [
    "sk-ab",
    "ghp_12",
    "xoxb-abc",
    "AKIA123",
    "eyJabc.def.ghi",
    "-----BEGIN PRIVATE KEY-----\nsecret",
  ]) {
    expect(cleanActivity({ goal }).goal).toBe("[redacted]");
  }
});
