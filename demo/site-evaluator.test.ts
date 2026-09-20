import { expect, it, vi } from "vitest";
import { createSiteEvaluator } from "./site-evaluator.js";

it("disables ZDR for site calls through the SDK transport while preserving request bounds", async () => {
  const transport = vi.fn().mockResolvedValue({ answers: {} });
  const signal = new AbortController().signal;
  const run = createSiteEvaluator({ model: "test-model", evaluate: transport });
  await run({ state: { page: "marketing" }, questions: {}, signal });
  expect(transport).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      model: "test-model",
      state: { page: "marketing" },
      questions: {},
      abortSignal: signal,
      maxRetries: 0,
      providerOptions: { gateway: { zeroDataRetention: false } },
    }),
  );
});
