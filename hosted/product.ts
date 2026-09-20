import { playbackSnapshot } from "../demo/playback-snapshot.js";
import { z } from "zod";
import * as base from "../demo/product-contract.js";
import { compileFeature, featureDefinition } from "../demo/showcase-feature.js";
import type { Store, Visitor } from "./store.js";
import type { Events } from "./events.js";
import { HttpError } from "./http.js";
export class Product {
  constructor(
    private store: Store,
    private events: Events,
  ) {}
  contract(visitor: Visitor) {
    return compileFeature(base, visitor.feature);
  }
  feature(visitor: Visitor, input: unknown) {
    visitor.feature = featureDefinition.nullable().parse(input);
    visitor.app.preferences = { dark: visitor.app.preferences.dark === true };
    if (visitor.feature) {
      visitor.app.preferences[visitor.feature.field] = false;
    }
    this.store.save(visitor);
    this.events.emit(visitor, "feature", {
      definition: visitor.feature,
      message: "App contract compiled. SDK unchanged.",
    });
    return { definition: visitor.feature };
  }
  restore(visitor: Visitor, input: unknown) {
    const snapshot = playbackSnapshot.parse(input);
    visitor.app = snapshot.state;
    visitor.feature = snapshot.feature;
    this.store.save(visitor);
    this.events.emit(visitor, "playback.reset", {
      message: "Scene restored for playback.",
    });
    return { restored: true };
  }
  dispatch(visitor: Visitor, path: string, method: string, input?: unknown) {
    // Refresh saved state before every operation; an action can outlive a UI edit.
    const saved = this.store.read<Visitor>(`visitor:${visitor.id}`);
    if (!saved) {
      throw new HttpError(401, "Reload the demo to start a new session.");
    }
    const started = performance.now();
    const app = saved.app;
    if (method === "PATCH" && path === "/api/v1/product") {
      const patch = this.contract(saved).patch.parse(input);
      Object.assign(app.preferences, patch.preferences);
      Object.assign(app.completed, patch.completed);
      if (app.archived.some((id) => !app.completed[id])) {
        throw new HttpError(400, "Archived tasks must stay completed.");
      }
    } else if (
      method === "POST" &&
      path === "/api/v1/product/archive-completed"
    ) {
      app.archived = z
        .enum(["notes", "draft", "week"])
        .options.filter((id) => app.completed[id]);
    } else if (method !== "GET" || path !== "/api/v1/product") {
      throw new HttpError(404, "Unknown product operation.");
    }
    this.store.save(saved);
    this.events.emit(visitor, "network", {
      method,
      path,
      status: 200,
      elapsedMs: performance.now() - started,
      ...(input !== undefined && { input }),
      saved: app,
    });
    return app;
  }
}
