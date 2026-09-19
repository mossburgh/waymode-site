// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { connectHandoff } from "./handoff.js";

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  document.body.replaceChildren();
});
const setup = (reduced = false) => {
  document.body.innerHTML =
    '<video></video><div></div><iframe></iframe><button id="activate" disabled></button><button id="replay" hidden></button><p></p>';
  const options = {
    video: document.querySelector("video")!,
    overlay: document.querySelector("div")!,
    frame: document.querySelector("iframe")!,
    activate: document.querySelector<HTMLButtonElement>("#activate")!,
    replay: document.querySelector<HTMLButtonElement>("#replay")!,
    status: document.querySelector("p")!,
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)"),
  };
  vi.spyOn(options.reducedMotion, "matches", "get").mockReturnValue(reduced);
  vi.spyOn(options.video, "pause").mockImplementation(() => {});
  const play = vi.spyOn(options.video, "play").mockResolvedValue();
  const handoff = connectHandoff(options);
  cleanups.push(handoff.dispose);
  return { ...options, handoff, play };
};
const ready = (frame: HTMLIFrameElement, origin = location.origin) =>
  window.dispatchEvent(
    new MessageEvent("message", {
      origin,
      source: frame.contentWindow,
      data: { type: "waymode:ready" },
    }),
  );
it("waits for the mounted app and ignores foreign readiness messages", () => {
  const { frame, handoff, overlay, activate } = setup();
  handoff.showLive();
  expect(overlay.classList.contains("is-live")).toBe(false);
  ready(frame, "https://untrusted.example");
  expect(activate.disabled).toBe(true);
  ready(frame);
  handoff.showLive();
  expect(overlay.classList.contains("is-live")).toBe(true);
  expect(frame.inert).toBe(false);
  expect(overlay.inert).toBe(true);
});
it("ends into the same mounted app and replay preserves that DOM", () => {
  const { frame, video, replay, overlay } = setup();
  const child = frame.contentWindow;
  ready(frame);
  video.dispatchEvent(new Event("ended"));
  expect(overlay.classList.contains("is-live")).toBe(true);
  replay.click();
  expect(frame.contentWindow).toBe(child);
  expect(overlay.classList.contains("is-live")).toBe(false);
  expect(video.currentTime).toBe(0);
});
it("requires an explicit action under reduced motion", () => {
  const { frame, video, overlay, activate, play } = setup(true);
  ready(frame);
  video.dispatchEvent(new Event("ended"));
  expect(overlay.classList.contains("is-live")).toBe(false);
  activate.click();
  expect(overlay.classList.contains("is-live")).toBe(true);
  expect(play).not.toHaveBeenCalled();
});
it("removes listeners when disposed", () => {
  const { frame, handoff, activate } = setup();
  handoff.dispose();
  ready(frame);
  expect(activate.disabled).toBe(true);
});

it("hands off when the app becomes ready after the film ended", () => {
  const { frame, video, overlay } = setup();
  vi.spyOn(video, "ended", "get").mockReturnValue(true);
  video.dispatchEvent(new Event("ended"));
  expect(overlay.classList.contains("is-live")).toBe(false);
  ready(frame);
  expect(overlay.classList.contains("is-live")).toBe(true);
});
it("keeps late readiness explicit under reduced motion", () => {
  const { frame, video, overlay, activate } = setup(true);
  vi.spyOn(video, "ended", "get").mockReturnValue(true);
  ready(frame);
  expect(overlay.classList.contains("is-live")).toBe(false);
  expect(activate.disabled).toBe(false);
});
