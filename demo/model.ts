import {
  createEvaluator,
  type EvaluatorOptions,
  type EvaluationOptions,
} from "@mossburgh/waymode/server";

export const demoModel = process.env.WAYMODE_MODEL ?? "";

// Model choice belongs to the host environment.
export const demoEvaluationOptions = (
  options: Partial<EvaluatorOptions> & Omit<EvaluationOptions, "evaluate"> = {},
): EvaluationOptions => ({
  ...options,
  evaluate: createEvaluator({
    model: demoModel,
    ...options,
  }),
});
