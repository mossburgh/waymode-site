import { expect, it } from "vitest";
import { verifiedRun } from "./public-demo.mjs";

const abstained = {
  kind: "verified",
  data: {
    result: { reason: "abstained", actions: 0 },
    viewMatchesSaved: true,
  },
};

it("distinguishes correct abstention from a caught validation failure", () => {
  expect(verifiedRun([abstained], 0)).toBe(true);
  expect(
    verifiedRun([{ kind: "error", data: { error: "Invalid decision" } }], 0),
  ).toBe(false);
  expect(verifiedRun([abstained, { kind: "error" }], 0)).toBe(false);
  expect(
    verifiedRun(
      [
        {
          ...abstained,
          data: {
            ...abstained.data,
            result: { reason: "cancelled", actions: 0 },
          },
        },
      ],
      0,
    ),
  ).toBe(false);
  expect(
    verifiedRun(
      [
        { kind: "handler" },
        {
          kind: "verified",
          data: {
            result: { reason: "limit", actions: 1 },
            viewMatchesSaved: false,
          },
        },
      ],
      1,
    ),
  ).toBe(false);
});
