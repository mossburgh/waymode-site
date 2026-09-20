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
it("records ordinary site inputs while keeping network bodies and passwords private", () => {
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
  expect(
    config.session_recording.maskInputFn(
      "Compact layout",
      document.createElement("textarea"),
    ),
  ).toBe("Compact layout");
  expect(config.session_recording.blockSelector).not.toContain("#trace-panel");
  expect(config.session_recording.recordBody).toBe(false);
  expect(config.session_recording.recordHeaders).toBe(false);
  expect(config.enable_recording_console_log).toBe(true);
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

it("captures console messages with secret redaction", () => {
  const config = analyticsOptions("https://us.i.posthog.com");
  expect(config.logs.captureConsoleLogs).toBe(true);
  const record = config.logs.beforeSend({
    body: 'console: {"apiKey":"hidden-value","message":"Show settings"}',
    attributes: { password: "hidden-value" },
  });
  expect(record.body).toContain("Show settings");
  expect(JSON.stringify(record)).not.toContain("hidden-value");
});

it("preserves PostHog's public routing token while redacting nested credentials", () => {
  const config = analyticsOptions("https://us.i.posthog.com");
  const event = config.before_send({
    event: "waymode_activity",
    properties: {
      token: "phc_public_project_key",
      data: { access_token: "private-value" },
    },
  });
  expect(event.properties.token).toBe("phc_public_project_key");
  expect(event.properties.data.access_token).toBe("[redacted]");
});

it("preserves normal geographic words and the public font configuration in replay", () => {
  expect(redactUrls("Asia and Asian users")).toBe("Asia and Asian users");
  const font = redactUrls(
    "https://fonts.googleapis.com/css2?family=Onest&display=swap&token=secret",
  );
  expect(font).toContain("family=Onest");
  expect(font).not.toContain("secret");
});

it("redacts full credential values and URLs embedded in console text", () => {
  for (const text of [
    "Authorization: Basic dXNlcjpwYXNz",
    "Cookie: a=1; sid=abc",
    '"password": "correct horse battery"',
    "Failed GET https://waymode.ai/cb?code=private-value&state=hidden",
  ]) {
    expect(redactUrls(text)).not.toMatch(
      /dXNlcjpwYXNz|sid=abc|horse|private-value|state=hidden/,
    );
  }
});
