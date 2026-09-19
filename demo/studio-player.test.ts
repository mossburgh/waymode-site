// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { Playback } from "./playback.js";
import {
  StudioPlayer,
  interactions,
  interactionRequest,
} from "./studio-player.js";

const fixture = () => {
  vi.useFakeTimers();
  document.body.innerHTML = `<button id="play-story"><span id="play-label"></span></button>
    <span id="elapsed"></span><nav id="chapters"></nav>
    <dialog id="scene-picker"><nav id="interactions"></nav></dialog>
    <button id="open-scenes"></button><button id="close-scenes"></button>
    <span id="player-phase"></span>`;
  const select = vi.fn();
  const player = new StudioPlayer(select);
  return {
    player,
    select,
    buttons: document.querySelectorAll<HTMLButtonElement>(
      "#interactions button",
    ),
  };
};
afterEach(() => {
  window.dispatchEvent(new Event("pagehide"));
  vi.useRealTimers();
  document.body.replaceChildren();
});

it("lets any library item play without unlocking prior chapters", () => {
  const { player, select, buttons } = fixture();
  buttons[2]!.click();
  expect(select).toHaveBeenCalledExactlyOnceWith(interactions[2]);
  expect(player.selected.id).toBe("settings");
  expect(buttons[2]!.getAttribute("aria-pressed")).toBe("true");
  expect(buttons[0]!.getAttribute("aria-pressed")).toBe("false");
});

it("follows the actual user request without invoking the library again", async () => {
  const { player, select, buttons } = fixture();
  player.start(new Playback());
  player.follow("Uncheck Plan next week");
  await vi.advanceTimersByTimeAsync(2000);
  expect(document.getElementById("elapsed")!.textContent).toBe("0:02");
  expect([...buttons].every((button) => button.disabled)).toBe(true);
  expect(select).not.toHaveBeenCalled();
  expect(player.customRequest).toBe("Uncheck Plan next week");
  player.phase("Verified");
  player.finish();
  await vi.advanceTimersByTimeAsync(2000);
  expect(document.getElementById("elapsed")!.textContent).toBe("0:02");
  expect([...buttons].every((button) => !button.disabled)).toBe(true);
  buttons[2]!.click();
  expect(player.customRequest).toBeUndefined();
});

it("chooses the opposite theme from saved state for direct and guided examples", () => {
  for (const id of ["theme", "guide"]) {
    const interaction = interactions.find((item) => item.id === id)!;
    expect(interactionRequest(interaction, true)).toContain("light mode");
    expect(interactionRequest(interaction, false)).toContain("dark mode");
  }
  expect(interactionRequest(interactions[2]!, true)).toBe(
    "Open settings in chat",
  );
});
