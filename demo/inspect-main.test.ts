// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

class TraceStream {
  static streams: TraceStream[] = [];
  onmessage: ((event: { data: string }) => void) | undefined;
  constructor(readonly url: string) {
    TraceStream.streams.push(this);
  }
  send(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) });
  }
}
class TraceChannel {
  static channels: TraceChannel[] = [];
  onmessage: ((event: { data: unknown }) => void) | undefined;
  constructor(readonly name: string) {
    TraceChannel.channels.push(this);
  }
  postMessage() {}
  send(data: unknown) {
    this.onmessage?.({ data });
  }
}
const frames: FrameRequestCallback[] = [];
const bootInspector = async () => {
  const page = new DOMParser().parseFromString(
    readFileSync("demo/inspect.html", "utf8"),
    "text/html",
  );
  for (const script of page.querySelectorAll("script")) {
    script.remove();
  }
  document.body.innerHTML = page.body.innerHTML;
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    return frames.push(callback);
  });
  vi.stubGlobal("EventSource", TraceStream);
  vi.stubGlobal("BroadcastChannel", TraceChannel);
  vi.stubGlobal("fetch", (url: string) =>
    Promise.resolve(
      url === "/api/v1/session"
        ? Response.json({ traceChannel: "fixture-session-A" })
        : new Response(null, { status: 404 }),
    ),
  );
  await import("./inspect-main.js");
  return {
    stream: TraceStream.streams.find(
      (stream) => stream.url === "/api/v1/trace",
    )!,
    channel: TraceChannel.channels[0]!,
    cost: () => document.getElementById("cost")!.textContent,
  };
};
let inspector: Awaited<ReturnType<typeof bootInspector>>;
beforeAll(async () => {
  inspector = await bootInspector();
}, 15_000);
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("deduplicates replay after display eviction and accepts a new server stream", () => {
  const { stream, channel, cost } = inspector;
  const receipt = {
    id: 1,
    stream: "fixture-A",
    at: Date.now(),
    kind: "model.receipt",
    data: { costUsd: 0.001, costSource: "provider", elapsedMs: 1 },
  };
  stream.send(receipt);
  expect(cost()).toContain("$0.001000");
  for (let index = 0; index < 100; index++) {
    channel.send({
      id: `browser-${index}`,
      at: Date.now(),
      kind: "controls",
      data: {},
    });
  }
  stream.send(receipt);
  expect(cost()).toContain("$0.001000");
  stream.send({ ...receipt, id: 2 });
  stream.send(receipt);
  expect(cost()).toContain("$0.002000");
  stream.send({ ...receipt, stream: "fixture-B" });
  stream.send({ ...receipt, stream: "fixture-B" });
  expect(cost()).toContain("$0.003000");
  expect(channel.name).toBe("fixture-session-A");
  expect(frames).toHaveLength(1);
  frames.shift()!(performance.now());
  expect(document.querySelectorAll("#events > button")).toHaveLength(100);
  stream.send({ ...receipt, stream: "fixture-B", id: 2 });
  expect(frames).toHaveLength(1);
  expect(cost()).toContain("$0.004000");
});
