import { usageLabel } from "./model-usage.js";
import { z } from "zod";

const eventSchema = z.object({
  stream: z.string(),
  id: z.number().int(),
  kind: z.string(),
  at: z.number().optional(),
  data: z.record(z.string(), z.unknown()),
});
const labels: Record<string, (data: Record<string, unknown>) => string> = {
  network: (data) =>
    `${String(data.method)} ${String(data.path)} → ${String(data.status)}`,
  policy: (data) =>
    `${String(data.method)} ${String(data.path)} → ${String(data.result)}`,
  feature: (data) => String(data.message),
  "model.receipt": (data) =>
    `${typeof data.outcome === "string" ? data.outcome : "Input binding"} · ${Number(data.elapsedMs).toFixed(0)}ms`,
  "model.usage": usageLabel,
  "model.error": () => "Model request failed; cost unknown",
  external: () => "External process returned; expand for actions and results",
};

export const createTraceState = (since = 0) => {
  const sequences = new Map<string, number>();
  let cost = 0;
  let unknown = 0;
  let calls = 0;
  let marketCost = 0;
  let marketUnknown = 0;
  return (input: unknown) => {
    const event = eventSchema.parse(input);
    if ((event.at ?? 0) < since) {
      return;
    }
    if (event.id <= (sequences.get(event.stream) ?? 0)) {
      return;
    }
    sequences.set(event.stream, event.id);
    if (event.kind === "model.usage") {
      calls++;
      if (typeof event.data.marketCostUsd === "number") {
        marketCost += event.data.marketCostUsd;
      } else {
        marketUnknown++;
      }
      if (typeof event.data.costUsd === "number") {
        cost += event.data.costUsd;
      } else {
        unknown++;
      }
    }
    if (event.kind === "model.error") {
      unknown++;
    }
    const label = labels[event.kind]?.(event.data);
    return { ...event, label, cost, unknown, calls, marketCost, marketUnknown };
  };
};
