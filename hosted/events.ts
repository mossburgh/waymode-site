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
  clients: Set<ReadableStreamDefaultController<Uint8Array>>;
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
        clients: new Set(),
      };
      this.logs.set(visitor.id, log);
    }
    return log;
  }
  prune() {
    for (const [id, log] of this.logs) {
      if (log.expires <= Date.now()) {
        for (const client of log.clients) {
          client.close();
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
    for (const client of log.clients) {
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
        log.clients.add(controller);
        const timer = setTimeout(() => {
          log.clients.delete(controller);
          controller.close();
        }, 60000);
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
        "Cache-Control": "no-store",
      },
    });
  }
}
