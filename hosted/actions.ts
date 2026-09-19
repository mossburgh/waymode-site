import {
  createOpenApiSurface,
  createSurfaceSession,
} from "@mossburgh/waymode/server";
import { z } from "zod";
import type { Visitor, Store } from "./store.js";
import type { Product } from "./product.js";
import type { Models } from "./model.js";
import type { Events } from "./events.js";
import { StaleActionError } from "@mossburgh/waymode/core";
export class Actions {
  private sessions = new Map<
    string,
    {
      owner: string;
      expires: number;
      run: ReturnType<typeof createSurfaceSession>;
    }
  >();
  constructor(
    private store: Store,
    private product: Product,
    private models: Models,
    private events: Events,
  ) {}
  retire(owner: string) {
    for (const [key, value] of this.sessions) {
      if (value.owner === owner || value.expires <= Date.now()) {
        this.sessions.delete(key);
      }
    }
  }
  private fresh(visitor: Visitor) {
    const current = this.store.read<Visitor>(`visitor:${visitor.id}`);
    if (!current) {
      throw new StaleActionError("Session expired.");
    }
    return current;
  }
  start(visitor: Visitor, ip: string, goal: string) {
    this.retire(visitor.id);
    const fresh = () => this.fresh(visitor);
    const resolve = this.models.resolver(visitor, ip);
    const surface = createOpenApiSurface({
      document: async () => this.product.contract(fresh()).document,
      readState: async () => fresh().app,
      authorize: async (call) => {
        const allowed =
          (call.path === "/api/v1/daylist" && call.method === "PATCH") ||
          (call.path === "/api/v1/daylist/archive-completed" &&
            call.method === "POST");
        const result = allowed ? "allow" : "deny";
        this.events.emit(visitor, "policy", {
          method: call.method,
          path: call.path,
          result,
        });
        return result;
      },
      resolveInput: (operation, signal) =>
        resolve(
          { goal: operation.goal, schema: z.json().parse(operation.schema) },
          signal,
        ),
      dispatch: async (call) =>
        this.product.dispatch(fresh(), call.path, call.method, call.input),
    });
    const session = crypto.randomUUID();
    this.sessions.set(session, {
      owner: visitor.id,
      expires: Date.now() + 120000,
      run: createSurfaceSession(surface, goal),
    });
    return { session };
  }
  async use(visitor: Visitor, input: unknown, signal: AbortSignal) {
    const { session, ...operation } = z
      .object({ session: z.uuid() })
      .passthrough()
      .parse(input);
    const entry = this.sessions.get(session);
    if (!entry || entry.owner !== visitor.id || entry.expires <= Date.now()) {
      throw new StaleActionError("Observe the product again.");
    }
    return entry.run(operation, signal);
  }
}
