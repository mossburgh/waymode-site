import "./daylist.css";

const sessionResponse = await fetch("/api/v1/session");
if (!sessionResponse.ok) {
  throw new Error("Could not start the inspector session.");
}
const session = (await sessionResponse.json()) as { traceChannel: string };

type Event = {
  id: number | string;
  stream?: string;
  at: number;
  kind: string;
  data: Record<string, unknown>;
};
const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const events: Event[] = [];
let following = true;
let selected: Event | undefined;
let started: number | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let lastServerEvent = { stream: "", id: 0 };
let knownCost = 0;
let unknownCost = 0;
let estimated = false;
const labels: Record<string, string> = {
  run: "User request",
  controls: "Live control snapshot",
  "model.request": "Request sent to Model",
  "model.answers": "Model probabilities",
  "model.receipt": "Validated decision",
  handler: "Existing handler invoked",
  policy: "App policy checked",
  verified: "Saved state checked",
  network: "App API response",
  feature: "App feature reloaded",
  error: "Run failed",
  "model.error": "Model call failed",
};
const nextTab = (key: string, current: number, count: number) => {
  if (key === "Home") {
    return 0;
  }
  if (key === "End") {
    return count - 1;
  }
  return (current + (key === "ArrowRight" ? 1 : -1) + count) % count;
};
const studio = new URLSearchParams(location.search).has("studio");
document.body.classList.toggle("studio", studio);
const showTab = (name: string) => {
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-tab]",
  )) {
    const active = button.dataset.tab === name;
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
    get(`${button.dataset.tab}-panel`).hidden = studio
      ? !["trace", "source"].includes(button.dataset.tab!) && !active
      : !active;
  }
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-tab]",
)) {
  button.onclick = () => showTab(button.dataset.tab!);
  button.onkeydown = (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) {
      return;
    }
    event.preventDefault();
    const tabs = [
      ...document.querySelectorAll<HTMLButtonElement>("[data-tab]"),
    ];
    const index = nextTab(event.key, tabs.indexOf(button), tabs.length);
    tabs[index]!.click();
    tabs[index]!.focus();
  };
}
const record = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
const text = (value: unknown): string => {
  if (Array.isArray(value)) {
    return value
      .map((item: unknown) =>
        item === null || item === undefined ? "" : text(item),
      )
      .join(",");
  }
  if (value !== null && typeof value === "object") {
    return Object.prototype.toString.call(value);
  }
  return String(value);
};
const controlsOf = (event: Event) => {
  const data =
    event.kind === "model.request" ? record(event.data.state) : event.data;
  return Array.isArray(data.controls) ? data.controls.map(record) : [];
};
const controlName = (event: Event) => {
  if (event.kind === "handler") {
    return text(record(event.data.before).name ?? "Unnamed control");
  }
  const index = events.indexOf(event);
  for (let position = index - 1; position >= 0; position--) {
    const earlier = events[position]!;
    if (earlier.kind === "run") {
      break;
    }
    const control = controlsOf(earlier).find(
      (item) => item.id === event.data.target,
    );
    if (control) {
      return text(control.name ?? "Unnamed control");
    }
  }
  return "Control name unavailable";
};
const displayValue = (value: unknown) => {
  if (typeof value === "boolean") {
    return value ? "on" : "off";
  }
  return value === undefined ? "not observed" : text(value);
};
const decisionSummary = (event: Event) => {
  const data = event.data;
  const probability =
    typeof data.probability === "number"
      ? ` · ${(data.probability * 100).toFixed(0)}% probability`
      : "";
  if (data.outcome === "selected") {
    return `Selected ${controlName(event)}${probability}`;
  }
  return `${data.outcome === "completed" ? "Model judged the request complete" : "No control selected"}${probability}`;
};
const savedStateSummary = (matches: unknown) => {
  if (matches === true) {
    return "App state matches saved state.";
  }
  return matches === false
    ? "App state differs from saved state."
    : "Saved-state match not reported.";
};
const controlSummary = (event: Event) => {
  const controls = controlsOf(event);
  return `${controls.length} controls: ${controls.map((item) => String(item.name)).join(", ") || "none"}`;
};
const summaries: Record<string, (event: Event) => string> = {
  run: ({ data }) => text(data.goal ?? "Request received"),
  controls: controlSummary,
  "model.request": controlSummary,
  policy: ({ data }) =>
    `${text(data.method)} ${text(data.path)}: ${text(data.result)}`,
  "model.receipt": decisionSummary,
  handler: (event) => `Invoked ${controlName(event)}`,
  verified: ({ data }) => {
    const result = record(data.result);
    return `${text(result.actions ?? 0)} controls used · ${text(result.reason ?? "not reported")}. ${savedStateSummary(data.stateMatchesSaved)}`;
  },
  network: ({ data }) =>
    `${String(data.method)} ${String(data.path)} → ${String(data.status)}`,
  "model.answers": () =>
    "Model returned probabilities. Expand the raw payload to inspect every candidate.",
  feature: ({ data }) =>
    text(data.message ?? "The app loaded a source change."),
  error: ({ data }) => text(data.error ?? data.name ?? "The request failed."),
  "model.error": ({ data }) =>
    text(data.error ?? data.name ?? "The request failed."),
};
const summary = (event: Event) =>
  summaries[event.kind]?.(event) ?? labels[event.kind] ?? event.kind;
const showChanges = (event: Event) => {
  const list = get("observed-changes");
  list.replaceChildren();
  if (event.kind !== "verified") {
    return;
  }
  const changes = Array.isArray(event.data.changes)
    ? event.data.changes.map(record)
    : [];
  const before = record(event.data.renderedBefore);
  const after = record(event.data.rendered);
  for (const [key, name] of [
    ["view", "View"],
    ["location", "Location"],
    ["theme", "Theme"],
    ["rowHeight", "Task row height (px)"],
  ] as const) {
    if (
      before[key] !== undefined &&
      after[key] !== undefined &&
      before[key] !== after[key]
    ) {
      changes.push({ name, before: before[key], after: after[key] });
    }
  }
  for (const change of changes) {
    const item = document.createElement("li");
    item.textContent = `${String(change.name)}: ${displayValue(change.before)} → ${displayValue(change.after)}`;
    list.append(item);
  }
  if (!changes.length) {
    const item = document.createElement("li");
    item.textContent = "No rendered changes reported.";
    list.append(item);
  }
};
const renderTrail = () => {
  const start = events.findLastIndex((event) => event.kind === "run");
  const list = get("action-trail");
  list.replaceChildren();
  if (start < 0) {
    get("trail-status").textContent = "Waiting for a request.";
    return;
  }
  const run = events.slice(start + 1);
  const actions = run.filter((event) => event.kind === "handler");
  for (const action of actions) {
    const item = document.createElement("li");
    item.textContent = controlName(action);
    list.append(item);
  }
  const latest = run.findLast((event) =>
    ["verified", "error", "model.error"].includes(event.kind),
  );
  if (latest) {
    get("trail-status").textContent = summary(latest);
    return;
  }
  get("trail-status").textContent = actions.length
    ? "Waiting for the next decision or saved-state check."
    : "No controls invoked yet.";
};
const show = (event: Event) => {
  selected = event;
  get("payload-title").textContent = labels[event.kind] ?? event.kind;
  get("payload").textContent = JSON.stringify(event.data, null, 2);
  get("event-summary").textContent = summary(event);
  showChanges(event);
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-event]",
  )) {
    button.setAttribute(
      "aria-pressed",
      String(button.dataset.event === String(event.id)),
    );
  }
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-stage]",
  )) {
    button.classList.toggle("active", button.dataset.stage === event.kind);
  }
};
const renderEvents = () => {
  const list = get("events");
  list.replaceChildren();
  const network = get("network-events");
  network.replaceChildren();
  for (const event of events) {
    const button = document.createElement("button");
    button.dataset.event = String(event.id);
    button.setAttribute("aria-pressed", String(selected?.id === event.id));
    button.textContent = labels[event.kind] ?? event.kind;
    const detail = document.createElement("span");
    detail.className = "event-summary";
    detail.textContent = summary(event);
    button.append(detail);
    const time = document.createElement("small");
    time.textContent = `${new Date(event.at).toLocaleTimeString([], { hour12: false })} · ${typeof event.id === "number" ? "server" : "browser"}`;
    button.append(time);
    button.onclick = () => {
      following = false;
      show(event);
      showTab("trace");
    };
    list.append(button);
    if (event.kind === "network") {
      const row = document.createElement("button");
      row.textContent = `${String(event.data.method)} ${String(event.data.path)} → ${String(event.data.status)} · ${Number(event.data.elapsedMs).toFixed(1)} ms server`;
      row.onclick = () => {
        get("network-payload").textContent = JSON.stringify(
          event.data,
          null,
          2,
        );
      };
      network.append(row);
    }
  }
  if (following) {
    list.scrollTop = list.scrollHeight;
  }
};
let renderPending = false;
const scheduleRender = () => {
  if (renderPending) {
    return;
  }
  renderPending = true;
  requestAnimationFrame(() => {
    renderPending = false;
    renderEvents();
    renderTrail();
  });
};
const acceptEvent = (event: Event) => {
  if (typeof event.id === "number" && event.stream) {
    if (
      lastServerEvent.stream === event.stream &&
      event.id <= lastServerEvent.id
    ) {
      return false;
    }
    lastServerEvent = { stream: event.stream, id: event.id };
  } else if (events.some((item) => item.id === event.id)) {
    return false;
  }
  events.push(event);
  if (events.length > 100) {
    events.shift();
  }
  return true;
};
const updateTimer = (event: Event) => {
  if (event.kind === "run") {
    get("goal").textContent = String(event.data.goal);
    started = event.at;
    clearInterval(timer);
    timer = setInterval(() => {
      get("run-time").textContent =
        `${((Date.now() - started!) / 1000).toFixed(2)} s`;
    }, 50);
    for (const stage of document.querySelectorAll(".stage")) {
      stage.classList.remove("done", "active");
    }
  }
  if (["verified", "error"].includes(event.kind)) {
    clearInterval(timer);
    get("run-time").textContent =
      `${(Number(event.data.elapsedMs) / 1000).toFixed(2)} s`;
  }
};
const updateCost = (event: Event) => {
  if (event.kind === "model.receipt") {
    if (
      typeof event.data.costUsd === "number" &&
      event.data.costSource !== "unavailable"
    ) {
      knownCost += event.data.costUsd;
    } else {
      unknownCost++;
    }
    estimated ||= event.data.costSource === "estimated";
    get("cost").textContent =
      `${text(event.data.model)} · $${knownCost.toFixed(6)}${estimated ? " est." : ""}${unknownCost ? " + unknown" : ""} · ${Math.round(Number(event.data.elapsedMs))} ms last call`;
  }
  if (event.kind === "model.error") {
    unknownCost++;
    get("cost").textContent = `Model · $${knownCost.toFixed(6)} + unknown`;
  }
};
const showNetworkReceipt = (event: Event) => {
  if (event.kind === "network" && event.data.method === "PATCH") {
    get("proof-saved-value").textContent =
      `HTTP ${String(event.data.status)} · ${JSON.stringify(record(event.data.input).preferences ?? event.data.input)}`;
    get("network-payload").textContent = JSON.stringify(event.data, null, 2);
  }
};
const receive = (event: Event) => {
  if (!acceptEvent(event)) {
    return;
  }
  updateTimer(event);
  updateCost(event);
  showNetworkReceipt(event);
  document.querySelector(`[data-stage="${event.kind}"]`)?.classList.add("done");
  if (following && event.kind !== "network") {
    show(event);
  }
  scheduleRender();
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-stage]",
)) {
  button.onclick = () => {
    const event = events.findLast((item) => item.kind === button.dataset.stage);
    if (event) {
      following = false;
      show(event);
      showTab("trace");
    }
  };
}
get("follow").onclick = () => {
  following = true;
  const last = events.at(-1);
  if (last) {
    show(last);
  }
};
const channel = new BroadcastChannel(session.traceChannel);
channel.onmessage = (message: MessageEvent<Event | { history: Event[] }>) => {
  if (!message.data || typeof message.data !== "object") {
    return;
  }
  if ("history" in message.data) {
    message.data.history.forEach(receive);
  } else {
    receive(message.data);
  }
};
channel.postMessage("history");
const stream = new EventSource("/api/v1/trace");
stream.onmessage = (message) =>
  receive(JSON.parse(message.data as string) as Event);
stream.onopen = () => {
  get("connection").textContent = "● Connected · real requests";
};
stream.onerror = () => {
  get("connection").textContent = "Reconnecting to trace";
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-proof]",
)) {
  button.onclick = () => showTab(button.dataset.proof!);
}
let oldSource: string | undefined;
let source: EventSource;
const receiveSource = (message: MessageEvent<string>) => {
  const update = JSON.parse(message.data) as {
    path: string;
    source: string;
    changedAt: string;
    sha256: string;
  };
  get("proof-source-value").textContent =
    `${oldSource === undefined ? "Loaded" : "Saved change"} · ${update.sha256.slice(0, 10)}`;
  get("source-path").textContent = update.path;
  get("source-code").replaceChildren();
  const previous = new Set(oldSource?.split("\n"));
  for (const line of update.source.split("\n")) {
    const span = document.createElement("span");
    span.textContent = line || " ";
    if (oldSource !== undefined && !previous.has(line)) {
      span.className = "added";
    }
    get("source-code").append(span);
  }
  get("source-state").textContent =
    oldSource === undefined ? "Loaded from disk" : "File changed";
  get("source-hash").textContent =
    `SHA-256 ${update.sha256} · file saved ${update.changedAt}`;
  get("source-status").textContent = `Source ${update.sha256.slice(0, 10)}`;
  oldSource = update.source;
};
const watchSource = () => {
  source?.close();
  oldSource = undefined;
  source = new EventSource(
    `/api/v1/source?file=${get<HTMLSelectElement>("source-file").value}`,
  );
  source.onmessage = receiveSource;
  source.onerror = () => {
    get("source-status").textContent = "Source stream reconnecting";
  };
};
get("source-file").onchange = watchSource;
watchSource();
const loadEvals = async () => {
  const response = await fetch("/api/v1/evals");
  if (!response.ok) {
    return;
  }
  const report = (await response.json()) as {
    cases: { name: string; pass: boolean; elapsedMs: number }[];
    passed: number;
    total: number;
    at: string;
  };
  get("proof-evals-value").textContent =
    `${report.passed}/${report.total} passed · ${report.total - report.passed} failed`;
  get("proof-evals-date").textContent =
    `Prior run · ${report.at.slice(0, 10)} · inspect cases ↗`;
  get("eval-summary").textContent =
    `${report.passed}/${report.total} passed · ${report.at} · bar = full request time`;
  get("eval-rows").replaceChildren();
  const max = Math.max(1, ...report.cases.map((row) => row.elapsedMs));
  for (const row of report.cases) {
    const button = document.createElement("button");
    button.className = "eval-row";
    const label = document.createElement("span");
    label.textContent = row.name;
    const bar = document.createElement("span");
    bar.className = "bar";
    const fill = document.createElement("span");
    fill.style.width = `${(row.elapsedMs / max) * 100}%`;
    bar.append(fill);
    const result = document.createElement("span");
    result.textContent = row.pass ? "PASS" : "FAIL";
    result.className = row.pass ? "pass" : "fail";
    button.append(label, bar, result);
    button.onclick = () => {
      get("eval-payload").textContent = JSON.stringify(row, null, 2);
      get("eval-payload").closest("details")!.open = true;
    };
    get("eval-rows").append(button);
  }
};
get("refresh-evals").onclick = () => void loadEvals();
void loadEvals();

if (studio) {
  showTab("source");
}
