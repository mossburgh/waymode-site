import {
  playbackSnapshot,
  type PlaybackSnapshot,
} from "./playback-snapshot.js";
import { connectPlaybackCheckpoints } from "./playback-checkpoint.js";
import type { Seek } from "./playback.js";
import { Playback } from "./playback.js";
import { StudioPlayer, interactionRequest } from "./studio-player.js";
import {
  connectDevtoolsTabs,
  selectDevtoolsTab,
  connectStudioPanels,
  selectStudioPanel,
} from "./studio-tabs.js";
import { formatCharge } from "./model-usage.js";
import { createTraceState } from "./studio-trace.js";
import {
  awaitAppResult,
  awaitAppUpdate,
  awaitAppReady,
} from "./studio-result.js";
import "./studio.css";
import story from "./launch/story.json" with { type: "json" };
import {
  featureDefinition,
  type FeatureDefinition,
} from "./showcase-feature.js";

const mountedAt = Date.now();
connectDevtoolsTabs();
connectStudioPanels();
const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const frame = get<HTMLIFrameElement>("product");
const editor = get<HTMLTextAreaElement>("feature-code");
const goal = get<HTMLInputElement>("external-goal");
const source = JSON.stringify(story.interactive.definition, null, 2);
editor.value = source;
goal.value = story.interactive.goal;
let playback: Playback | undefined;
let sceneSnapshot: PlaybackSnapshot | undefined;
let transitioning = false;
const player = new StudioPlayer(
  () => {
    sceneSnapshot = undefined;
    void switchInteraction();
  },
  (target) => {
    void switchInteraction(target);
  },
);
let storyFinished: Promise<void> = Promise.resolve();
let appRunning = false;
let selectionVersion = 0;
let storyActive = false;
let externalActive = false;
let frameReady = false;
player.busy(true);
const updateFrame = async () => {
  if (!frameReady) {
    return;
  }
  const updated = awaitAppUpdate(frame);
  frame.contentWindow?.postMessage("waymode:refresh", location.origin);
  await updated;
};
const request = async (
  path: string,
  method: string,
  input: unknown,
  signal?: AbortSignal,
) => {
  const response = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    ...(signal && { signal }),
  });
  if (!response.ok) {
    throw new Error(
      `Request failed (${response.status}); check saved state before retrying.`,
    );
  }
  return response.json() as Promise<unknown>;
};
let activeFeature: FeatureDefinition | null = null;
const describeFeature = (definition: FeatureDefinition | null) => {
  activeFeature = definition;
  get("try-feature").hidden = !definition;
  get("try-feature").textContent = definition
    ? `Ask: “Turn on ${definition.label}”`
    : "";
  get("remove-feature").hidden = !definition;
  get("apply-feature").textContent = definition
    ? "Save definition"
    : `Add ${story.interactive.definition.label}`;
  get("apply-feature").hidden = Boolean(definition);
  get("step-title").textContent = definition
    ? "Now ask for it."
    : "Give your product a new setting.";
  get("step-help").textContent = definition
    ? `${definition.label} is in Settings. The app can now discover it.`
    : `Add ${story.interactive.definition.label}. Then ask for it in chat.`;
  get("build-status").textContent = "";
  get<HTMLDetailsElement>("feature-editor").open = !definition;
};
const revealResult = () => {
  get("step-title").textContent = "Keep going. It’s your product.";
  get("step-help").textContent =
    "Ask for another change, or bring Settings into chat.";
  get("try-feature").hidden = true;
  get("external-demo").hidden = false;
};
const apply = async (definition: FeatureDefinition | null) => {
  get<HTMLButtonElement>("apply-feature").disabled = true;
  get("build-status").textContent = "Updating Your Product…";
  try {
    await request("/api/v1/feature", "PUT", definition);
    await updateFrame();
    describeFeature(definition);
  } finally {
    get<HTMLButtonElement>("apply-feature").disabled = false;
  }
};
const report = (id: string, error: unknown) => {
  get(id).textContent =
    error instanceof Error ? error.message : "Request failed.";
};
const releasePlayback = () => {
  playback = undefined;
  player.finish();
};
const stop = (cancelRequest = true, keepScene = false) => {
  if (!keepScene) {
    sceneSnapshot = undefined;
  }
  if (playback) {
    editor.value = JSON.stringify(
      activeFeature ?? story.interactive.definition,
      null,
      2,
    );
    if (cancelRequest) {
      frame.contentDocument?.getElementById("stop")?.click();
    }
    playback.abort();
  }
  releasePlayback();
  player.busy(storyActive || appRunning);
  player.phase("Live");
  get("story-status").textContent = "";
};
const runExternal = async (signal?: AbortSignal) => {
  externalActive = true;
  get<HTMLButtonElement>("run-external").disabled = true;
  get("external-status").textContent =
    "External agent is reading the app’s available actions…";
  try {
    const result = (await request(
      "/api/v1/external",
      "POST",
      { goal: goal.value },
      signal,
    )) as { result: { reason: string; actions: number }; elapsedMs: number };
    get("external-status").textContent =
      `${result.result.reason} · ${result.result.actions} action(s) · ${(result.elapsedMs / 1000).toFixed(2)}s. Saved state reloaded in the app.`;
    await updateFrame();
    return result.result.reason === "completed";
  } finally {
    externalActive = false;
    get<HTMLButtonElement>("run-external").disabled = false;
  }
};
get("apply-feature").onclick = () => {
  stop();
  try {
    const definition = featureDefinition.parse(JSON.parse(editor.value));
    void apply(definition).catch((error: unknown) =>
      report("build-status", error),
    );
  } catch (error) {
    report("build-status", error);
  }
};
get("remove-feature").onclick = () => {
  stop();
  void apply(null).catch((error: unknown) => report("build-status", error));
};
get("external-form").onsubmit = (event) => {
  event.preventDefault();
  if (!externalActive) {
    stop();
    void runExternal().catch((error: unknown) =>
      report("external-status", error),
    );
  }
};
const followRequest = (goal: string, before?: unknown) => {
  appRunning = true;
  selectDevtoolsTab("trace-tab");
  if (!playback) {
    const snapshot = playbackSnapshot.safeParse({
      state: before,
      feature: activeFeature,
    });
    sceneSnapshot = snapshot.success ? snapshot.data : undefined;
    player.follow(goal);
  }
};
const handleAppResult = (
  data: {
    type?: string;
    reason?: string;
    verified?: boolean;
    goal?: string;
    before?: unknown;
  } | null,
) => {
  if (!data) {
    return;
  }
  if (data.type === "waymode:request" && typeof data.goal === "string") {
    followRequest(data.goal, data.before);
  }
  if (data.type !== "waymode:result") {
    return;
  }
  appRunning = false;
  if (transitioning) {
    return;
  }
  const verified = data.reason === "completed" && data.verified;
  player.phase(verified ? "Verified" : "Not confirmed");
  if (verified) {
    revealResult();
  }
  if (!playback) {
    player.finish();
  }
};
const handleAppProgress = (data: { type?: string; stage?: string } | null) => {
  if (
    !transitioning &&
    data?.type === "waymode:step" &&
    typeof data.stage === "string"
  ) {
    player.chapter(data.stage);
  }
};
window.addEventListener("message", (event: MessageEvent<unknown>) => {
  if (
    event.origin !== location.origin ||
    event.source !== frame.contentWindow
  ) {
    return;
  }
  const data = event.data as {
    type?: string;
    height?: unknown;
    reason?: string;
    verified?: boolean;
    goal?: string;
    stage?: string;
    before?: unknown;
  } | null;
  if (data?.type === "waymode:ready") {
    frameReady = true;
    connectPlaybackCheckpoints(frame.contentDocument!, waitAtChapter);
    player.busy(false);
  }
  handleAppResult(data);
  handleAppProgress(data);
  if (data?.type === "waymode:takeover") {
    stop(false);
    selectDevtoolsTab("trace-tab");
  }
});
const askApp = async (
  signal: AbortSignal,
  request = goal.value,
  run?: Playback,
) => {
  const document = frame.contentDocument!;
  if ((document.getElementById("send") as HTMLButtonElement).disabled) {
    throw new Error("Let the current request finish, or stop it first.");
  }
  const input = document.getElementById("prompt") as HTMLInputElement;
  input.value = request;
  if (run) {
    await waitAtChapter("ask");
  }
  await run?.wait(story.interactive.pacing.requestHoldMs);
  signal.throwIfAborted();
  const completed = awaitAppResult(frame, signal, run ? 0 : 30000);
  const form = document.getElementById("prompt-form") as HTMLFormElement;
  form.dataset.playback = "true";
  try {
    form.requestSubmit();
  } finally {
    delete form.dataset.playback;
  }
  await completed;
};
get("try-feature").onclick = () => {
  if (!activeFeature) {
    return;
  }
  stop();
  selectDevtoolsTab("trace-tab");
  void askApp(
    new AbortController().signal,
    `Turn on ${activeFeature.label}`,
  ).catch((error: unknown) => report("story-status", error));
};
const writeFeature = async (run: Playback) => {
  await run.wait();
  get<HTMLDetailsElement>("feature-editor").open = true;
  editor.value = "";
  for (const line of source.split("\n")) {
    await run.wait();
    editor.value += `${editor.value ? "\n" : ""}${line}`;
    await run.wait(
      matchMedia("(prefers-reduced-motion: reduce)").matches
        ? 0
        : story.interactive.pacing.lineMs,
    );
  }
};
const buildFeature = async (run: Playback) => {
  frame.contentDocument
    ?.querySelector<HTMLButtonElement>('[data-view="today"]')
    ?.click();
  player.phase("Writing");
  selectStudioPanel("tools");
  await apply(null);
  editor.value = "";
  selectDevtoolsTab("source-tab");
  await waitAtChapter("write");
  await run.wait();
  await writeFeature(run);
  await run.wait();
  await apply(story.interactive.definition);
  await run.wait(story.interactive.pacing.featureHoldMs);
};
const requestForInteraction = async (signal: AbortSignal) => {
  const response = await fetch("/api/v1/product", { signal });
  if (!response.ok) {
    throw new Error("Could not read the app’s current state.");
  }
  const state = (await response.json()) as { preferences: { dark: boolean } };
  return interactionRequest(player.selected, state.preferences.dark);
};
const runStory = async (run: Playback) => {
  const interaction = player.selected;
  if (interaction.build && !player.customRequest) {
    await buildFeature(run);
  }
  await run.wait();
  const request =
    player.customRequest ?? (await requestForInteraction(run.signal));
  await run.wait();
  player.phase("Running");
  selectStudioPanel("product");
  selectDevtoolsTab("trace-tab");
  await askApp(run.signal, request, run);
  await run.wait();
  player.phase("Verified");
  await waitAtChapter("verify");
  await run.wait(story.interactive.pacing.resultHoldMs);
};
const waitAtChapter = async (stage?: string) => {
  const run = playback;
  if (!run) {
    return;
  }
  if (stage) {
    const waiting = run.checkpoint(stage);
    player.chapter(stage);
    await waiting;
  } else {
    await run.wait();
  }
};
const restoreScene = async (run: Playback) => {
  if (!sceneSnapshot) {
    const response = await fetch("/api/v1/product", { signal: run.signal });
    if (!response.ok) {
      throw new Error("Could not read the scene state.");
    }
    sceneSnapshot = playbackSnapshot.parse({
      state: (await response.json()) as unknown,
      feature: activeFeature,
    });
  }
  await request("/api/v1/playback/reset", "POST", sceneSnapshot);
  run.signal.throwIfAborted();
  describeFeature(sceneSnapshot.feature);
  frameReady = false;
  const ready = awaitAppReady(frame, run.signal);
  frame.src = `${import.meta.env.BASE_URL}product.html?showcase=1`;
  await ready;
};
const play = async (target?: Seek) => {
  const run = new Playback(target);
  playback = run;
  storyActive = true;
  player.start(run);
  goal.value = story.interactive.goal;
  get("story-status").textContent = "";
  try {
    await restoreScene(run);
    run.startClock();
    await runStory(run);
  } catch (error) {
    if (!run.signal.aborted) {
      report("story-status", error);
      player.phase("Not confirmed");
    }
  } finally {
    storyActive = false;
    player.busy(appRunning);
    if (playback === run) {
      releasePlayback();
    }
  }
};
const switchInteraction = async (target?: Seek) => {
  transitioning = true;
  const version = ++selectionVersion;
  const settled = appRunning
    ? awaitAppResult(frame, AbortSignal.timeout(30_000)).catch(() => undefined)
    : Promise.resolve();
  stop(true, true);
  await Promise.all([storyFinished, settled]);
  if (
    version === selectionVersion &&
    !appRunning &&
    !externalActive &&
    !storyActive
  ) {
    transitioning = false;
    storyFinished = play(target);
    await storyFinished;
  }
};
get("play-story").onclick = () => {
  if (playback) {
    player.toggle();
    for (const animation of frame.contentDocument
      ?.getElementById("agent-cursor")
      ?.getAnimations() ?? []) {
      if (playback.paused) {
        animation.pause();
      } else {
        animation.play();
      }
    }
  } else if (!externalActive && !storyActive && !appRunning) {
    storyFinished = play();
  }
};
editor.addEventListener("input", () => {
  const edited = editor.value;
  stop();
  editor.value = edited;
  get("apply-feature").hidden = false;
});
goal.addEventListener("input", () => stop());
const showTrace = (kind: string, label: string, data: unknown) => {
  const item = document.createElement("li");
  const detail = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = kind === "model.usage" ? label : `${kind} · ${label}`;
  const raw = document.createElement("pre");
  raw.textContent = JSON.stringify(data, null, 2);
  detail.append(summary, raw);
  item.append(detail);
  const list = get(kind === "model.usage" ? "model-calls" : "trace");
  list.prepend(item);
  while (list.children.length > 20) {
    list.lastChild?.remove();
  }
};
const acceptTrace = createTraceState(mountedAt);
const connectTrace = () => {
  const stream = new EventSource("/api/v1/trace");
  stream.onerror = () => {
    get("trace-empty").textContent =
      stream.readyState === EventSource.CLOSED
        ? "Activity unavailable. Reload to reconnect."
        : "Activity disconnected. Reconnecting…";
  };
  window.addEventListener("pagehide", () => stream.close(), { once: true });
  import.meta.hot?.dispose(() => stream.close());
  stream.onmessage = (message) => {
    frame.contentWindow?.postMessage(
      { type: "waymode:trace", json: message.data as string },
      location.origin,
    );
    const event = acceptTrace(JSON.parse(message.data as string));
    if (!event) {
      return;
    }
    if (event.label) {
      get("trace-empty").hidden = true;
      get("live-proof").hidden = false;
      get("live-proof").textContent = event.label;
      get("evidence").hidden = false;
      showTrace(event.kind, event.label, event.data);
    }
    if (event.kind === "model.receipt") {
      get("receipt").hidden = false;
      get("model").textContent =
        `${String(event.data.model)} · ${Number(event.data.elapsedMs).toFixed(0)}ms`;
    }
    get("cost").textContent =
      `${event.calls} calls · ${formatCharge(event.cost)} Gateway${event.unknown ? " + unknown" : ""} · ${formatCharge(event.marketCost)} market${event.marketUnknown ? " + unknown" : ""}`;
  };
};
await fetch("/api/v1/session");
await apply(null);
connectTrace();
frame.src = `${import.meta.env.BASE_URL}product.html?showcase=1`;
