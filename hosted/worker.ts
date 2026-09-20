import { BotCheck, requireVerification } from "./bot-check.js";
import { analyticsConfig, type AnalyticsEnv } from "./analytics-config.js";
import type { DurableObjectState } from "@cloudflare/workers-types";
import { siteDecision } from "./decisions.js";
import { ActionBlockedError, StaleActionError } from "@mossburgh/waymode/core";
import { z } from "zod";
import { Store, type Visitor } from "./store.js";
import { Events } from "./events.js";
import { Models, type ModelEnv } from "./model.js";
import { Product } from "./product.js";
import { Actions } from "./actions.js";
import { json, readJson, errorResponse, HttpError } from "./http.js";
import { presentationRequest, presentationMode } from "../demo/request-mode.js";
import { externalAgent } from "./external.js";
import { logRequest, inRequestScope } from "./telemetry.js";
import { networkId, networkKey } from "./ip.js";
type Env = ModelEnv &
  AnalyticsEnv & {
    API_LIMITER: {
      limit(options: { key: string }): Promise<{ success: boolean }>;
    };
    SHOWCASE: {
      getByName(name: string): { fetch(request: Request): Promise<Response> };
    };
  };
const goalSchema = z.strictObject({ goal: z.string().trim().min(1).max(2000) });
export default {
  async fetch(request: Request, env: Env) {
    request = new Request(request);
    request.headers.set("X-Waymode-Request-ID", crypto.randomUUID());
    const started = performance.now();
    const response = await handleRequest(request, env);
    return logRequest(request, response, started);
  },
};
function checkOrigin(request: Request, url: URL) {
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (
    fetchSite === "cross-site" ||
    fetchSite === "same-site" ||
    (origin && origin !== url.origin) ||
    (request.method !== "GET" && origin !== url.origin)
  ) {
    throw new HttpError(403, "Use the demo on this site.");
  }
  if (
    url.pathname === "/api/v1/session" &&
    fetchSite !== "same-origin" &&
    origin !== url.origin
  ) {
    throw new HttpError(403, "Start the demo on this site.");
  }
}
async function handleRequest(request: Request, env: Env) {
  try {
    const url = new URL(request.url);
    checkOrigin(request, url);
    const edgeLimit = await env.API_LIMITER.limit({
      key: networkKey(request.headers.get("CF-Connecting-IP") ?? "local"),
    });
    if (!edgeLimit.success) {
      throw new HttpError(
        429,
        "Too many requests. Please try again later.",
        60,
      );
    }
    if (
      url.pathname === "/api/v1/analytics-config" &&
      request.method === "GET"
    ) {
      return json(analyticsConfig(env));
    }
    if (url.pathname === "/api/v1/external") {
      return await externalAgent(request, (next) =>
        env.SHOWCASE.getByName("public-demo-v1").fetch(next),
      );
    }
    return await env.SHOWCASE.getByName("public-demo-v1").fetch(request);
  } catch (error) {
    return errorResponse(error);
  }
}
export class Showcase {
  private store: Store;
  private events = new Events();
  private models: Models;
  private bot: BotCheck;
  private product: Product;
  private actions: Actions;
  constructor(
    private ctx: DurableObjectState,
    env: ModelEnv,
  ) {
    this.store = new Store(ctx.storage.sql, env);
    this.bot = new BotCheck(env, this.store);
    this.models = new Models(env, this.store, this.events);
    this.product = new Product(this.store, this.events);
    this.actions = new Actions(
      this.store,
      this.product,
      this.models,
      this.events,
    );
  }
  async alarm() {
    this.store.prune();
    this.events.prune();
  }
  private async session(request: Request, ip: string) {
    const existing = this.store.visitor(request.headers.get("Cookie"));
    const visitor = existing ?? this.store.create(ip);
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`trace:${visitor.id}`),
    );
    const channel = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const response = json({
      traceChannel: `product-${channel}`,
      verification: this.bot.config(visitor, ip),
    });
    if (existing) {
      return response;
    }
    response.headers.set(
      "Set-Cookie",
      `__Host-waymode_session=${visitor.id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`,
    );
    return response;
  }
  fetch(request: Request) {
    return inRequestScope(request, () => this.handle(request));
  }
  private async handle(request: Request) {
    try {
      this.store.prune();
      this.events.prune();
      const ip = networkId(
        request.headers.get("CF-Connecting-IP") ?? "local",
        this.store.networkSecret(),
      );
      this.store.request(ip);
      this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 3600000));
      const route = `${request.method} ${new URL(request.url).pathname}`;
      if (route === "GET /api/v1/session") {
        return this.session(request, ip);
      }
      const visitor = this.store.visitor(request.headers.get("Cookie"));
      if (!visitor) {
        throw new HttpError(401, "Reload the demo to start a new session.");
      }
      if (route === "GET /api/v1/trace") {
        this.store.take(`trace:${visitor.id}`, 12, 60000);
      }
      return await this.route(request, route, visitor, ip);
    } catch (error) {
      if (error instanceof StaleActionError) {
        return json({ reason: "stale" }, 409);
      }
      if (error instanceof ActionBlockedError) {
        return json({ reason: error.reason }, 409);
      }
      return errorResponse(error);
    }
  }
  private async route(
    request: Request,
    route: string,
    visitor: Visitor,
    ip: string,
  ): Promise<Response> {
    const read = this.readRoute(route, visitor);
    if (read) {
      return read;
    }
    const input = await readJson(request);
    const current = this.store.read<Visitor>(`visitor:${visitor.id}`);
    if (!current) {
      throw new HttpError(401, "Reload the demo to start a new session.");
    }
    visitor = current;
    if (route === "POST /api/v1/verify") {
      await this.bot.verify(
        visitor,
        ip,
        request.headers.get("CF-Connecting-IP"),
        input,
        request.signal,
      );
      return json({ verified: true });
    }
    if (
      [
        "POST /api/v1/decisions",
        "POST /api/v1/presentation",
        "POST /api/v1/actions/start",
        "POST /api/v1/actions",
      ].includes(route)
    ) {
      requireVerification(this.store, visitor, ip);
    }
    return this.writeRoute(request, route, visitor, ip, input);
  }
  private async writeRoute(
    request: Request,
    route: string,
    visitor: Visitor,
    ip: string,
    input: unknown,
  ): Promise<Response> {
    if (route === "POST /api/v1/playback/reset") {
      this.actions.retire(visitor.id);
      return json(this.product.restore(visitor, input));
    }
    if (route === "PUT /api/v1/feature") {
      this.actions.retire(visitor.id);
      return json(this.product.feature(visitor, input));
    }
    if (
      route === "PATCH /api/v1/product" ||
      route === "POST /api/v1/product/archive-completed"
    ) {
      return this.mutateProduct(request, visitor, input);
    }
    if (route === "POST /api/v1/actions/start") {
      return json(
        this.actions.start(visitor, ip, goalSchema.parse(input).goal),
      );
    }
    if (route === "POST /api/v1/actions") {
      return json(await this.actions.use(visitor, input, request.signal));
    }
    return this.modelRoute(request, route, visitor, ip, input);
  }
  private mutateProduct(request: Request, visitor: Visitor, input: unknown) {
    const path = new URL(request.url).pathname;
    return json(this.product.dispatch(visitor, path, request.method, input));
  }
  private async modelRoute(
    request: Request,
    route: string,
    visitor: Visitor,
    ip: string,
    input: unknown,
  ) {
    if (route === "POST /api/v1/decisions") {
      const scoped = await siteDecision(
        input,
        visitor,
        this.product,
        request.signal,
      );
      const result = await this.models.decider(visitor, ip)(
        scoped.request,
        request.signal,
      );
      return json({
        ...result,
        ...(result.target && { target: scoped.handles.get(result.target) }),
      });
    }
    if (route === "POST /api/v1/presentation") {
      const result = await this.models.decider(
        visitor,
        ip,
        true,
      )(presentationRequest(goalSchema.parse(input).goal), request.signal);
      return json({ mode: presentationMode(result) });
    }
    throw new HttpError(404, "Unknown demo endpoint.");
  }
  private readRoute(route: string, visitor: Visitor) {
    if (route === "GET /api/v1/trace") {
      return this.events.watch(visitor);
    }
    if (route === "GET /api/v1/feature") {
      return json({ active: true, definition: visitor.feature });
    }
    if (route === "GET /api/v1/openapi") {
      return json(this.product.contract(visitor).document);
    }
    if (route === "GET /api/v1/product") {
      return json(this.product.dispatch(visitor, "/api/v1/product", "GET"));
    }
    return undefined;
  }
}
