import { expect, it } from "vitest";
import { captureTimeline } from "./capture-timeline.mjs";

it("preserves elapsed time when CDP delivers frames out of order", () => {
  const frames = [
    { file: "app/00000.jpg", at: 900 },
    { file: "app/00001.jpg", at: 1_600 },
    { file: "app/00002.jpg", at: 1_300 },
    { file: "app/00003.jpg", at: 2_100 },
  ];
  const result = captureTimeline(frames, 1_000, 2_000);
  expect(result.map((frame) => frame.file)).toEqual([
    "app/00000.jpg",
    "app/00002.jpg",
    "app/00001.jpg",
  ]);
  expect(result.every((frame) => frame.duration > 0)).toBe(true);
  expect(result.reduce((sum, frame) => sum + frame.duration, 0)).toBeCloseTo(
    1,
    10,
  );
});

it("keeps the last delivered frame at an identical timestamp", () => {
  expect(
    captureTimeline(
      [
        { file: "inspector/00000.jpg", at: 1_000 },
        { file: "inspector/00001.jpg", at: 1_000 },
      ],
      1_000,
      2_000,
    ),
  ).toEqual([{ file: "inspector/00001.jpg", duration: 1 }]);
});

it("rejects missing pre-roll, invalid clocks, and paths outside the take", () => {
  expect(() => captureTimeline([], 1, 2)).toThrow();
  expect(() =>
    captureTimeline([{ file: "app/00000.jpg", at: NaN }], 1, 2),
  ).toThrow();
  expect(() =>
    captureTimeline([{ file: "../private.jpg", at: 1 }], 1, 2),
  ).toThrow();
});
