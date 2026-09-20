import { createSiteEvaluator } from "./site-evaluator.js";
import {
  type EvaluatorOptions,
  type EvaluationOptions,
} from "@mossburgh/waymode/server";

export const demoModel = process.env.WAYMODE_MODEL ?? "";

// Model choice belongs to the host environment.
export const demoEvaluationOptions = (
  options: Partial<EvaluatorOptions> & Omit<EvaluationOptions, "evaluate"> = {},
): EvaluationOptions => ({
  ...options,
  evaluate: createSiteEvaluator({
    model: demoModel,
    ...options,
  }),
});
