const timeoutMessage =
  "The security check took too long. Retry, or open waymode.ai in another browser if it keeps stalling.";
let scriptReady;
function loadTurnstile(host) {
  if (host.turnstile) {
    return Promise.resolve(host.turnstile);
  }
  scriptReady ??= new Promise((resolve, reject) => {
    const script = host.document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    const timer = setTimeout(() => fail(), 15000);
    script.onload = () => {
      clearTimeout(timer);
      resolve(host.turnstile);
    };
    const fail = () => {
      clearTimeout(timer);
      scriptReady = undefined;
      script.remove();
      reject(new Error("Could not load the security check. Please retry."));
    };
    script.onerror = fail;
    host.document.head.append(script);
  });
  return scriptReady;
}
function challengePanel(host) {
  const panel = host.document.createElement("dialog");
  panel.className = "ph-no-capture";
  panel.setAttribute("data-waymode-ignore", "");
  panel.setAttribute("aria-label", "Security check");
  panel.style.cssText =
    "border:1px solid #d8daea;border-radius:20px;padding:24px;max-width:calc(100vw - 32px);background:#fff;color:#14151a;box-shadow:0 20px 80px #0003;";
  panel.innerHTML =
    '<h2 style="margin:0 0 12px;font:600 20px system-ui">Quick security check</h2><p style="font:14px system-ui">This helps protect Waymode from bots and abuse.</p><div></div><p role="status" hidden style="font:14px system-ui;max-width:340px"></p><button data-retry type="button" hidden style="margin-top:16px;padding:8px 16px">Retry security check</button> <button data-cancel type="button" style="margin-top:16px;padding:8px 16px">Cancel</button>';
  host.document.body.append(panel);
  panel.showModal();
  return panel;
}
async function verifyToken(token, signal) {
  const response = await fetch("/api/v1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
    signal,
  });
  if (!response.ok) {
    throw new Error("The security check failed. Please retry.");
  }
}
async function runChallenge(host, api, config, signal) {
  signal.throwIfAborted();
  const panel = challengePanel(host);
  const controller = new AbortController();
  const active = AbortSignal.any([signal, controller.signal]);
  bindCancel(panel, () =>
    controller.abort(
      new DOMException("Security check cancelled.", "AbortError"),
    ),
  );
  try {
    while (true) {
      active.throwIfAborted();
      try {
        await challengeAttempt(api, panel, config, active);
        return;
      } catch (error) {
        active.throwIfAborted();
        await waitForRetry(panel, error, active);
      }
    }
  } finally {
    panel.remove();
  }
}
function challengeAttempt(api, panel, config, signal) {
  const controller = new AbortController();
  const active = AbortSignal.any([signal, controller.signal]);
  const timer = setTimeout(
    () => controller.abort(new Error(timeoutMessage)),
    30000,
  );
  let widget;
  return new Promise((resolve, reject) => {
    const abort = () => reject(active.reason);
    active.addEventListener("abort", abort, { once: true });
    const finish = (error) => {
      active.removeEventListener("abort", abort);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    widget = api.render(
      panel.querySelector("div"),
      challengeOptions(
        config,
        (token) => {
          if (!active.aborted) {
            void verifyToken(token, active).then(() => finish(), finish);
          }
        },
        finish,
      ),
    );
  }).finally(() => {
    clearTimeout(timer);
    controller.abort();
    if (widget !== undefined) {
      api.remove(widget);
    }
  });
}
function challengeOptions(config, callback, finish) {
  return {
    sitekey: config.sitekey,
    action: "waymode",
    cData: config.nonce,
    retry: "never",
    "refresh-expired": "never",
    "refresh-timeout": "never",
    callback,
    "error-callback": (code) => {
      // Error codes help diagnose blocked or unsupported browsers; never log tokens.
      console.warn("Waymode security check failed", String(code).slice(0, 12));
      finish(
        new Error(
          "Cloudflare could not verify this browser. Retry, or open waymode.ai in another browser.",
        ),
      );
    },
    "expired-callback": () =>
      finish(new Error("The security check expired. Please retry.")),
    "timeout-callback": () =>
      finish(new Error("The security check timed out. Please retry.")),
  };
}
function waitForRetry(panel, error, signal) {
  const status = panel.querySelector('[role="status"]');
  const retry = panel.querySelector("[data-retry]");
  status.textContent = error.message;
  status.hidden = false;
  retry.hidden = false;
  retry.focus();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    retry.onclick = () => {
      signal.removeEventListener("abort", abort);
      resolve();
    };
  }).finally(() => {
    retry.onclick = null;
    retry.hidden = true;
    status.hidden = true;
  });
}
async function check(signal) {
  const response = await fetch("/api/v1/session", {
    signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
  });
  if (!response.ok) {
    throw new Error("Could not start your Waymode session. Please retry.");
  }
  const { verification } = await response.json();
  // The local development server has no paid public gateway or challenge.
  if (!verification?.required) {
    return;
  }
  if (!verification.sitekey) {
    throw new Error("Live requests are temporarily unavailable.");
  }
  const host = window.top ?? window;
  const api = await abortable(loadTurnstile(host), signal);
  signal.throwIfAborted();
  await runChallenge(host, api, verification, signal);
}
let pendingVerification;
function sharedCheck() {
  const controller = new AbortController();
  const entry = { controller, users: 0, promise: undefined };
  entry.promise = check(controller.signal).finally(() => {
    if (pendingVerification === entry) {
      pendingVerification = undefined;
    }
  });
  return entry;
}
export async function ensureModelAccess(signal) {
  signal.throwIfAborted();
  if (window !== window.top) {
    if (!window.top?.waymodeModelAccess) {
      throw new Error("The page is still loading. Please retry.");
    }
    return window.top.waymodeModelAccess(signal);
  }
  const entry = (pendingVerification ??= sharedCheck());
  entry.users++;
  try {
    await abortable(entry.promise, signal);
  } finally {
    if (--entry.users === 0) {
      entry.controller.abort();
    }
  }
}
if (window === window.top) {
  window.waymodeModelAccess = ensureModelAccess;
}

function cancelChallenge(event, finish) {
  event.preventDefault();
  finish(new DOMException("Security check cancelled.", "AbortError"));
}

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    promise
      .then(resolve, reject)
      .finally(() => signal.removeEventListener("abort", abort));
  });
}

function bindCancel(panel, finish) {
  const cancel = (event) => cancelChallenge(event, finish);
  panel.addEventListener("cancel", cancel);
  panel.querySelector("[data-cancel]").onclick = cancel;
}
