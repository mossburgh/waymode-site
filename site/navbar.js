import "./analytics.js";
import { recordActivity } from "./activity.js";
const track = (kind, data) => recordActivity("site", kind, data);
import { runSiteRequest } from "./runtime.js";
import { createReceipt, outcomeFor, failureFor } from "./receipt.js";

const chat = document.createElement("section");
chat.id = "waymode-chat";
chat.className = "waymode-conversation";
chat.setAttribute("aria-label", "Ask Waymode");
chat.hidden = true;
chat.innerHTML =
  '<header><button class="chat-close" aria-label="Close chat">×</button></header><div class="chat-suggestions"><button data-goal="Show me how to install Waymode">Show me how to install</button><button data-goal="Show me how to use the demo">Show me how to use the demo</button><button data-goal="Show me what stays in my app">What stays in my app?</button></div><form><input aria-label="Message Waymode" placeholder="Ask Waymode…" autocomplete="off" data-analytics-prompt maxlength="2000"><button aria-label="Send message">↑</button></form><p class="chat-result" role="status"></p><div class="tool-history" aria-label="Navigation activity"></div>';

const chatForm = chat.querySelector("form");
const chatInput = chat.querySelector("input");
const barContext = document.createElement("span");
barContext.className = "bar-context";
barContext.setAttribute("aria-hidden", "true");
barContext.hidden = true;
barContext.innerHTML = "<i></i><small>At cursor</small><span></span>";
chatForm.append(barContext);

const rail = document.querySelector(".header-rail");
const nav = rail.querySelector(".nav");
const brand = nav.querySelector(".brand");
const navLinks = nav.querySelector(".nav-links");
const hub = document.createElement("div");
hub.className = "waymode-hub";
chatForm.classList.add("hybrid-input");
hub.append(brand, chatForm, navLinks, chat);
nav.append(hub);
let restoringFocus = false;
let active;
const previewObserver = new MutationObserver(refreshPreview);
const label = (el) =>
  (
    el.querySelector("strong")?.textContent ||
    el.getAttribute("aria-label") ||
    el.textContent
  )
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\.$/, "");
function updateBar() {
  const threshold = rail.classList.contains("is-compact") ? 24 : 72;
  rail.classList.toggle(
    "is-compact",
    window.scrollY > threshold || !chat.hidden,
  );
}
function hideCaption() {
  previewObserver.disconnect();
  active?.classList.remove("bar-linked");
  active = null;
  barContext.hidden = true;
  chatForm.classList.remove("show-context");
}
function setChat(open, { restoreFocus = false, focusInput = true } = {}) {
  const returnFocus =
    !open &&
    restoreFocus &&
    (chat.contains(document.activeElement) ||
      chatForm.contains(document.activeElement));
  chat.hidden = !open;
  chatInput.setAttribute("aria-expanded", String(open));
  chatInput.setAttribute("aria-controls", chat.id);
  rail.classList.toggle("chat-open", open);
  updateBar();
  if (open) {
    hideCaption();
    if (focusInput) {
      chatInput.focus();
    }
  } else if (returnFocus) {
    restoringFocus = true;
    chatInput.focus();
    restoringFocus = false;
  }
}
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    setChat(false, { restoreFocus: true });
    hideCaption();
  }
});
function control(event) {
  if (event.target.closest(".waymode-conversation,.header-rail")) {
    return null;
  }
  return event.target.closest("a[href],button,summary");
}
function copyPreview(el) {
  if (el.disabled) {
    return "Copying install prompt…";
  }
  return el.querySelector("[data-copy-label]")?.textContent === "Copied"
    ? "Copied install prompt"
    : "Copy install prompt";
}
function previewText(el) {
  if (el.matches("[data-copy-install]")) {
    return copyPreview(el);
  }
  if (el.matches("summary")) {
    return `${el.parentElement.open ? "Close" : "Open"} “${label(el)}”`;
  }
  if (el.matches("button,a.button")) {
    return el.hasAttribute("aria-controls") ? `Show “${label(el)}”` : label(el);
  }
  return `Open “${label(el)}”`;
}
function refreshPreview() {
  if (!active) {
    return;
  }
  if (
    !active.isConnected ||
    active.closest("[hidden],details:not([open]) > :not(summary)")
  ) {
    hideCaption();
    return;
  }
  const text = previewText(active);
  barContext.querySelector("span").textContent = text;
}
function watchPreview(el) {
  previewObserver.observe(el, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["aria-label", "aria-expanded", "disabled", "hidden"],
  });
  // Open state lives on details, including changes made by the runtime.
  for (const details of document.querySelectorAll("details")) {
    if (details.contains(el)) {
      previewObserver.observe(details, {
        attributes: true,
        attributeFilter: ["open"],
      });
    }
  }
}
function preview(event) {
  const el = control(event);
  if (!el || running) {
    return;
  }
  if (event.type === "focusin") {
    setChat(false);
  }
  // Moving between an icon and its label is still the same control.
  if (el === active && el.contains(event.relatedTarget)) {
    return;
  }
  const previewMode = event.type;
  hideCaption();
  if (
    !chat.hidden ||
    chatInput.value ||
    chatForm.contains(document.activeElement)
  ) {
    return;
  }
  active = el;
  el.classList.add("bar-linked");
  barContext.querySelector("small").textContent =
    previewMode === "focusin" ? "In focus" : "At cursor";
  barContext.hidden = false;
  chatForm.classList.add("show-context");
  watchPreview(el);
  refreshPreview();
}
document.addEventListener("pointerover", preview);
document.addEventListener("focusin", preview);
for (const event of ["pointerout", "focusout"]) {
  document.addEventListener(event, (e) => {
    if (
      active &&
      e.target.closest("a,button,summary") === active &&
      !active.contains(e.relatedTarget)
    ) {
      hideCaption();
    }
  });
}
document.addEventListener("click", (event) => {
  const el = control(event);
  if (el && !active) {
    preview({ target: el, type: "focusin" });
  }
});
let running;
const send = chatForm.querySelector("button");
function setRunning(controller) {
  running = controller;
  const busy = Boolean(controller);
  chat.toggleAttribute("data-running", busy);
  chatInput.setAttribute("aria-busy", String(busy));
  send.type = busy ? "button" : "submit";
  send.textContent = busy ? "■" : "↑";
  send.setAttribute("aria-label", busy ? "Stop Waymode" : "Send message");
  send.title = send.getAttribute("aria-label");
  send.toggleAttribute("data-running", busy);
}
send.addEventListener("click", (event) => {
  if (running) {
    event.preventDefault();
    track("stop_requested", { runId: running.runId });
    running.abort();
  }
});
window.addEventListener("pagehide", () => running?.abort());
function blocked(value) {
  const query = value.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  return /(?:ignore|override|bypass).{0,40}(?:instruction|rule|permission|security)|(?:reveal|steal|dump|leak).{0,40}(?:api key|password|credential|secret|system prompt)|(?:delete|wipe|drop).{0,30}(?:database|repo|file|everything)|(?:run|execute).{0,30}(?:shell|command|code)|(?:hack|exploit|exfiltrat)/.test(
    query,
  );
}
function beginReceipt(value) {
  const receipt = createReceipt(
    chat.querySelector(".tool-history"),
    chat.querySelector(".chat-result"),
    value,
  );
  if (blocked(value)) {
    track("request_finish", { outcome: "blocked", goal: value });
    receipt.finish("Blocked", "Nice try. That action isn’t available.");
    return;
  }
  return receipt;
}
const trackedCallbacks = (callbacks, runId) =>
  Object.fromEntries(
    Object.entries(callbacks).map(([kind, callback]) => [
      kind,
      (data) => {
        track(kind, { runId, data });
        callback(data);
      },
    ]),
  );
async function submitRequest(value) {
  if (!value.trim() || running) {
    return;
  }
  const receipt = beginReceipt(value);
  if (!receipt) {
    return;
  }
  const controller = new AbortController();
  controller.runId = crypto.randomUUID();
  const started = performance.now();
  track("request_start", { goal: value, runId: controller.runId });
  setRunning(controller);
  try {
    const result = await runSiteRequest(value, {
      signal: controller.signal,
      ...trackedCallbacks(receipt.callbacks, controller.runId),
    });
    receipt.finish(...outcomeFor(result));
    track("request_finish", {
      runId: controller.runId,
      outcome: result.reason,
      actions: result.actions,
      durationMs: performance.now() - started,
    });
  } catch (error) {
    receipt.error(error);
    receipt.finish(...failureFor(error, controller.signal.aborted));
    track("request_finish", {
      runId: controller.runId,
      outcome: controller.signal.aborted ? "stopped" : "failed",
      durationMs: performance.now() - started,
    });
  } finally {
    receipt.seal();
    setRunning(undefined);
  }
}

chatInput.addEventListener("focus", () => {
  if (chat.hidden && !restoringFocus) {
    setChat(true, { focusInput: false });
  }
});
document.addEventListener("pointerdown", (event) => {
  if (!hub.contains(event.target)) {
    setChat(false);
  }
});
document.addEventListener("focusin", (event) => {
  if (!hub.contains(event.target)) {
    setChat(false);
  }
});
chatInput.addEventListener("click", () => {
  if (chat.hidden) {
    setChat(true);
  }
});
chatInput.addEventListener("input", () => {
  if (chat.hidden) {
    setChat(true);
  }
});
chat.querySelector(".chat-close").onclick = () =>
  setChat(false, { restoreFocus: true });
chat.querySelectorAll("[data-goal]").forEach(
  (button) =>
    (button.onclick = () => {
      if (running) {
        return;
      }
      setChat(true);
      void submitRequest(button.dataset.goal);
    }),
);
chatForm.onsubmit = (event) => {
  event.preventDefault();
  if (running) {
    return;
  }
  const value = chatInput.value.trim();
  chatInput.value = "";
  setChat(true);
  void submitRequest(value);
};
window.addEventListener("scroll", updateBar, { passive: true });
setChat(false);
