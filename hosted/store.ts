import type { SqlStorage } from "@cloudflare/workers-types";
import { HttpError } from "./http.js";
import type { FeatureDefinition } from "../demo/showcase-feature.js";
import type { DaylistState } from "../demo/daylist-store.js";

export type Visitor = {
  id: string;
  expires: number;
  feature: FeatureDefinition | null;
  app: DaylistState;
};
export class Store {
  constructor(private sql: SqlStorage) {
    sql.exec(
      "CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires INTEGER NOT NULL)",
    );
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
    this.sql.exec("DELETE FROM records WHERE expires <= ?", Date.now());
  }
  private bucket(key: string, limit: number, window: number) {
    const slot = Math.floor(Date.now() / window);
    return {
      name: `quota:${slot}:${key}`,
      limit,
      expires: (slot + 1) * window,
    };
  }
  private reserve(buckets: { name: string; limit: number; expires: number }[]) {
    const pending = buckets.map((bucket) => ({
      ...bucket,
      count: this.read<number>(bucket.name) ?? 0,
    }));
    if (pending.some((bucket) => bucket.count >= bucket.limit)) {
      throw new HttpError(
        429,
        "The shared demo limit is reached. Please try again later.",
      );
    }
    for (const bucket of pending) {
      this.write(bucket.name, bucket.count + 1, bucket.expires);
    }
  }
  take(key: string, limit: number, window: number) {
    this.reserve([this.bucket(key, limit, window)]);
  }
  save(visitor: Visitor) {
    this.write(`visitor:${visitor.id}`, visitor, visitor.expires);
  }
  visitor(cookie: string | null) {
    const id = cookie?.match(
      /(?:^|;\s*)waymode_session=([a-f0-9-]{36})(?:;|$)/,
    )?.[1];
    return id ? this.read<Visitor>(`visitor:${id}`) : undefined;
  }
  create(ip: string) {
    this.reserve([
      this.bucket(`sessions:${ip}`, 5, 3600000),
      this.bucket("sessions:all", 500, 86400000),
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
    this.reserve([
      this.bucket("models:all", 600, 86400000),
      this.bucket(`models:ip:${ip}`, 100, 86400000),
      {
        name: `models:visitor:${visitor.id}`,
        limit: 60,
        expires: visitor.expires,
      },
    ]);
  }
}
