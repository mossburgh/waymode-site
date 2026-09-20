import { playbackSnapshot } from "./playback-snapshot.js";
import { modelUsage } from "./model-usage.js";
import { presentationRequest, presentationMode } from "./request-mode.js";
import { runExternalAgent } from "./external-agent.js";
import { compileFeature, createFeatureStore } from "./showcase-feature.js";
import { demoEvaluationOptions, demoModel } from "./model.js";
import { readFile, mkdir, appendFile, stat } from "node:fs/promises";
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { z } from "zod";
import { resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { experimental_evaluate as evaluate } from "ai";
import { createDaylistStore } from "./daylist-store.js";
import { trace, watchTrace } from "./trace.js";
import { createServer as createViteServer } from "vite";
import {
  createDecider,
  createInputResolver,
  createOpenApiSurface,
  createSurfaceSession,
  type BackendCall,
} from "@mossburgh/waymode/server";
import { ActionBlockedError, StaleActionError } from "@mossburgh/waymode/core";
import { decisionRequestSchema } from "@mossburgh/waymode/server";
import { createPasskeyStore } from "./passkeys.js";
import { createDemoSessions, type DemoSessionState } from "./session.js";

const port = Number(process.env.PORT ?? 4317);
const origin = `http://localhost:${port}`;
const directory = resolve(".demo-data");
const sessions = await createDemoSessions(directory);
const streams = new Map<ServerResponse, string>();
const passkeys = createPasskeyStore({ origin, directory });
const apiKey =
  process.env.AI_GATEWAY_API_KEY ?? process.env.VERCEL_AI_GATEWAY_API_KEY;
const features = createFeatureStore();
const daylist = createDaylistStore(resolve(directory, "daylist"));
const vite = await createViteServer({
  root: resolve("demo"),
  publicDir: resolve("public"),
  server: {
    middlewareMode: true,
    hmr: { host: "localhost", port: port + 10_000 },
    fs: { allow: [resolve("demo"), resolve("node_modules")] },
  },
  appType: "mpa",
});

const reply = (response: ServerResponse, status: number, data: unknown) => {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(data));
};

const body = async (request: IncomingMessage): Promise<unknown> => {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of request as AsyncIterable<Buffer>) {
    size += part.length;
    if (size > 65_536) {
      throw new Error("Request too large.");
    }
    parts.push(part);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown;
};

const session = (request: IncomingMessage, response: ServerResponse) => {
  const result = sessions.resolve(request.headers.cookie);
  if (result.setCookie) {
    response.setHeader("Set-Cookie", result.setCookie);
  }
  return result;
};

const source = async (file: string) => {
  const path = resolve(file);
  const contents = await readFile(path, "utf8");
  return {
    path: file,
    source: contents,
    changedAt: (await stat(path)).mtime.toISOString(),
    sha256: createHash("sha256").update(contents).digest("hex"),
  };
};
const watchSource = async (
  request: IncomingMessage,
  response: ServerResponse,
) => {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  const requested = new URL(request.url!, origin).searchParams;
  const files = {
    account: "demo/feature.ts",
    contract: "demo/daylist-contract.ts",
    feature: "demo/daylist-feature.ts",
  };
  const key = requested.get("file") ?? requested.get("app") ?? "feature";
  const file = files[key as keyof typeof files] ?? files.feature;
  response.write(`data: ${JSON.stringify(await source(file))}\n\n`);
  streams.set(response, file);
  request.on("close", () => {
    streams.delete(response);
  });
};
const broadcastSourceChange = async (path: string) => {
  const file = [
    "demo/feature.ts",
    "demo/daylist-feature.ts",
    "demo/daylist-contract.ts",
  ].find((file) => resolve(file) === path);
  if (!file) {
    return;
  }
  try {
    const event = `data: ${JSON.stringify(await source(file))}\n\n`;
    for (const [stream, watching] of streams) {
      if (watching === file) {
        stream.write(event);
      }
    }
  } catch {
    console.error("demo.source.read.failed");
  }
};
vite.watcher.on("change", (path) => {
  void broadcastSourceChange(path);
});

const evaluateTraced = async (
  state: DemoSessionState,
  options: Parameters<typeof evaluate>[0],
) => {
  trace(state, "model.request", {
    model: demoModel,
    state: options.state,
    questions: options.questions,
  });
  const started = performance.now();
  const result = await evaluate(options);
  trace(
    state,
    "model.usage",
    modelUsage(result, options.state, performance.now() - started),
  );
  trace(state, "model.answers", { answers: result.answers });
  return result;
};
const traceModelError = (state: DemoSessionState, error: unknown) => {
  trace(state, "model.error", {
    name: error instanceof Error ? error.name : "Unknown error",
    cost: "unavailable",
  });
};
const responseAbort = (response: ServerResponse) => {
  const controller = new AbortController();
  response.on("close", () => {
    if (!response.writableEnded) {
      controller.abort();
    }
  });
  return controller.signal;
};
const allowDecision = (response: ServerResponse, state: DemoSessionState) => {
  if (state.active || state.calls >= 100) {
    reply(response, 429, {
      error: "Demo call limit reached or a call is already active.",
    });
    return undefined;
  }
  if (!apiKey) {
    reply(response, 503, {
      error: "Set AI_GATEWAY_API_KEY in the server environment.",
    });
    return undefined;
  }
  return apiKey;
};
const decisionRoute = async (
  request: IncomingMessage,
  response: ServerResponse,
  state: DemoSessionState,
) => {
  const credential = allowDecision(response, state);
  if (!credential) {
    return;
  }
  state.active = true;
  const signal = responseAbort(response);
  try {
    const input = decisionRequestSchema.parse(await body(request));
    state.calls++;
    const decide = createDecider(
      demoEvaluationOptions({
        apiKey: credential,
        evaluate: (options) => evaluateTraced(state, options),
      }),
    );
    const result = await decide(input, signal);
    trace(state, "model.receipt", result);
    await mkdir(directory, { recursive: true });
    await appendFile(
      resolve(directory, "receipts.jsonl"),
      JSON.stringify({ at: new Date().toISOString(), ...result }) + "\n",
    );
    reply(response, 200, result);
  } catch (error) {
    traceModelError(state, error);
    throw error;
  } finally {
    state.active = false;
  }
};

const actionSessions = new Map<
  string,
  {
    owner: string;
    expires: number;
    execute: ReturnType<typeof createSurfaceSession>;
  }
>();
const pruneActions = (id: string) => {
  for (const [key, session] of actionSessions) {
    if (session.expires < Date.now() || session.owner === id) {
      actionSessions.delete(key);
    }
  }
  if (actionSessions.size >= 100) {
    throw new Error("Local demo action capacity reached.");
  }
};
const actionInputResolver = (state: DemoSessionState, apiKey: string) => {
  const resolveInput = createInputResolver(
    demoEvaluationOptions({
      apiKey,
      evaluate: async (options) => {
        if (state.calls++ >= 100) {
          throw new Error("Demo model limit reached.");
        }
        return evaluateTraced(state, options);
      },
    }),
  );
  return resolveInput;
};
const daylistContract = async (state: DemoSessionState) => {
  const base = (await vite.ssrLoadModule(
    "/daylist-contract.ts",
  )) as typeof import("./daylist-contract.js");
  return features.has(state)
    ? compileFeature(base, features.read(state))
    : base;
};
const resolveActionInput = async (
  resolveInput: ReturnType<typeof createInputResolver>,
  state: DemoSessionState,
  operation: { goal: string; schema: unknown },
  signal: AbortSignal,
) => {
  try {
    const result = await resolveInput(
      { goal: operation.goal, schema: z.json().parse(operation.schema) },
      signal,
    );
    for (const receipt of result.receipts) {
      trace(state, "model.receipt", receipt);
    }
    return result;
  } catch (error) {
    traceModelError(state, error);
    throw error;
  }
};
const dispatchAction = async (
  request: IncomingMessage,
  call: { path: string; method: string; input: unknown },
  signal: AbortSignal,
): Promise<unknown> => {
  const result = await fetch(origin + call.path, {
    method: call.method,
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
      Cookie: request.headers.cookie ?? "",
    },
    body: JSON.stringify(call.input),
    signal,
  });
  if (!result.ok) {
    throw new Error("The existing API rejected the operation.");
  }
  return result.json() as Promise<unknown>;
};
const authorizeAction = (state: DemoSessionState, call: BackendCall) => {
  const allowed =
    (call.path === "/api/v1/daylist" ||
      call.path.startsWith("/api/v1/daylist/")) &&
    ["PATCH", "POST"].includes(call.method);
  const result = allowed ? "allow" : "deny";
  trace(state, "policy", { method: call.method, path: call.path, result });
  return result;
};
const startActions = async (
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
  state: DemoSessionState,
) => {
  const { goal } = z
    .strictObject({ goal: z.string().trim().min(1).max(2000) })
    .parse(await body(request));
  if (!apiKey) {
    throw new Error("Configure the server model credential.");
  }
  pruneActions(id);
  const resolveInput = actionInputResolver(state, apiKey);
  const surface = createOpenApiSurface({
    document: async () => (await daylistContract(state)).document,
    readState: async () => daylist.read(id),
    authorize: async (call) => authorizeAction(state, call),
    resolveInput: (operation, signal) =>
      resolveActionInput(resolveInput, state, operation, signal),
    dispatch: (call, signal) => dispatchAction(request, call, signal),
  });
  const key = randomUUID();
  actionSessions.set(key, {
    owner: id,
    expires: Date.now() + 120_000,
    execute: createSurfaceSession(surface, goal),
  });
  reply(response, 200, { session: key });
};
const useActions = async (
  request: IncomingMessage,
  response: ServerResponse,
  id: string,
) => {
  const { session, ...input } = z
    .object({ session: z.uuid() })
    .passthrough()
    .parse(await body(request));
  const active = actionSessions.get(session);
  if (!active || active.owner !== id || active.expires < Date.now()) {
    reply(response, 409, { reason: "stale" });
    return;
  }
  const signal = responseAbort(response);
  try {
    const result = await active.execute(input, signal);
    reply(response, 200, result);
  } catch (error) {
    if (
      error instanceof ActionBlockedError ||
      error instanceof StaleActionError
    ) {
      reply(response, 409, {
        reason: error instanceof ActionBlockedError ? error.reason : "stale",
      });
    } else {
      throw error;
    }
  }
};

type ApiContext = {
  request: IncomingMessage;
  response: ServerResponse;
} & ReturnType<typeof session>;
const startActionRoute = async ({
  request,
  response,
  id,
  state,
  setCookie,
}: ApiContext) => {
  if (setCookie) {
    reply(response, 409, {
      reason: "session-created",
      error: "Read the session before starting actions.",
    });
    return;
  }
  await startActions(request, response, id, state);
};
const evalRoute = async ({ response }: ApiContext) => {
  try {
    reply(
      response,
      200,
      JSON.parse(
        await readFile(resolve(directory, "public-evals.json"), "utf8"),
      ),
    );
  } catch {
    reply(response, 404, { error: "No public eval run saved yet." });
  }
};
const archiveRoute = ({ request, response, id, state }: ApiContext) => {
  const started = performance.now();
  const saved = daylist.archiveCompleted(id);
  trace(state, "network", {
    method: request.method,
    path: "/api/v1/daylist/archive-completed",
    status: 200,
    elapsedMs: performance.now() - started,
    saved,
  });
  reply(response, 200, saved);
};
const daylistRoute = async ({ request, response, id, state }: ApiContext) => {
  const started = performance.now();
  const input = request.method === "PATCH" ? await body(request) : undefined;
  const contract = await daylistContract(state);
  const saved =
    request.method === "PATCH"
      ? daylist.patch(id, input, contract.patch)
      : daylist.read(id);
  trace(state, "network", {
    method: request.method,
    path: "/api/v1/daylist",
    status: 200,
    elapsedMs: performance.now() - started,
    ...(input !== undefined && { input }),
    saved,
  });
  reply(response, 200, saved);
};
const featureRoute = async ({ request, response, state, id }: ApiContext) => {
  const definition = features.write(state, await body(request));
  pruneActions(id);
  daylist.configureFeature(id, definition?.field);
  trace(state, "feature", {
    definition,
    message: "App contract compiled. SDK unchanged.",
  });
  reply(response, 200, { definition });
};
const externalRuns = new Set<DemoSessionState>();
const externalRoute = async ({ request, response, state }: ApiContext) => {
  const { goal } = z
    .strictObject({ goal: z.string().trim().min(1).max(2000) })
    .parse(await body(request));
  if (externalRuns.has(state) || externalRuns.size >= 4 || state.calls >= 100) {
    reply(response, 429, { error: "External agent capacity reached." });
    return;
  }
  externalRuns.add(state);
  try {
    const result = await runExternalAgent(
      { origin, cookie: request.headers.cookie ?? "", goal },
      responseAbort(response),
    );
    trace(state, "external", result);
    reply(response, 200, result);
  } finally {
    externalRuns.delete(state);
  }
};
const presentationRoute = async ({ request, response, state }: ApiContext) => {
  const credential = allowDecision(response, state);
  if (!credential) {
    return;
  }
  state.active = true;
  try {
    const { goal } = z
      .strictObject({ goal: z.string().trim().min(1).max(2000) })
      .parse(await body(request));
    state.calls++;
    const decide = createDecider(
      demoEvaluationOptions({
        apiKey: credential,
        // This vote chooses presentation only. Action thresholds and permissions stay unchanged.
        minimumProbability: 0.5,
        evaluate: (options) => evaluateTraced(state, options),
      }),
    );
    const result = await decide(
      presentationRequest(goal),
      responseAbort(response),
    );
    trace(state, "model.receipt", result);
    reply(response, 200, { mode: presentationMode(result) });
  } catch (error) {
    traceModelError(state, error);
    throw error;
  } finally {
    state.active = false;
  }
};
const routes: Record<string, (context: ApiContext) => void | Promise<void>> = {
  "POST /api/v1/playback/reset": async ({ request, response, state, id }) => {
    const snapshot = playbackSnapshot.parse(await body(request));
    pruneActions(id);
    features.write(state, snapshot.feature);
    daylist.restore(id, snapshot.state);
    trace(state, "playback.reset", { message: "Scene restored for playback." });
    reply(response, 200, { restored: true });
  },
  "POST /api/v1/presentation": presentationRoute,
  "POST /api/v1/external": externalRoute,
  "GET /api/v1/feature": ({ response, state }) =>
    reply(response, 200, {
      active: features.has(state),
      definition: features.read(state),
    }),
  "PUT /api/v1/feature": featureRoute,
  "POST /api/v1/actions/start": startActionRoute,
  "POST /api/v1/actions": ({ request, response, id }) =>
    useActions(request, response, id),
  "GET /api/v1/session": ({ response, id }) =>
    reply(response, 200, { traceChannel: `daylist-${id}` }),
  "GET /api/v1/trace": ({ state, response }) => watchTrace(state, response),
  "GET /api/v1/evals": evalRoute,
  "GET /api/v1/openapi": async ({ response, state }) => {
    reply(response, 200, (await daylistContract(state)).document);
  },
  "POST /api/v1/daylist/archive-completed": archiveRoute,
  "GET /api/v1/daylist": daylistRoute,
  "PATCH /api/v1/daylist": daylistRoute,
  "GET /api/v1/source": ({ request, response }) =>
    watchSource(request, response),
  "POST /api/v1/decisions": ({ request, response, state }) =>
    decisionRoute(request, response, state),
  "GET /api/v1/passkeys": async ({ response, id }) => {
    reply(response, 200, await passkeys.status(id));
  },
  "POST /api/v1/passkeys/options": async ({ response, id }) => {
    reply(response, 200, await passkeys.options(id));
  },
  "POST /api/v1/passkeys/verify": async ({ request, response, id }) => {
    reply(response, 200, await passkeys.verify(id, await body(request)));
  },
};
const sitePreview = async (response: ServerResponse) => {
  const source = await readFile(resolve("public/index.html"), "utf8");
  const html = source.replaceAll("/showcase/studio.html", "/studio.html");
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
};
const api = async (request: IncomingMessage, response: ServerResponse) => {
  const context = { request, response, ...session(request, response) };
  const handler = routes[`${request.method} ${request.url?.split("?")[0]}`];
  if (handler) {
    await handler(context);
    return;
  }
  reply(response, 404, { error: "Unknown demo endpoint." });
};
const hasInvalidBody = (request: IncomingMessage) => {
  const hasBody =
    request.headers["transfer-encoding"] ||
    Number(request.headers["content-length"] ?? 0) > 0;
  return (
    request.method !== "GET" &&
    (request.headers.origin !== origin ||
      (hasBody &&
        !request.headers["content-type"]?.startsWith("application/json")))
  );
};

const serveWebsite = (request: IncomingMessage, response: ServerResponse) => {
  const pathname = new URL(request.url ?? "/", origin).pathname;
  if (["/site", "/site/", "/index.html"].includes(pathname)) {
    response.writeHead(308, { Location: "/" });
    response.end();
    return true;
  }
  if (pathname === "/") {
    void sitePreview(response).catch(() =>
      reply(response, 404, { error: "Site preview unavailable." }),
    );
    return true;
  }
  return false;
};

const server = createServer((request, response) => {
  if (
    request.headers.host !== `localhost:${port}` ||
    (request.headers.origin && request.headers.origin !== origin)
  ) {
    reply(response, 403, { error: "Local same-origin requests only." });
    return;
  }
  if (serveWebsite(request, response)) {
    return;
  }
  if (!request.url?.startsWith("/api/")) {
    vite.middlewares(request, response);
    return;
  }
  if (hasInvalidBody(request)) {
    reply(response, 403, { error: "Send same-origin JSON." });
    return;
  }
  void api(request, response).catch((error) => {
    console.error(
      "demo.request.failed",
      error instanceof Error ? error.name : "Unknown error",
    );
    if (!response.headersSent) {
      reply(response, 400, {
        error: "The request failed. Check the local server.",
      });
    } else {
      response.end();
    }
  });
});
server.listen(port, "127.0.0.1", () => {
  console.info(`waymode: ${origin} (local demo only)`);
});
