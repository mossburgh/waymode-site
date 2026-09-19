import { expect, it } from "vitest";
import { createTraceState } from "./studio-trace.js";

it("counts provider costs once when the event stream reconnects", () => {
  const accept = createTraceState();
  const receipt = {
    stream: "owner",
    id: 1,
    kind: "model.usage",
    data: { costUsd: 0.01 },
  };
  expect(accept(receipt)?.cost).toBe(0.01);
  expect(accept(receipt)).toBeUndefined();
  expect(accept({ ...receipt, id: 2 })?.cost).toBe(0.02);
});
it("retains unknown charges and accepts a restarted stream", () => {
  const accept = createTraceState();
  expect(
    accept({ stream: "first", id: 1, kind: "model.error", data: {} })?.unknown,
  ).toBe(1);
  const result = accept({
    stream: "next",
    id: 1,
    kind: "model.usage",
    data: { costUsd: 0 },
  });
  expect(result).toMatchObject({ cost: 0, unknown: 1 });
});

it("excludes earlier visits from the current showcase evidence", () => {
  const accept = createTraceState(100);
  const event = {
    stream: "owner",
    id: 1,
    at: 99,
    kind: "model.usage",
    data: { costUsd: 4 },
  };
  expect(accept(event)).toBeUndefined();
  expect(
    accept({ ...event, id: 2, at: 101, data: { costUsd: 0.01 } })?.cost,
  ).toBe(0.01);
});

it("tracks each call separately and distinguishes market cost from Gateway charge", () => {
  const accept = createTraceState();
  const data = {
    request: "Archive completed tasks",
    model: "test/model",
    costUsd: 0,
    marketCostUsd: 0.000013566,
    inputTokens: 323,
    outputTokens: 31,
    elapsedMs: 200,
  };
  const first = accept({ stream: "one", id: 1, kind: "model.usage", data });
  expect(first).toMatchObject({ calls: 1, cost: 0, marketCost: 0.000013566 });
  expect(first?.label).toContain("Archive completed tasks");
  expect(first?.label).toContain("323 in / 31 out");
  expect(
    accept({ stream: "one", id: 2, kind: "model.receipt", data })?.calls,
  ).toBe(1);
  expect(
    accept({ stream: "one", id: 3, kind: "model.usage", data }),
  ).toMatchObject({ calls: 2, marketCost: 0.000027132 });
});
