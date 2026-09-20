import {
  createBrowserSurface,
  createCursorGuide,
  createHttpDecider,
} from "@mossburgh/waymode";
import {
  createWaymode,
  combineSurfaces,
  ActionBlockedError,
  StaleActionError,
} from "@mossburgh/waymode/core";

const pause = (milliseconds, signal) =>
  new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, milliseconds);
    signal.addEventListener("abort", stop, { once: true });
  });

// Each document creates its browser adapter in its own DOM realm.
function pageSurface(onTarget) {
  const cursor = document.createElement("div");
  cursor.setAttribute("data-waymode-ignore", "");
  cursor.hidden = true;
  cursor.innerHTML =
    '<svg width="28" height="34" viewBox="0 0 28 34"><path d="M3 2L24 22H14L10 31Z" fill="#6676ff" stroke="white" stroke-width="2"/></svg>';
  cursor.style.cssText =
    "position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;";
  document.body.append(cursor);
  const guide = createCursorGuide(cursor);
  const surface = createBrowserSurface({
    root: () => document.body,
    exclude:
      ".hybrid-input,.waymode-conversation,.skip-link,#prompt-form,.request-examples,.chat-status,#external-agent,#trace-panel,details:not([open]) > :not(summary)",
    beforeAction: async (control, signal, target) => {
      target.scrollIntoView({ block: "center", behavior: "instant" });
      await onTarget(control, target, false);
      const previous = target.style.boxShadow;
      target.style.boxShadow = "0 0 0 4px #6676ff80";
      try {
        await guide(control, signal, target);
        await pause(850, signal);
        await onTarget(control, target, true);
      } finally {
        target.style.boxShadow = previous;
      }
    },
  });
  return {
    ...surface,
    isStaleError: (error) => error instanceof StaleActionError,
    observe: (signal) => observePage(surface, signal),
    dispose() {
      surface.retire();
      cursor.remove();
    },
  };
}

// Keep attributes added for the SDK in sync after native or guided toggles.
document.addEventListener(
  "toggle",
  (event) => {
    if (event.target instanceof HTMLDetailsElement) {
      const summary = event.target.querySelector(
        ":scope > summary[role=button]",
      );
      summary?.setAttribute("aria-expanded", String(event.target.open));
    }
  },
  true,
);

function observePage(surface, signal) {
  document.querySelectorAll("summary").forEach((summary) => {
    summary.setAttribute("role", "button");
    summary.setAttribute("aria-expanded", String(summary.parentElement.open));
  });
  return {
    ...surface.observe(signal),
    state: {
      section: location.hash,
      title: document.title,
      installPromptOpen:
        document.querySelector("#install-prompt")?.open ?? false,
      copyStatus: document.querySelector(".install-status")?.textContent ?? "",
      playback:
        document.querySelector("#play-story")?.getAttribute("aria-label") ?? "",
      headings: [...document.querySelectorAll("h1,h2")]
        .map((el) => el.textContent)
        .slice(0, 12),
    },
  };
}

if (window !== window.top) {
  window.waymodeSiteSurface = pageSurface;
}

const frameModules = new WeakMap();
async function frameFactory(frame, signal) {
  const doc = frame.contentDocument;
  if (
    !doc ||
    !frame.contentWindow ||
    new URL(frame.src).origin !== location.origin
  ) {
    return;
  }
  if (!frameModules.has(doc)) {
    frameModules.set(
      doc,
      new Promise((resolve, reject) => {
        const script = doc.createElement("script");
        script.type = "module";
        script.src = new URL("/waymode/runtime.js", location.href).href;
        script.onload = () => resolve();
        script.onerror = () =>
          reject(new Error("Could not connect Waymode to the demo controls."));
        doc.head.append(script);
      }),
    );
  }
  await frameModules.get(doc);
  signal.throwIfAborted();
  return frame.contentWindow.waymodeSiteSurface;
}

async function frameOperation(surface, method, args) {
  try {
    return await surface[method](...args);
  } catch (error) {
    if (surface.isStaleError(error)) {
      throw new StaleActionError(error.message);
    }
    throw error;
  }
}
async function waitForDemo(signal) {
  const readySignal = AbortSignal.any([signal, AbortSignal.timeout(10000)]);
  while (true) {
    readySignal.throwIfAborted();
    const studio = document.querySelector(".live-showcase")?.contentDocument;
    const product = studio?.querySelector("#product")?.contentDocument;
    if (product?.querySelector("#daylist button")) {
      return;
    }
    await pause(100, readySignal);
  }
}

async function connectFrames(
  doc,
  named,
  surfaces,
  beforeAction,
  signal,
  depth = 0,
) {
  if (depth > 1) {
    return;
  }
  for (const frame of doc.querySelectorAll("iframe")) {
    const factory = await frameFactory(frame, signal);
    if (!factory) {
      continue;
    }
    const local = factory(beforeAction);
    const surface = {
      ...local,
      assertCurrent: (...args) => frameOperation(local, "assertCurrent", args),
      invoke: (...args) => frameOperation(local, "invoke", args),
    };
    named[`demo${surfaces.length}`] = surface;
    surfaces.push(surface);
    await connectFrames(
      frame.contentDocument,
      named,
      surfaces,
      beforeAction,
      signal,
      depth + 1,
    );
  }
}

function userGestureMessage(control, target) {
  if (target.matches("[data-copy-install]")) {
    return "Click Copy prompt, then paste it into your coding agent. Installation runs in your codebase.";
  }
  const link = target.closest("a[href]");
  if (
    link &&
    (link.target === "_blank" || new URL(link.href).origin !== location.origin)
  ) {
    return `Click “${control.name}” to open it in a new tab.`;
  }
}
function guidePolicy(onTarget, controller) {
  let lastTarget;
  let handoff;
  return {
    get handoff() {
      return handoff;
    },
    async beforeAction(control, target, afterGuide) {
      if (!afterGuide) {
        onTarget(control);
        return;
      }
      lastTarget = target;
      const message = userGestureMessage(control, target);
      if (message) {
        handoff = message;
        throw new ActionBlockedError("confirmation-required");
      }
    },
    async settle(signal) {
      await pause(700, signal);
      if (lastTarget?.matches('#play-story[data-state="playing"]')) {
        handoff =
          "The demo is playing. Use Pause, chapters, or Scenes to explore.";
        controller.abort();
      }
    },
  };
}

async function ensureSession(signal) {
  const session = await fetch("/api/v1/session", { signal });
  if (!session.ok) {
    throw new Error(
      `Could not start the shared demo session (${session.status}).`,
    );
  }
}

export async function runSiteRequest(
  goal,
  { signal, onTarget, onDecision, onReceipt, onObservation },
) {
  await ensureSession(signal);
  await waitForDemo(signal);
  const surfaces = [];
  const controller = new AbortController();
  const runSignal = AbortSignal.any([signal, controller.signal]);
  const policy = guidePolicy(onTarget, controller);
  try {
    const named = { site: pageSurface(policy.beforeAction) };
    surfaces.push(named.site);
    await connectFrames(
      document,
      named,
      surfaces,
      policy.beforeAction,
      runSignal,
    );
    const agent = createWaymode({
      surface: combineSurfaces(named),
      decide: async (request, signal) => {
        onObservation(request);
        return createHttpDecider("/api/v1/decisions")(request, signal);
      },
      settle: policy.settle,
    });
    const result = await agent.run(goal, {
      signal: runSignal,
      maxSteps: 5,
      onDecision,
      onReceipt,
    });
    return { ...result, handoff: policy.handoff };
  } finally {
    surfaces.forEach((surface) => surface.dispose());
  }
}
