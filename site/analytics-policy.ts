import type {
  PostHogConfig,
  SessionRecordingOptions,
  CaptureResult,
} from "posthog-js";
import { redactText, secretKey } from "./activity.js";
export const privateAreas =
  "input[type=password],input[type=hidden],input[type=file],.ph-no-capture,[data-analytics-private]";

export function cleanUrl(value: string) {
  try {
    const url = new URL(value, location.origin);
    if (
      url.origin === "https://fonts.googleapis.com" &&
      url.pathname === "/css2"
    ) {
      const params = [...url.searchParams].filter(([key]) =>
        ["family", "display"].includes(key),
      );
      url.search = new URLSearchParams(params).toString();
      return redactText(url.href);
    }
    return url.origin + url.pathname;
  } catch {
    return "";
  }
}

export function redactUrls<T>(value: T): T {
  if (typeof value === "string" && /^https?:\/\//.test(value)) {
    return cleanUrl(value) as T;
  }
  if (typeof value === "string") {
    return redactText(value).replace(/https?:\/\/[^\s<>"']+/g, (url) =>
      cleanUrl(url),
    ) as T;
  }
  if (Array.isArray(value)) {
    return value.map(redactUrls) as T;
  }
  if (!value || typeof value !== "object" || value instanceof Date) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      /^https?:\/\//.test(key) ? cleanUrl(key) : key,
      secretKey.test(key) ? "[redacted]" : redactUrls(item),
    ]),
  ) as T;
}

const recordingOptions = {
  maskAllInputs: true,
  maskTextSelector: "*",
  maskTextFn: redactText,
  maskInputFn: (text, element) =>
    element?.matches("input[type=password],input[type=hidden],input[type=file]")
      ? "*".repeat(text.length)
      : redactText(text),
  blockSelector: privateAreas,
  recordHeaders: false,
  recordBody: false,
  streamNetworkBody: false,
  captureJsonLd: false,
  recordCrossOriginIframes: false,
  captureCanvas: { recordCanvas: false },
  sampleRate: 1,
  maskCapturedNetworkRequestFn: () => null,
  compress_events: false,
  maskAttributeFn: (name, value) =>
    /^(?:authorization|cookie|data-token|data-api-key|value)$/i.test(name)
      ? ""
      : redactUrls(value),
} satisfies SessionRecordingOptions;

export function analyticsOptions(host: string) {
  return {
    api_host: host,
    persistence: "localStorage+cookie",
    opt_out_persistence_by_default: true,
    cookie_expiration: 30,
    cross_subdomain_cookie: false,
    person_profiles: "never",
    ip: false,
    autocapture: {
      dom_event_allowlist: ["click", "change", "submit"],
      css_selector_ignorelist: privateAreas.split(","),
    },
    capture_pageview: window === window.top ? "history_change" : false,
    capture_pageleave: window === window.top,
    disable_session_recording: window !== window.top,
    capture_heatmaps: true,
    rageclick: true,
    capture_dead_clicks: true,
    capture_exceptions: false,
    capture_performance: { web_vitals: true, network_timing: false },
    mask_all_text: false,
    mask_all_element_attributes: false,
    save_referrer: false,
    save_campaign_params: false,
    disable_capture_url_hashes: true,
    disable_surveys: true,
    disable_product_tours: true,
    disable_web_experiments: true,
    logs: {
      captureConsoleLogs: true,
      beforeSend: (record) => redactUrls(record),
    },
    advanced_disable_feature_flags_on_first_load: true,
    enable_recording_console_log: true,
    disable_external_dependency_loading: true,
    session_recording: recordingOptions,
    before_send: redactEvent,
  } satisfies Partial<PostHogConfig>;
}

function redactEvent(event: CaptureResult | null) {
  const token: unknown = event?.properties.token;
  const clean = redactUrls(event);
  // PostHog needs its public project token to route the event.
  if (
    clean &&
    typeof token === "string" &&
    /^phc_[A-Za-z0-9_-]+$/.test(token)
  ) {
    clean.properties.token = token;
  }
  return clean;
}
