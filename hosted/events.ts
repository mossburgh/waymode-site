import { HttpError } from "./http.js";
import type { Visitor } from "./store.js";
type Log = {
  events: string[];
  bytes: number;
  sequence: number;
  stream: string;
  expires: number;
  clients: Map<ReadableStreamDefaultController<Uint8Array>, () => void>;
};
const encode = (value: string) => new TextEncoder().encode(value);
export class Events {
  private logs = new Map<string, Log>();
  private bytes = 0;
  private log(visitor: Visitor) {
    let log = this.logs.get(visitor.id);
    if (!log) {
      log = {
        events: [],
        bytes: 0,
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
        this.bytes -= log.bytes;
        this.logs.delete(id);
      }
    }
  }
  private retain(log: Log, wire: string) {
    log.events.push(wire);
    log.bytes += wire.length * 2;
    this.bytes += wire.length * 2;
    while (log.events.length > 100 || log.bytes > 256 * 1024) {
      this.dropFirst(log);
    }
    for (const candidate of this.logs.values()) {
      while (this.bytes > 8 * 1024 * 1024 && candidate.events.length) {
        this.dropFirst(candidate);
      }
    }
  }
  private dropFirst(log: Log) {
    const removed = log.events.shift();
    const bytes = (removed?.length ?? 0) * 2;
    log.bytes -= bytes;
    this.bytes -= bytes;
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
    this.retain(log, wire);
    const encoded = encode(`data: ${wire}\n\n`);
    for (const [client, close] of log.clients) {
      if ((client.desiredSize ?? 0) < encoded.byteLength) {
        close();
      } else {
        client.enqueue(encoded);
      }
    }
  }
  watch(visitor: Visitor) {
    const log = this.log(visitor);
    const total = [...this.logs.values()].reduce(
      (sum, item) => sum + item.clients.size,
      0,
    );
    if (log.clients.size >= 2 || total >= 100) {
      throw new HttpError(429, "Too many open activity streams.");
    }
    const stream = traceStream(log);
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

function traceStream(log: Log) {
  let close: (() => void) | undefined;
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        controller.enqueue(encode(": connected\n\n"));
        for (const event of log.events) {
          controller.enqueue(encode(`data: ${event}\n\n`));
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
    },
    new ByteLengthQueuingStrategy({ highWaterMark: 512 * 1024 }),
  );
}
