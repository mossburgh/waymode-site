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
function consentState() {
  const panel = document.querySelector("#analytics-consent");
  if (panel) {
    panel.dataset.preference = protectedVisitor()
      ? "blocked"
      : (preference() ?? "unset");
  }
}
function clearStoredAnalytics() {
  if (!config) {
    return;
  }
  const key = `ph_${config.key}_posthog`;
  try {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
    document.cookie = `${key}=; Max-Age=0; Path=/; Secure; SameSite=Lax`;
  } catch {
    /* Storage may be disabled. */
  }
}
function disable() {
  posthog?.stopSessionRecording();
  posthog?.opt_out_capturing();
  clearStoredAnalytics();
}
function choose(value) {
  allowed = value === "yes" && !protectedVisitor();
  try {
    localStorage.setItem(preferenceKey, allowed ? "yes" : "no");
  } catch {
    /* Consent remains in memory. */
  }
  consentState();
  document.querySelector("#analytics-consent").hidden = true;
  if (allowed) {
    void enable().catch(() => {});
  } else {
    disable();
  }
}
function consentUi() {
  const panel = document.querySelector("#analytics-consent");
  const manage = document.querySelector("#analytics-preferences");
  manage.hidden = false;
  const show = (visible) => {
    panel.hidden = !visible;
    manage.setAttribute("aria-expanded", String(visible));
  };
  panel.querySelectorAll("button").forEach((button) => {
    button.onclick = () => {
      choose(button.dataset.choice);
      show(false);
    };
  });
  manage.onclick = () => {
    show(true);
    panel.querySelector("button").focus();
  };
  show(preference() === null && !protectedVisitor());
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
  consentState();
  if (window === window.top) {
    consentUi();
    connectAnalyticsFrames();
  }
  allowed = preference() === "yes" && !protectedVisitor();
  if (allowed) {
    await enable();
  } else {
    disable();
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
  consentState();
  if (allowed) {
    void enable().catch(() => {});
  } else {
    disable();
  }
});
void start().catch(() => {});
