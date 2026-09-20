import { HttpError } from "./http.js";
import type { Visitor } from "./store.js";
type Event = {
  id: number;
  stream: string;
  at: number;
  kind: string;
  data: unknown;
};
type Log = {
  events: Event[];
  sequence: number;
  stream: string;
  expires: number;
  clients: Map<ReadableStreamDefaultController<Uint8Array>, () => void>;
};
const encode = (value: string) => new TextEncoder().encode(value);
export class Events {
  private logs = new Map<string, Log>();
  private log(visitor: Visitor) {
    let log = this.logs.get(visitor.id);
    if (!log) {
      log = {
        events: [],
        sequence: 0,
        stream: crypto.randomUUID(),
        expires: visitor.expires,
        clients: new Map(),
      };
      this.logs.set(visitor.id, log);
    }
    return log;
  }
  prune() {
    for (const [id, log] of this.logs) {
      if (log.expires <= Date.now()) {
        for (const close of log.clients.values()) {
          close();
        }
        this.logs.delete(id);
      }
    }
  }
  emit(visitor: Visitor, kind: string, data: unknown) {
    const log = this.log(visitor);
    const event = {
      id: ++log.sequence,
      stream: log.stream,
      at: Date.now(),
      kind,
      data,
    };
    const wire = JSON.stringify(event);
    if (wire.length > 65536) {
      return;
    }
    log.events.push(event);
    if (log.events.length > 100) {
      log.events.shift();
    }
    for (const client of log.clients.keys()) {
      client.enqueue(encode(`data: ${wire}\n\n`));
    }
  }
  watch(visitor: Visitor) {
    const log = this.log(visitor);
    const total = [...this.logs.values()].reduce(
      (sum, item) => sum + item.clients.size,
      0,
    );
    if (log.clients.size >= 2 || total >= 100) {
      throw new HttpError(429, "Too many open demo streams.");
    }
    let close: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encode(": connected\n\n"));
        for (const event of log.events) {
          controller.enqueue(encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        const finish = () => {
          close?.();
          controller.close();
        };
        const timer = setTimeout(finish, 60000);
        log.clients.set(controller, finish);
        close = () => {
          clearTimeout(timer);
          log.clients.delete(controller);
        };
      },
      cancel() {
        close?.();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "X-Content-Type-Options": "nosniff",
        "Strict-Transport-Security": "max-age=31536000",
        "Cache-Control": "no-store",
      },
    });
  }
}
