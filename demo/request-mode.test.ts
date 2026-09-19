import { expect, it } from "vitest";
import type { Decision } from "@mossburgh/waymode";
import { presentationMode, presentationRequest } from "./request-mode.js";

const choice = (target: string): Decision => ({
  target,
  outcome: "selected",
  probability: 0.67,
  model: "test",
  elapsedMs: 1,
  costSource: "unavailable",
});
it.each(["act", "guide"] as const)(
  "uses the model's %s presentation without matching phrases",
  (target) => {
    expect(presentationMode(choice(target))).toBe(target);
    expect(presentationRequest("An unseen wording").request).toBe(
      "An unseen wording",
    );
  },
);
it("rejects missing and unknown presentation choices", () => {
  expect(() =>
    presentationMode({ ...choice("guide"), outcome: "abstained" }),
  ).toThrow("show you how");
  expect(() => presentationMode(choice("invented"))).toThrow("show you how");
});
