import { cursorPause } from "./cursor-pause.js";
/// <reference types="vite/client" />

import "./style.css";
import {
  createWaymode,
  createHttpDecider,
  embedView,
} from "@mossburgh/waymode";
import type { Control, Decision } from "@mossburgh/waymode";
import { mountFeature } from "./feature.js";

const element = <T extends HTMLElement>(id: string): T => {
  const found = document.getElementById(id);
  if (!found) {
    throw new Error(`Missing demo element: ${id}`);
  }
  return found as T;
};

const app = element("live-app");
const appContent = element("app-content");
const conversation = element("conversation");
const cursor = element("agent-cursor");
const prompt = element<HTMLTextAreaElement>("prompt");
const sendButton = element<HTMLButtonElement>("send-button");
const stopButton = element<HTMLButtonElement>("stop-button");
const runStatus = element("run-status");
const embedButton = element<HTMLButtonElement>("embed-button");
let feature = mountFeature;
let settingsOpen = false;
let restoreView: (() => void) | undefined;
let embeddedOutlet: HTMLElement | undefined;
let running: AbortController | undefined;
let callCount = 0;
let knownCost = 0;
let missingCosts = 0;
let hasEstimate = false;

element("authenticator-note").hidden =
  new URLSearchParams(location.search).get("record") !== "1";

const renderAccountBody = (): void => {
  if (settingsOpen) {
    const featureContainer = document.createElement("div");
    featureContainer.className = "feature-container";
    appContent.append(featureContainer);
    feature(featureContainer);
    return;
  }
  const detail = document.createElement("div");
  detail.className = "account-detail";
  detail.innerHTML =
    '<span class="avatar" aria-hidden="true">Y</span><div><strong>Your demo account</strong><span>Local development</span></div>';
  appContent.append(detail);
};

const renderApp = (): void => {
  appContent.replaceChildren();
  const heading = document.createElement("h2");
  heading.textContent = settingsOpen ? "Settings" : "Your account";
  const copy = document.createElement("p");
  copy.className = "app-copy";
  copy.textContent = settingsOpen
    ? "Manage your account preferences."
    : "A small app. Room for something new.";
  const navigation = document.createElement("button");
  navigation.type = "button";
  navigation.className = "secondary-button";
  navigation.textContent = settingsOpen ? "Back to account" : "Settings";
  navigation.addEventListener("click", () => {
    settingsOpen = !settingsOpen;
    renderApp();
  });
  appContent.append(heading, copy);
  renderAccountBody();
  appContent.append(navigation);
};

embedButton.addEventListener("click", () => {
  if (restoreView) {
    restoreView();
    restoreView = undefined;
    embeddedOutlet?.remove();
    embeddedOutlet = undefined;
    embedButton.textContent = "Embed in chat";
    element("view-location").textContent = "In workspace";
  } else {
    embeddedOutlet = document.createElement("div");
    embeddedOutlet.className = "embedded-outlet";
    conversation.append(embeddedOutlet);
    restoreView = embedView(app, embeddedOutlet);
    embedButton.textContent = "Return to workspace";
    element("view-location").textContent = "In conversation";
    conversation.scrollTop = conversation.scrollHeight;
  }
  element("app-slot").classList.toggle("is-empty", Boolean(restoreView));
});

const message = (text: string, kind: "user" | "agent" | "error"): void => {
  element("intro").hidden = true;
  const item = document.createElement("div");
  item.className = `message message-${kind}`;
  const author = document.createElement("span");
  author.className = "message-author";
  author.textContent = kind === "user" ? "You" : "Model";
  const body = document.createElement("p");
  body.textContent = text;
  item.append(author, body);
  conversation.append(item);
  conversation.scrollTop = conversation.scrollHeight;
};

const money = (value: number): string => `$${value.toFixed(6)}`;

const appendReceipt = (decision: Decision, cost: string): void => {
  const list = element("receipts-list");
  list.querySelector(".receipt-empty")?.remove();
  const row = document.createElement("div");
  row.className = "receipt";
  const title = document.createElement("strong");
  title.textContent = `Model · ${decision.outcome === "selected" ? "Control selected" : "No action selected"}`;
  const details = document.createElement("span");
  details.textContent = `${Math.round(decision.elapsedMs)} ms · ${decision.inputTokens === undefined ? "? " : `${decision.inputTokens} `}in / ${decision.outputTokens === undefined ? "?" : decision.outputTokens} out · ${cost}`;
  row.title = `Model: ${decision.model}. Cost source: ${decision.costSource}. Missing token counts appear as ?.`;
  row.append(title, details);
  list.prepend(row);
};

const updateUsage = (cost: string): void => {
  element("last-cost").textContent = cost;
  element("total-cost").textContent =
    missingCosts === callCount
      ? "Unavailable"
      : `${money(knownCost)}${hasEstimate ? " est." : ""}${missingCosts ? " + unknown" : ""}`;
  element("call-count").textContent =
    `${callCount} ${callCount === 1 ? "call" : "calls"}`;
};

const recordMissingDecision = (): void => {
  callCount += 1;
  missingCosts += 1;
  updateUsage("Unavailable");
  const list = element("receipts-list");
  list.querySelector(".receipt-empty")?.remove();
  const row = document.createElement("div");
  row.className = "receipt";
  const title = document.createElement("strong");
  title.textContent = "Model · Request ended without a receipt";
  const details = document.createElement("span");
  details.textContent = "Usage and cost unavailable";
  row.append(title, details);
  list.prepend(row);
};

const recordDecision = (decision: Decision): void => {
  callCount += 1;
  const costAvailable =
    decision.costSource !== "unavailable" && decision.costUsd !== undefined;
  let cost = "Unavailable";
  if (costAvailable && decision.costUsd !== undefined) {
    knownCost += decision.costUsd;
    cost = `${money(decision.costUsd)}${decision.costSource === "estimated" ? " est." : ""}`;
  } else {
    missingCosts += 1;
  }
  hasEstimate ||= decision.costSource === "estimated";
  updateUsage(cost);
  appendReceipt(decision, cost);
};

const pointAt = async (
  control: Control,
  signal: AbortSignal,
  target: HTMLElement,
): Promise<void> => {
  signal.throwIfAborted();
  target.scrollIntoView({ block: "nearest", inline: "nearest" });
  const bounds = target.getBoundingClientRect();
  cursor.style.left = `${bounds.left + bounds.width / 2}px`;
  cursor.style.top = `${bounds.top + bounds.height / 2}px`;
  cursor.hidden = false;
  target.classList.add("agent-target");
  runStatus.textContent = `Using ${control.name || control.role}`;
  try {
    await cursorPause(signal);
    signal.throwIfAborted();
  } finally {
    target.classList.remove("agent-target");
    cursor.hidden = true;
  }
};

const httpDecide = createHttpDecider("/api/v1/decisions");
const agent = createWaymode({
  root: () => app,
  decide: async (request, signal) => {
    try {
      return await httpDecide(request, signal);
    } catch (error) {
      recordMissingDecision();
      throw error;
    }
  },
  beforeAction: pointAt,
});

const runReasons: Record<string, string> = {
  abstained: "No further action selected.",
  limit: "Reached the action limit. Send another request to continue.",
  cancelled: "Stopped.",
  stale: "The app changed before the action. Try again.",
};

const resetComposer = (): void => {
  running = undefined;
  sendButton.disabled = false;
  stopButton.hidden = true;
  cursor.hidden = true;
  runStatus.textContent = "Ready to use the app";
  prompt.focus();
};

const reportRunError = (error: unknown, signal: AbortSignal): void => {
  if (signal.aborted) {
    message("Stopped.", "agent");
    return;
  }
  message(
    error instanceof Error
      ? error.message
      : "The request failed. Check the local server.",
    "error",
  );
};

element<HTMLFormElement>("prompt-form").addEventListener("submit", (event) => {
  void submitPrompt(event);
});
const submitPrompt = async (event: Event) => {
  event.preventDefault();
  const goal = prompt.value.trim();
  if (!goal || running) {
    return;
  }
  const controller = new AbortController();
  running = controller;
  message(goal, "user");
  prompt.value = "";
  sendButton.disabled = true;
  stopButton.hidden = false;
  runStatus.textContent = "Model is reading the app…";
  try {
    const result = await agent.run(goal, {
      signal: controller.signal,
      onDecision: recordDecision,
      onAction: (control) => {
        message(`Used “${control.name || control.role}”.`, "agent");
      },
    });
    message(
      runReasons[result.reason] ?? `Run ended: ${result.reason}.`,
      "agent",
    );
  } catch (error) {
    reportRunError(error, controller.signal);
  } finally {
    resetComposer();
  }
};

stopButton.addEventListener("click", () => running?.abort());
prompt.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    element<HTMLFormElement>("prompt-form").requestSubmit();
  }
});

const source = new EventSource("/api/v1/source?app=account");

const savedTime = (value: unknown): string => {
  const changedAt =
    typeof value === "number" ? new Date(value) : new Date(String(value));
  if (Number.isNaN(changedAt.valueOf())) {
    return "Source loaded";
  }
  return `Saved ${changedAt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
};

source.addEventListener("message", (event: MessageEvent<string>) => {
  try {
    const update: unknown = JSON.parse(event.data);
    if (
      !update ||
      typeof update !== "object" ||
      !("source" in update) ||
      typeof update.source !== "string" ||
      !("path" in update) ||
      typeof update.path !== "string"
    ) {
      return;
    }
    element("source-code").textContent = update.source;
    element("source-path").textContent = update.path;
    element("source-time").textContent = savedTime(
      "changedAt" in update ? update.changedAt : undefined,
    );
    element("source-state").textContent = "Watching source";
    element("source-note").textContent = "Waiting for source edits";
    element("connection-dot").classList.add("connected");
  } catch {
    element("source-note").textContent = "Could not read the source update.";
  }
});
source.addEventListener("error", () => {
  element("source-state").textContent = "Reconnecting";
  element("source-note").textContent = "Source connection lost. Retrying…";
  element("connection-dot").classList.remove("connected");
});

if (import.meta.hot) {
  import.meta.hot.accept("./feature.js", (module) => {
    const updated = module as typeof import("./feature.js") | undefined;
    if (updated) {
      feature = updated.mountFeature;
      renderApp();
    }
  });
  import.meta.hot.dispose(() => {
    source.close();
    running?.abort();
  });
}

renderApp();
