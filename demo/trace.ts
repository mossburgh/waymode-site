import { randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import type { DemoSessionState } from "./session.js";

export type TraceEvent = {
  id: number;
  stream: string;
  at: number;
  kind: string;
  data: unknown;
};
const logs = new WeakMap<
  DemoSessionState,
  {
    events: TraceEvent[];
    streams: Set<ServerResponse>;
    sequence: number;
    stream: string;
  }
>();
const log = (state: DemoSessionState) => {
  let value = logs.get(state);
  if (!value) {
    value = {
      events: [],
      streams: new Set(),
      sequence: 0,
      stream: randomUUID(),
    };
    logs.set(state, value);
  }
  return value;
};
export const trace = (state: DemoSessionState, kind: string, data: unknown) => {
  const value = log(state);
  const event: TraceEvent = {
    id: ++value.sequence,
    stream: value.stream,
    at: Date.now(),
    kind,
    data,
  };
  // Keep only bounded public demo payloads; never pass headers or provider objects.
  if (JSON.stringify(event).length > 65_536) {
    return;
  }
  value.events.push(event);
  if (value.events.length > 100) {
    value.events.shift();
  }
  for (const stream of value.streams) {
    stream.write(`data: ${JSON.stringify(event)}\n\n`);
  }
};
export const watchTrace = (
  state: DemoSessionState,
  response: ServerResponse,
) => {
  const value = log(state);
  if (value.streams.size >= 8) {
    response.writeHead(429).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  response.write(": connected\n\n");
  value.streams.add(response);
  for (const event of value.events) {
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
  const heartbeat = setInterval(() => {
    if (Date.now() >= state.expires) {
      response.end();
    } else {
      response.write(": heartbeat\n\n");
    }
  }, 15_000);
  response.on("close", () => {
    clearInterval(heartbeat);
    value.streams.delete(response);
  });
};
