import { AsyncLocalStorage } from "node:async_hooks";
const scope = new AsyncLocalStorage<string>();
export const inRequestScope = <T>(request: Request, run: () => T) =>
  scope.run(
    request.headers.get("X-Waymode-Request-ID") ?? crypto.randomUUID(),
    run,
  );
const routes = new Set([
  "session",
  "trace",
  "feature",
  "product",
  "product/archive-completed",
  "openapi",
  "decisions",
  "presentation",
  "actions",
  "actions/start",
  "playback/reset",
  "external",
  "analytics-config",
]);

export function logRequest(
  request: Request,
  response: Response,
  started: number,
) {
  const path = new URL(request.url).pathname.replace(/^\/api\/v1\//, "");
  const requestId =
    request.headers.get("X-Waymode-Request-ID") ?? crypto.randomUUID();
  const observed = new Response(response.body, response);
  observed.headers.set("X-Request-ID", requestId);
  console.info({
    event: "api_request",
    requestId,
    route: routes.has(path) ? path : "unknown",
    method: ["GET", "POST", "PUT", "PATCH"].includes(request.method)
      ? request.method
      : "other",
    status: response.status,
    durationMs: Math.round(performance.now() - started),
    rateLimited: response.status === 429,
  });
  return observed;
}

export function logModel(usage: {
  elapsedMs: number;
  inputTokens?: number | undefined;
  outputTokens?: number | undefined;
  costUsd?: number | undefined;
  marketCostUsd?: number | undefined;
}) {
  console.info({
    event: "model_usage",
    requestId: scope.getStore(),
    durationMs: Math.round(usage.elapsedMs),
    inputTokens: usage.inputTokens ?? null,
    outputTokens: usage.outputTokens ?? null,
    costUsd: usage.costUsd ?? null,
    marketCostUsd: usage.marketCostUsd ?? null,
    costKnown: usage.costUsd !== undefined,
  });
}
export function logModelError(aborted: boolean) {
  console.warn({ event: "model_error", requestId: scope.getStore(), aborted });
}
