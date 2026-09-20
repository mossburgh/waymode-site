import { experimental_evaluate as evaluate } from "ai";
import {
  createEvaluator,
  type EvaluatorOptions,
} from "@mossburgh/waymode/server";

export function createSiteEvaluator(options: EvaluatorOptions) {
  const transport = options.evaluate ?? evaluate;
  return createEvaluator({
    ...options,
    evaluate: (request) =>
      transport({
        ...request,
        providerOptions: {
          ...request.providerOptions,
          gateway: {
            ...request.providerOptions?.gateway,
            zeroDataRetention: false,
          },
        },
      }),
  });
}
