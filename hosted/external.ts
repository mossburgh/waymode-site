import {
  createWaymode,
  createRemoteSurface,
  StaleActionError,
  ActionBlockedError,
  type ExecutionReceipt,
} from "@mossburgh/waymode/core";
import type { Decision } from "@mossburgh/waymode";
import { decisionRequestSchema } from "@mossburgh/waymode/server";
import { z } from "zod";
import { readJson, json, HttpError } from "./http.js";
const postFor =
  (
    request: Request,
    signal: AbortSignal,
    send: (request: Request) => Promise<Response>,
  ) =>
  async (path: string, input: unknown, abort = signal): Promise<unknown> => {
    const origin = new URL(request.url).origin;
    const response = await send(
      new Request(origin + path, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: origin,
          Cookie: request.headers.get("Cookie") ?? "",
          "X-Waymode-Request-ID":
            request.headers.get("X-Waymode-Request-ID") ?? crypto.randomUUID(),
          "CF-Connecting-IP":
            request.headers.get("CF-Connecting-IP") ?? "local",
        },
        body: JSON.stringify(input),
        signal: abort,
      }),
    );
    const result: unknown = await response.json();
    if (response.ok) {
      return result;
    }
    return throwFailure(result, response.status);
  };
export const externalAgent = async (
  request: Request,
  send: (request: Request) => Promise<Response>,
) => {
  if (request.method !== "POST") {
    throw new HttpError(405, "Use POST.");
  }
  const { goal } = z
    .strictObject({ goal: z.string().trim().min(1).max(2000) })
    .parse(await readJson(request));
  const started = performance.now();
  const signal = AbortSignal.any([request.signal, AbortSignal.timeout(25000)]);
  const post = postFor(request, signal, send);
  const { session } = z
    .object({ session: z.uuid() })
    .parse(await post("/api/v1/actions/start", { goal }));
  const surface = createRemoteSurface((operation, data, abort) =>
    post("/api/v1/actions", { session, operation, data }, abort),
  );
  const { agent, decisions, receipts } = agentFor(surface, post);
  const result = await agent.run(goal, {
    signal,
    maxSteps: 8,
    onDecision: (value) => {
      decisions.push(value);
    },
    onReceipt: (value) => {
      receipts.push(value);
    },
  });
  return json({
    result,
    decisions,
    receipts,
    elapsedMs: performance.now() - started,
    transport: "server-side agent → authenticated HTTP → app session",
  });
};

const agentFor = (
  surface: ReturnType<typeof createRemoteSurface>,
  post: ReturnType<typeof postFor>,
) => {
  const decisions: Decision[] = [];
  const receipts: ExecutionReceipt[] = [];
  const agent = createWaymode({
    surface,
    decide: async (input, abort) =>
      (await post(
        "/api/v1/decisions",
        decisionRequestSchema.parse(input),
        abort,
      )) as Decision,
  });
  return { agent, decisions, receipts };
};

const throwFailure = (result: unknown, status: number): never => {
  const reason = z.object({ reason: z.string().optional() }).safeParse(result);
  const value = reason.success ? reason.data.reason : undefined;
  if (value === "stale") {
    throw new StaleActionError("Observe again.");
  }
  if (
    value === "denied" ||
    value === "confirmation-required" ||
    value === "abstained"
  ) {
    throw new ActionBlockedError(value);
  }
  throw new HttpError(status, "The app rejected the agent request.");
};
