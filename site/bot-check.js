let scriptReady;
function loadTurnstile(host) {
  if (host.turnstile) {
    return Promise.resolve(host.turnstile);
  }
  scriptReady ??= new Promise((resolve, reject) => {
    const script = host.document.createElement("script");
    script.src =
      "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.onload = () => resolve(host.turnstile);
    script.onerror = () => {
      scriptReady = undefined;
      script.remove();
      reject(new Error("Could not load the security check. Please retry."));
    };
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
    '<h2 style="margin:0 0 12px;font:600 20px system-ui">Quick security check</h2><p style="font:14px system-ui">This keeps the shared demo available for everyone.</p><div></div><button type="button" style="margin-top:16px;padding:8px 16px">Cancel</button>';
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
function runChallenge(host, api, config, signal) {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const panel = challengePanel(host);
    let done = false;
    const widget = { id: undefined };
    const finish = (error) => {
      if (done) {
        return;
      }
      done = true;
      signal.removeEventListener("abort", abort);
      if (widget.id !== undefined) {
        api.remove(widget.id);
      }
      panel.remove();
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const abort = () => finish(signal.reason);
    bindCancel(panel, finish);
    signal.addEventListener("abort", abort, { once: true });
    renderChallenge(api, panel, config, signal, widget, finish);
  });
}
function renderChallenge(api, panel, config, signal, widget, finish) {
  try {
    widget.id = api.render(panel.querySelector("div"), {
      sitekey: config.sitekey,
      action: "waymode",
      cData: config.nonce,
      callback: (token) => {
        void verifyToken(token, signal).then(() => finish(), finish);
      },
      "error-callback": () =>
        finish(new Error("Security check unavailable. Please retry.")),
      "expired-callback": () =>
        finish(new Error("Check expired. Please retry.")),
    });
  } catch (error) {
    finish(error);
  }
}
async function check(signal) {
  const response = await fetch("/api/v1/session", { signal });
  if (!response.ok) {
    throw new Error("Could not start the shared demo session. Please retry.");
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
  entry.promise = check(
    AbortSignal.any([controller.signal, AbortSignal.timeout(120000)]),
  ).finally(() => {
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
  panel.querySelector("button").onclick = cancel;
}
