import type { DurableObjectState } from "@cloudflare/workers-types";
import { decisionRequestSchema } from "@mossburgh/waymode/server";
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
type Env = ModelEnv & {
  SHOWCASE: {
    getByName(name: string): { fetch(request: Request): Promise<Response> };
  };
};
const goalSchema = z.strictObject({ goal: z.string().trim().min(1).max(2000) });
const requestIp = async (request: Request) => {
  const day = Math.floor(Date.now() / 86400000);
  const bytes = new TextEncoder().encode(
    `${day}:${request.headers.get("CF-Connecting-IP") ?? "local"}`,
  );
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
};
export default {
  async fetch(request: Request, env: Env) {
    try {
      const url = new URL(request.url);
      const origin = request.headers.get("Origin");
      if (
        (origin && origin !== url.origin) ||
        (request.method !== "GET" && origin !== url.origin)
      ) {
        throw new HttpError(403, "Use the demo on this site.");
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
  },
};
export class Showcase {
  private store: Store;
  private events = new Events();
  private models: Models;
  private product: Product;
  private actions: Actions;
  constructor(
    private ctx: DurableObjectState,
    env: ModelEnv,
  ) {
    this.store = new Store(ctx.storage.sql);
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
  private session(request: Request, ip: string) {
    const existing = this.store.visitor(request.headers.get("Cookie"));
    if (existing) {
      return json({ traceChannel: `daylist-${existing.id}` });
    }
    const visitor = this.store.create(ip);
    const response = json({ traceChannel: `daylist-${visitor.id}` });
    response.headers.set(
      "Set-Cookie",
      `waymode_session=${visitor.id}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`,
    );
    return response;
  }
  async fetch(request: Request) {
    try {
      this.store.prune();
      this.events.prune();
      const ip = await requestIp(request);
      this.store.take(`requests:${ip}`, 240, 60000);
      const route = `${request.method} ${new URL(request.url).pathname}`;
      if (route === "GET /api/v1/session") {
        return this.session(request, ip);
      }
      const visitor = this.store.visitor(request.headers.get("Cookie"));
      if (!visitor) {
        throw new HttpError(401, "Reload the demo to start a new session.");
      }
      this.ctx.waitUntil(this.ctx.storage.setAlarm(Date.now() + 3600000));
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
    if (route === "POST /api/v1/playback/reset") {
      this.actions.retire(visitor.id);
      return json(this.product.restore(visitor, input));
    }
    if (route === "PUT /api/v1/feature") {
      this.actions.retire(visitor.id);
      return json(this.product.feature(visitor, input));
    }
    if (
      route === "PATCH /api/v1/daylist" ||
      route === "POST /api/v1/daylist/archive-completed"
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
      return json(
        await this.models.decider(visitor, ip)(
          decisionRequestSchema.parse(input),
          request.signal,
        ),
      );
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
    if (route === "GET /api/v1/daylist") {
      return json(this.product.dispatch(visitor, "/api/v1/daylist", "GET"));
    }
    return undefined;
  }
}
