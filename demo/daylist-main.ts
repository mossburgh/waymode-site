import { playbackCheckpoint } from "./playback-checkpoint.js";
import { createRequestQueue } from "./request-queue.js";
import { connectProductTrace } from "./product-trace.js";
import { appendChatResult } from "./chat-result.js";
import { createPanelSurface } from "./panel-surface.js";
import { reportFrameSize } from "./frame-size.js";
import { requestMode } from "./request-mode.js";
import { connectShowcase } from "./showcase-frame.js";
const mountedAt = Date.now();
import { prepareLaunch, announceLaunch } from "./launch/seed.js";
/// <reference types="vite/client" />
import "./daylist.css";
import {
  createBrowserSurface,
  createHttpSurface,
  createHttpDecider,
  createCursorGuide,
} from "@mossburgh/waymode";
import { createWaymode, combineSurfaces } from "@mossburgh/waymode/core";
import type { Decision } from "@mossburgh/waymode";
import { createDaylist, readState } from "./daylist-app.js";
import { mountFeature } from "./daylist-feature.js";

const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
if (new URLSearchParams(location.search).has("showcase")) {
  document.body.classList.add("showcase-product");
}
const sessionResponse = await fetch("/api/v1/session");
if (!sessionResponse.ok) {
  throw new Error("Could not start the local demo session.");
}
const session = (await sessionResponse.json()) as { traceChannel: string };
const channel = new BroadcastChannel(session.traceChannel);
const history: unknown[] = [];
const clientId = crypto.randomUUID();
let sequence = 0;
const emit = (kind: string, data: unknown) => {
  const event = { id: `${clientId}-${++sequence}`, at: Date.now(), kind, data };
  history.push(event);
  if (history.length > 100) {
    history.shift();
  }
  channel.postMessage(event);
};
channel.onmessage = (event: MessageEvent<unknown>) => {
  if (event.data === "history") {
    channel.postMessage({ history });
  }
};
await prepareLaunch();
const app = await createDaylist(get("daylist"), mountFeature);
await connectShowcase(app);
const guide = createCursorGuide(get("agent-cursor"));
const http = createHttpDecider("/api/v1/decisions");
let running: AbortController | undefined;
let scriptedRequest = false;
const checkpoint = (signal: AbortSignal, stage?: string) =>
  scriptedRequest ? playbackCheckpoint(signal, stage) : Promise.resolve();
let total = 0;
let unknownCosts = 0;
let estimated = false;
const decisions: Decision[] = [];
const recordCost = (decision?: Pick<Decision, "costUsd" | "costSource">) => {
  if (
    decision?.costUsd === undefined ||
    decision.costSource === "unavailable"
  ) {
    unknownCosts++;
  } else {
    total += decision.costUsd;
    estimated ||= decision.costSource === "estimated";
  }
  get("cost").textContent =
    `$${total.toFixed(6)}${estimated ? " est." : ""}${unknownCosts ? " + unknown" : ""} session`;
};
let costStream = "";
let costSequence = 0;
const disconnectCost = connectProductTrace((json) => {
  const event = JSON.parse(json) as {
    stream: string;
    id: number;
    kind: string;
    at: number;
    data: Pick<Decision, "costUsd" | "costSource" | "model">;
  };
  if (event.at < mountedAt) {
    return;
  }
  if (event.stream !== costStream) {
    costStream = event.stream;
    costSequence = 0;
  }
  if (event.id <= costSequence) {
    return;
  }
  costSequence = event.id;
  if (event.kind === "model.receipt") {
    recordCost(event.data);
  }
  if (event.kind === "model.error") {
    recordCost();
  }
});
window.addEventListener("pagehide", disconnectCost, { once: true });
import.meta.hot?.dispose(disconnectCost);
const browserSurfaceFor = (guided: boolean) =>
  createBrowserSurface({
    root: app.surface,
    beforeAction: async (control, signal, target) => {
      signal.throwIfAborted();
      get("status").textContent = `Using ${control.name}…`;
      if (guided) {
        await guide(control, signal, target);
        await checkpoint(signal);
      }
    },
  });
const serverSurface = async (goal: string, signal: AbortSignal) => {
  const response = await fetch("/api/v1/actions/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
    signal,
  });
  if (!response.ok) {
    throw new Error("Could not start server actions.");
  }
  const session = (await response.json()) as { session: string };
  const remote = createHttpSurface("/api/v1/actions", session.session);
  const server = {
    ...remote,
    invoke: async (...arguments_: Parameters<typeof remote.invoke>) => {
      const receipt = await remote.invoke(...arguments_);
      await checkpoint(arguments_[2]);
      await app.refresh();
      return receipt;
    },
  };
  return server;
};
let revealPanel: (() => void) | undefined;
const panelsForChat = () =>
  createPanelSurface([
    {
      name: "Settings",
      isOpen: app.isSettingsInChatVisible,
      open: () => {
        app.openSettingsInChat(get("chat-view"));
        revealPanel = app.revealSettingsInChat;
      },
    },
  ]);
const decideWithPlayback: typeof http = async (request, signal) => {
  emit("controls", request);
  try {
    const decision = await http(request, signal);
    await checkpoint(signal);
    return decision;
  } catch (error) {
    recordCost();
    throw error;
  }
};
const agentFor = async (goal: string, signal: AbortSignal) => {
  const mode = await requestMode(goal, signal);
  const guided = mode === "guide";
  emit("presentation", { mode });
  const browserSurface = browserSurfaceFor(guided);
  let surface = browserSurface;
  if (
    !guided &&
    new URLSearchParams(location.search).get("surface") !== "browser"
  ) {
    const server = await serverSurface(goal, signal);
    surface = {
      ...combineSurfaces({
        browser: browserSurface,
        panels: panelsForChat(),
        server,
      }),
      inspect: browserSurface.inspect,
    };
  }
  return createWaymode({
    surface: {
      ...surface,
      invoke: async (...args) => {
        await checkpoint(args[2], "act");
        return surface.invoke(...args);
      },
    },
    settle: () => app.settle(),
    decide: decideWithPlayback,
  });
};
const message = (author: string, content: string) => {
  const item = document.createElement("p");
  const name = document.createElement("strong");
  name.textContent = author;
  item.append(name, document.createTextNode(content));
  get("conversation").append(item);
  get("conversation").scrollTop = get("conversation").scrollHeight;
};
get("open-inspector").addEventListener("click", () =>
  window.open(
    "/inspect.html",
    "daylist-inspector",
    "popup,width=1000,height=900",
  ),
);
get("stop").addEventListener("click", () => running?.abort());
type Run = {
  goal: string;
  controller: AbortController;
  started: number;
  before: ReturnType<typeof app.snapshot>;
  renderedBefore: ReturnType<typeof app.rendered>;
  timer: ReturnType<typeof setInterval>;
};
const beginRun = (goal: string, input: HTMLInputElement): Run => {
  const controller = new AbortController();
  running = controller;
  revealPanel = undefined;
  const started = performance.now();
  get("feature-announcement").hidden = true;
  const before = app.snapshot();
  const renderedBefore = app.rendered();
  decisions.length = 0;
  message("You", goal);
  input.value = "";
  get<HTMLButtonElement>("send").disabled = !scriptedRequest;
  get("stop").hidden = false;
  get("status").textContent = "Understanding your request…";
  emit("run", { goal, before, maxSteps: 8 });
  window.parent.postMessage(
    { type: "waymode:request", goal, before },
    location.origin,
  );
  const timer = setInterval(() => {
    get("elapsed").textContent =
      `${((performance.now() - started) / 1000).toFixed(2)} s running`;
  }, 50);
  return { goal, controller, started, before, renderedBefore, timer };
};
const renderedChanges = (
  before: ReturnType<typeof app.rendered>,
  after: typeof before,
) =>
  after.controls.flatMap((control) => {
    const previous = before.controls.find((item) => item.name === control.name);
    return previous && previous.checked !== control.checked
      ? [
          {
            name: control.name,
            before: previous.checked,
            after: control.checked,
          },
        ]
      : [];
  });
const announceResult = (reason: string, verified: boolean) => {
  window.parent.postMessage(
    { type: "waymode:result", reason, verified },
    location.origin,
  );
};
const announceStep = (stage: string) =>
  window.parent.postMessage({ type: "waymode:step", stage }, location.origin);
const verifyRun = async (
  run: Run,
  result: Awaited<ReturnType<Awaited<ReturnType<typeof agentFor>>["run"]>>,
) => {
  await checkpoint(run.controller.signal, "verify");
  announceStep("verify");
  const saved = await readState();
  const stateMatchesSaved =
    JSON.stringify(saved) === JSON.stringify(app.snapshot());
  const rendered = app.rendered();
  const changes = renderedChanges(run.renderedBefore, rendered);
  const elapsedMs = performance.now() - run.started;
  const evidence = {
    preferenceChanges: Object.fromEntries(
      Object.entries(saved.preferences)
        .filter(([key, value]) => run.before.preferences[key] !== value)
        .map(([key, after]) => [
          key,
          { before: run.before.preferences[key], after },
        ]),
    ),
    stateMatchesSaved,
    renderedBefore: run.renderedBefore,
    rendered,
    changes,
    result,
    elapsedMs,
    before: run.before,
    saved,
    decisions,
  };
  emit("verified", evidence);
  announceResult(result.reason, stateMatchesSaved);
  get("elapsed").textContent = `${(elapsedMs / 1000).toFixed(2)} s total`;
  showVerifiedResult(run.goal, evidence);
  get("status").textContent = "";
};
const showVerifiedResult = (
  goal: string,
  evidence: Evidence & { elapsedMs: number },
) => {
  const reveal =
    revealPanel ??
    (app.isSettingsInChatVisible() ? app.revealSettingsInChat : undefined);
  appendChatResult(get("conversation"), {
    goal,
    detail: resultText(evidence),
    elapsedMs: evidence.elapsedMs,
    actions: evidence.result.actions,
    completed: evidence.result.reason === "completed",
    verified: evidence.stateMatchesSaved,
  });
  reveal?.();
};
type Evidence = Parameters<typeof resultText>[0];
const completedText = (
  result: Evidence["result"],
  rendered: Evidence["rendered"],
) => {
  if (result.reason !== "completed") {
    return result.actions
      ? "I took a step, but couldn’t confirm the full request. Check the app before trying again."
      : "I couldn’t find a reliable way to do that. Try naming the item or setting you want to change.";
  }
  return result.actions
    ? `Here are your ${rendered.view?.replace("Your Product ", "").toLowerCase()}${rendered.location === "Chat" ? " — change anything here" : ""}.`
    : "Already in the requested state.";
};
const resultText = (evidence: {
  changes: ReturnType<typeof renderedChanges>;
  before: ReturnType<typeof app.snapshot>;
  saved: ReturnType<typeof app.snapshot>;
  stateMatchesSaved: boolean;
  result: Awaited<ReturnType<Awaited<ReturnType<typeof agentFor>>["run"]>>;
  rendered: ReturnType<typeof app.rendered>;
}) => {
  const { changes, before, saved, stateMatchesSaved, result, rendered } =
    evidence;
  const effect = changes
    .map(
      (change) =>
        `${change.name}: ${change.before ? "on" : "off"} → ${change.after ? "on" : "off"}`,
    )
    .join(". ");
  if (effect) {
    return `${effect}. ${stateMatchesSaved ? "Saved." : "Saved state differs; check the result."}${result.reason === "completed" ? "" : " I couldn’t confirm the full request."}`;
  }
  if (JSON.stringify(before) !== JSON.stringify(saved)) {
    return `Application data updated. ${result.reason === "completed" ? "Saved." : "I couldn’t confirm the full request."}`;
  }
  return completedText(result, rendered);
};
const reportError = (run: Run, error: unknown) => {
  const elapsedMs = performance.now() - run.started;
  const stopped = run.controller.signal.aborted;
  const message =
    error instanceof Error ? error.message : "The request failed.";
  const detail = stopped
    ? "Stopped this request. Any change already saved remains."
    : message;
  emit("error", { error: detail, elapsedMs });
  announceResult(stopped ? "stopped" : "error", false);
  get("status").textContent = detail;
  appendChatResult(get("conversation"), {
    goal: run.goal,
    detail,
    elapsedMs,
    completed: false,
    verified: false,
    failed: !stopped,
    stopped,
  });
  get("elapsed").textContent = `${(elapsedMs / 1000).toFixed(2)} s · error`;
};
const submitPrompt = async (goal: string) => {
  const input = get<HTMLInputElement>("prompt");
  if (!goal || running) {
    return;
  }
  const run = beginRun(goal, input);
  try {
    const agent = await agentFor(goal, run.controller.signal);
    const result = await agent.run(goal, {
      maxSteps: 8,
      signal: run.controller.signal,
      onDecision: (decision) => {
        decisions.push(decision);
      },
      onReceipt: (receipt) => {
        emit("handler", receipt);
        if (!scriptedRequest) {
          announceStep("act");
        }
        get("status").textContent = "Handler invoked → checking saved state";
      },
    });
    await verifyRun(run, result);
  } catch (error) {
    reportError(run, error);
  } finally {
    clearInterval(run.timer);
    running = undefined;
    get<HTMLButtonElement>("send").disabled = false;
    get("stop").hidden = true;
  }
};
const queuePrompt = createRequestQueue(
  async (goal, watched) => {
    scriptedRequest = watched;
    await submitPrompt(goal);
  },
  () => running?.abort(),
);
get<HTMLFormElement>("prompt-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const watched =
    get<HTMLFormElement>("prompt-form").dataset.playback === "true";
  void queuePrompt(get<HTMLInputElement>("prompt").value.trim(), watched);
});
if (import.meta.hot) {
  import.meta.hot.accept("./daylist-feature.js", (module) => {
    const update = module as typeof import("./daylist-feature.js") | undefined;
    if (update) {
      app.feature(update.mountFeature);
      emit("feature", { message: "Vite loaded the changed app feature." });
    }
  });
  import.meta.hot.dispose(() => {
    channel.close();
    running?.abort();
  });
}

reportFrameSize(document.querySelector<HTMLElement>(".app-shell")!);
announceLaunch();

for (const example of document.querySelectorAll<HTMLButtonElement>(
  ".request-examples button",
)) {
  example.disabled = false;
  example.onclick = () => {
    get<HTMLInputElement>("prompt").value =
      example.dataset.request ?? example.textContent;
    get<HTMLFormElement>("prompt-form").requestSubmit();
  };
}

get<HTMLButtonElement>("send").disabled = false;
