import { analyticsOptions } from "./analytics-policy.js";
import { cleanActivity } from "./activity.js";
import { connectAnalyticsFrames } from "./analytics-frames.js";

const preferenceKey = "waymode-analytics-consent";
let posthog;
let allowed = false;
let config;
let loading;
const preference = () => {
  try {
    return localStorage.getItem(preferenceKey);
  } catch {
    return null;
  }
};
const protectedVisitor = () =>
  navigator.globalPrivacyControl === true || navigator.doNotTrack === "1";
async function enable() {
  if (!config || !allowed || protectedVisitor()) {
    return;
  }
  loading ??= import("posthog-js/full/no-external");
  const { default: sdk } = await loading;
  if (!allowed) {
    return;
  }
  if (!posthog) {
    sdk.init(config.key, analyticsOptions(config.host));
  }
  posthog = sdk;
  sdk.opt_in_capturing({ captureEventName: false });
  if (window === window.top) {
    sdk.startSessionRecording();
  }
}
function choose(value) {
  allowed = value === "yes" && !protectedVisitor();
  try {
    localStorage.setItem(preferenceKey, allowed ? "yes" : "no");
  } catch {
    /* Consent remains in memory. */
  }
  document.querySelector("#analytics-consent").hidden = true;
  if (allowed) {
    void enable().catch(() => {});
  } else {
    posthog?.stopSessionRecording();
    posthog?.opt_out_capturing({ clear_persistence: true });
  }
}
function consentUi() {
  const panel = document.createElement("section");
  panel.id = "analytics-consent";
  panel.setAttribute("aria-label", "Analytics choice");
  panel.setAttribute("data-waymode-ignore", "");
  panel.innerHTML =
    '<p>Allow PostHog to record your interactions, prompt drafts and messages, and Waymode activity to help improve this demo? <a href="/privacy">Privacy details</a></p><div><button data-choice="yes">Allow analytics</button><button data-choice="no">No thanks</button></div>';
  panel.querySelectorAll("button").forEach((button) => {
    button.onclick = () => choose(button.dataset.choice);
  });
  document.body.append(panel);
  const manage = document.createElement("button");
  manage.textContent = "Analytics preferences";
  manage.type = "button";
  manage.setAttribute("data-waymode-ignore", "");
  manage.onclick = () => {
    panel.hidden = false;
    panel.querySelector("button").focus();
  };
  (document.querySelector(".footer > div") ?? document.body).append(manage);
  panel.hidden = preference() !== null || protectedVisitor();
}
async function start() {
  const response = await fetch("/api/v1/analytics-config");
  if (!response.ok) {
    return;
  }
  const value = await response.json();
  if (
    !/^phc_[A-Za-z0-9_-]+$/.test(value.key) ||
    !["https://us.i.posthog.com", "https://eu.i.posthog.com"].includes(
      value.host,
    )
  ) {
    return;
  }
  config = value;
  if (window === window.top) {
    consentUi();
    connectAnalyticsFrames();
  }
  allowed = preference() === "yes" && !protectedVisitor();
  if (allowed) {
    await enable();
  }
}
document.addEventListener("waymode:activity", (event) => {
  if (!allowed || !posthog) {
    return;
  }
  if (
    !event.detail ||
    !["site", "product"].includes(event.detail.surface) ||
    !/^[a-zA-Z._-]{1,60}$/.test(event.detail.kind)
  ) {
    return;
  }
  const payload = cleanActivity(event.detail);
  if (JSON.stringify(payload).length <= 64000) {
    posthog.capture("waymode_activity", payload);
  }
});
window.addEventListener("storage", (event) => {
  if (event.key !== preferenceKey) {
    return;
  }
  allowed = preference() === "yes" && !protectedVisitor();
  if (allowed) {
    void enable().catch(() => {});
  } else {
    posthog?.stopSessionRecording();
    posthog?.opt_out_capturing({ clear_persistence: true });
  }
});
void start().catch(() => {});
