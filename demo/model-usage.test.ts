import { expect, it } from "vitest";
import { modelUsage, formatCharge } from "./model-usage.js";

it("keeps Gateway charge and market cost separate without exposing provider metadata", () => {
  expect(
    modelUsage(
      {
        response: { modelId: "test/model" },
        usage: { inputTokens: 323, outputTokens: 31 },
        providerMetadata: {
          gateway: {
            cost: "0",
            marketCost: "0.000013566",
            generationId: "private",
          },
        },
      },
      { request: "Complete task" },
      123,
    ),
  ).toEqual({
    request: "Complete task",
    model: "test/model",
    elapsedMs: 123,
    inputTokens: 323,
    outputTokens: 31,
    costUsd: 0,
    marketCostUsd: 0.000013566,
  });
});
it.each([undefined, null, "", -1, Infinity])(
  "does not turn unknown or invalid cost %s into free usage",
  (cost) => {
    expect(formatCharge(cost)).toBe("unknown");
    expect(
      modelUsage({ providerMetadata: { gateway: { cost } } }, {}, 0).costUsd,
    ).toBeUndefined();
  },
);
it("preserves a positive tiny charge in the display", () => {
  expect(formatCharge(0.000000001)).toBe("<$0.00000001");
});

it("ties route assessment calls to the user's original request", () => {
  expect(
    modelUsage(
      {},
      { originalRequest: "Open Archive", goal: "Choose a route" },
      1,
    ).request,
  ).toBe("Open Archive");
});
