import { createSiteEvaluator } from "../demo/site-evaluator.js";
import { retryModel } from "./model-retry.js";
import { requireVerification, type BotEnv } from "./bot-check.js";
import {
  createDecider,
  createInputResolver,
  type EvaluationOptions,
} from "@mossburgh/waymode/server";
import type { Visitor, Store } from "./store.js";
import type { Events } from "./events.js";
import { modelUsage } from "../demo/model-usage.js";
import { z } from "zod";
import { HttpError } from "./http.js";
import type { LimitsEnv } from "./limits.js";
import { logModel, logModelError } from "./telemetry.js";
export type ModelEnv = LimitsEnv &
  BotEnv & {
    AI_GATEWAY_API_KEY: string;
    WAYMODE_MODEL: string;
    DEMO_ENABLED?: string;
  };
export class Models {
  private active = new Set<string>();
  constructor(
    private env: ModelEnv,
    private store: Store,
    private events: Events,
  ) {}
  private reserve(visitor: Visitor, ip: string) {
    if (
      this.env.DEMO_ENABLED !== "true" ||
      !this.env.AI_GATEWAY_API_KEY ||
      !this.env.WAYMODE_MODEL
    ) {
      throw new HttpError(503, "Live requests are temporarily unavailable.");
    }
    if (this.active.has(visitor.id) || this.active.size >= 4) {
      throw new HttpError(429, "Waymode is busy. Please try again.");
    }
    requireVerification(this.store, visitor, ip);
    this.store.model(visitor, ip);
    this.active.add(visitor.id);
  }
  private async evaluate(
    visitor: Visitor,
    options: Parameters<EvaluationOptions["evaluate"]>[0],
  ) {
    const started = performance.now();
    this.events.emit(visitor, "model.request", {
      model: this.env.WAYMODE_MODEL,
      state: options.state,
      questions: options.questions,
    });
    const evaluate = createSiteEvaluator({
      apiKey: this.env.AI_GATEWAY_API_KEY,
      model: this.env.WAYMODE_MODEL,
    });
    const result = await evaluate({
      ...options,
      signal: AbortSignal.any([options.signal, AbortSignal.timeout(20000)]),
    });
    const usage = modelUsage(
      result,
      options.state,
      performance.now() - started,
    );
    logModel(usage);
    this.events.emit(visitor, "model.usage", usage);
    this.events.emit(visitor, "model.answers", {
      answers: z.object({ answers: z.unknown() }).parse(result).answers,
    });
    return result;
  }
  private async attempt(
    visitor: Visitor,
    ip: string,
    options: Parameters<EvaluationOptions["evaluate"]>[0],
  ) {
    this.reserve(visitor, ip);
    try {
      return await this.evaluate(visitor, options);
    } catch (error) {
      logModelError(options.signal.aborted);
      console.warn({
        event: "model_failure_kind",
        name: error instanceof Error ? error.name : "Error",
        status:
          error instanceof Error &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
            ? error.statusCode
            : null,
      });
      this.events.emit(visitor, "model.error", {
        name: error instanceof Error ? error.name : "Error",
        cost: "unavailable",
      });
      throw error;
    } finally {
      this.active.delete(visitor.id);
    }
  }
  options(visitor: Visitor, ip: string): EvaluationOptions {
    return {
      evaluate: (options) =>
        retryModel(() => this.attempt(visitor, ip, options), options.signal),
    };
  }
  decider(visitor: Visitor, ip: string, presentation = false) {
    const decide = createDecider({
      ...this.options(visitor, ip),
      ...(presentation && { minimumProbability: 0.5 }),
    });
    return async (...args: Parameters<typeof decide>) => {
      const result = await decide(...args);
      this.events.emit(visitor, "model.receipt", result);
      return result;
    };
  }
  resolver(visitor: Visitor, ip: string) {
    const resolve = createInputResolver(this.options(visitor, ip));
    return async (...args: Parameters<typeof resolve>) => {
      const result = await resolve(...args);
      for (const receipt of result.receipts) {
        this.events.emit(visitor, "model.receipt", receipt);
      }
      return result;
    };
  }
}
