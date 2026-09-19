import {
  createRemoteSurface,
  createWaymode,
  ActionBlockedError,
  StaleActionError,
} from "@mossburgh/waymode/core";
import { decisionRequestSchema } from "@mossburgh/waymode/server";
import { z } from "zod";

let input = "";
for await (const chunk of process.stdin) {
  input += chunk;
}
const { origin, cookie, goal } = z
  .strictObject({
    origin: z.literal("http://localhost:" + process.env.PORT),
    cookie: z.string().max(4096),
    goal: z.string().min(1).max(2000),
  })
  .parse(JSON.parse(input));
const signal = AbortSignal.timeout(25_000);
const post = async (path, data, abort = signal) => {
  const response = await fetch(origin + path, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: cookie,
    },
    body: JSON.stringify(data),
    signal: abort,
  });
  const result = await response.json();
  if (response.ok) {
    return result;
  }
  if (result.reason === "stale") {
    throw new StaleActionError("The app changed; observe again.");
  }
  if (
    ["denied", "confirmation-required", "abstained"].includes(result.reason)
  ) {
    throw new ActionBlockedError(result.reason);
  }
  throw new Error("The app rejected the request.");
};
const started = performance.now();
const { session } = await post("/api/v1/actions/start", { goal });
const surface = createRemoteSurface((operation, data, abort) =>
  post("/api/v1/actions", { session, operation, data }, abort),
);
const decisions = [];
const receipts = [];
const agent = createWaymode({
  surface,
  decide: (request, abort) =>
    post("/api/v1/decisions", decisionRequestSchema.parse(request), abort),
});
const result = await agent.run(goal, {
  signal,
  maxSteps: 8,
  onDecision: (decision) => decisions.push(decision),
  onReceipt: (receipt) => receipts.push(receipt),
});
process.stdout.write(
  JSON.stringify({
    result,
    decisions,
    receipts,
    elapsedMs: performance.now() - started,
    transport: "separate Node process → authenticated HTTP → app session",
  }),
);
