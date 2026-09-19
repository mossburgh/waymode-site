// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { StudioChapters } from "./studio-chapters.js";

afterEach(() => document.body.replaceChildren());
it("tracks chapter times, permits forward seeking, and resets between scenes", () => {
  document.body.innerHTML = '<nav id="chapters"></nav>';
  const review = vi.fn();
  const chapters = new StudioChapters(review);
  chapters.reset([
    { id: "ask", label: "Ask" },
    { id: "act", label: "Apply" },
    { id: "verify", label: "Verify" },
  ]);
  chapters.reach("ask", 1500);
  chapters.reach("verify", 4200);
  const buttons = document.querySelectorAll("button");
  expect(buttons[0]!.title).toBe("0:01 · Ask");
  expect(buttons[0]!.dataset.complete).toBe("true");
  expect(buttons[1]!.disabled).toBe(false);
  expect(buttons[2]!.getAttribute("aria-current")).toBe("step");
  buttons[0]!.click();
  expect(review).toHaveBeenCalledExactlyOnceWith("ask");
  chapters.reset([{ id: "write", label: "Write" }]);
  expect(document.querySelectorAll("button")).toHaveLength(1);
  expect(document.querySelector("button")!.disabled).toBe(false);
});

it("clears future progress when seeking backwards and supports unreached chapters", () => {
  document.body.innerHTML = '<nav id="chapters"></nav>';
  const seek = vi.fn();
  const chapters = new StudioChapters(seek);
  chapters.reset([
    { id: "ask", label: "Ask" },
    { id: "act", label: "Apply" },
    { id: "verify", label: "Verify" },
  ]);
  chapters.reach("ask", 0);
  chapters.reach("act", 2000);
  chapters.reach("verify", 4000);
  chapters.reach("ask", 0);
  const buttons = [...document.querySelectorAll("button")];
  expect(buttons.map((button) => button.dataset.complete)).toEqual([
    "false",
    "false",
    "false",
  ]);
  expect(buttons.map((button) => button.getAttribute("aria-current"))).toEqual([
    "step",
    "false",
    "false",
  ]);
  buttons[2]!.click();
  expect(seek).toHaveBeenCalledWith("verify");
});
