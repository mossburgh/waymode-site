import { z } from "zod";

const amount = z
  .union([z.number(), z.string().regex(/^\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i)])
  .transform(Number)
  .pipe(z.number().finite().nonnegative());
const optionalAmount = (value: unknown) => {
  const parsed = amount.safeParse(value);
  return parsed.success ? parsed.data : undefined;
};
const usageReply = z.object({
  response: z.object({ modelId: z.string() }).optional(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative().optional(),
      outputTokens: z.number().int().nonnegative().optional(),
    })
    .optional(),
  providerMetadata: z
    .object({
      gateway: z
        .object({
          cost: z.unknown().optional(),
          marketCost: z.unknown().optional(),
        })
        .optional(),
    })
    .optional(),
});
const requestState = z.object({
  originalRequest: z.string().optional(),
  goal: z.string().optional(),
  request: z.string().optional(),
  step: z.object({ goal: z.string().optional() }).optional(),
});
const requestGoal = (state: unknown) => {
  const parsed = requestState.safeParse(state);
  return parsed.success
    ? (parsed.data.originalRequest ??
        parsed.data.request ??
        parsed.data.step?.goal ??
        parsed.data.goal)
    : undefined;
};
export const modelUsage = (raw: unknown, state: unknown, elapsedMs: number) => {
  const reply = usageReply.parse(raw);
  return {
    request: requestGoal(state),
    model: reply.response?.modelId,
    elapsedMs,
    inputTokens: reply.usage?.inputTokens,
    outputTokens: reply.usage?.outputTokens,
    costUsd: optionalAmount(reply.providerMetadata?.gateway?.cost),
    marketCostUsd: optionalAmount(reply.providerMetadata?.gateway?.marketCost),
  };
};
export const formatCharge = (value: unknown) => {
  const cost = optionalAmount(value);
  if (cost === undefined) {
    return "unknown";
  }
  return cost > 0 && cost < 0.00000001 ? "<$0.00000001" : `$${cost.toFixed(8)}`;
};
const textValue = (value: unknown, fallback: string) =>
  typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
export const usageLabel = (data: Record<string, unknown>) =>
  `${textValue(data.request, "Model call")} · ${textValue(data.model, "Model")} · ${Number(data.elapsedMs).toFixed(0)}ms · ${textValue(data.inputTokens, "?")} in / ${textValue(data.outputTokens, "?")} out · ${formatCharge(data.costUsd)} Gateway · ${formatCharge(data.marketCostUsd)} market`;
