import type { SqlStorage } from "@cloudflare/workers-types";
import { HttpError } from "./http.js";
import type { FeatureDefinition } from "../demo/showcase-feature.js";
import type { ProductState } from "../demo/product-store.js";
import { modelLimits, type LimitsEnv } from "./limits.js";

export type Visitor = {
  id: string;
  expires: number;
  feature: FeatureDefinition | null;
  app: ProductState;
};
export class Store {
  private nextPrune = 0;
  constructor(
    private sql: SqlStorage,
    private env: LimitsEnv = {},
  ) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)",
    );
    sql.exec("CREATE INDEX IF NOT EXISTS records_expiry ON records (expires)");
  }
  read<T>(key: string): T | undefined {
    const row = this.sql
      .exec<{ value: string }>(
        "SELECT value FROM records WHERE key = ? AND expires > ?",
        key,
        Date.now(),
      )
      .toArray()[0];
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  write(key: string, value: unknown, expires: number) {
    this.sql.exec(
      "INSERT OR REPLACE INTO records VALUES (?, ?, ?)",
      key,
      JSON.stringify(value),
      expires,
    );
  }
  prune() {
    if (Date.now() < this.nextPrune) {
      return;
    }
    this.nextPrune = Date.now() + 30000;
    this.sql.exec("DELETE FROM records WHERE expires <= ?", Date.now());
  }
  networkSecret() {
    const day = Math.floor(Date.now() / 86400000);
    const key = `network-secret:${day}`;
    let secret = this.read<string>(key);
    if (!secret) {
      secret = crypto.randomUUID() + crypto.randomUUID();
      this.write(key, secret, (day + 1) * 86400000);
    }
    return secret;
  }
  private bucket(key: string, limit: number, window: number) {
    const slot = Math.floor(Date.now() / window);
    const scope = key.endsWith(":all") ? "shared" : "network";
    return {
      name: `quota:${slot}:${key}`,
      resource: key.split(":")[0]!,
      scope: key.startsWith("trace:") ? "session" : scope,
      limit,
      expires: (slot + 1) * window,
    };
  }
  private reserve(
    buckets: {
      name: string;
      limit: number;
      expires: number;
      resource: string;
      scope: string;
    }[],
  ) {
    const pending = buckets.map((bucket) => ({
      ...bucket,
      count: this.read<number>(bucket.name) ?? 0,
    }));
    const full = pending.find((bucket) => bucket.count >= bucket.limit);
    if (full) {
      console.info({
        event: "rate_limit",
        resource: full.resource,
        scope: full.scope,
        retryAfter: Math.max(1, Math.ceil((full.expires - Date.now()) / 1000)),
      });
      throw new HttpError(
        429,
        "Waymode’s usage limit is reached. Please try again later.",
        Math.max(1, Math.ceil((full.expires - Date.now()) / 1000)),
      );
    }
    for (const bucket of pending) {
      this.write(bucket.name, bucket.count + 1, bucket.expires);
    }
  }
  take(key: string, limit: number, window: number) {
    this.reserve([this.bucket(key, limit, window)]);
  }
  request(ip: string) {
    this.reserve([
      this.bucket("requests:all", 2400, 60000),
      this.bucket(`requests:${ip}`, 240, 60000),
    ]);
  }
  save(visitor: Visitor) {
    this.write(`visitor:${visitor.id}`, visitor, visitor.expires);
  }
  visitor(cookie: string | null) {
    const id = cookie?.match(
      /(?:^|;\s*)__Host-waymode_session=([a-f0-9-]{36})(?:;|$)/,
    )?.[1];
    return id ? this.read<Visitor>(`visitor:${id}`) : undefined;
  }
  create(ip: string) {
    this.reserve([
      this.bucket(`sessions:${ip}`, 5, 3600000),
      this.bucket("sessions:all", 500, 3600000),
    ]);
    const visitor: Visitor = {
      id: crypto.randomUUID(),
      expires: Date.now() + 3600000,
      feature: null,
      app: {
        archived: [],
        preferences: { dark: false },
        completed: { notes: false, draft: false, week: false },
      },
    };
    this.save(visitor);
    return visitor;
  }
  model(visitor: Visitor, ip: string) {
    const limits = modelLimits(this.env);
    this.reserve([
      this.bucket("model-burst:all", 60, 60000),
      this.bucket(`model-burst:ip:${ip}`, 12, 60000),
      this.bucket("models-hour:all", 150, 3600000),
      this.bucket("models:all", limits.daily, 86400000),
      this.bucket(`models:ip:${ip}`, limits.ip, 86400000),
      {
        name: `models:visitor:${visitor.id}`,
        resource: "models",
        scope: "session",
        limit: limits.visitor,
        expires: visitor.expires,
      },
    ]);
  }
}
