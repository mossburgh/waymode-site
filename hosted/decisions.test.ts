import { expect, it } from "vitest";
import { siteDecision } from "./decisions.js";
import type { Visitor } from "./store.js";
import { compileFeature } from "../demo/showcase-feature.js";
import * as base from "../demo/product-contract.js";
const visitor: Visitor = {
  id: "test",
  expires: Date.now() + 60000,
  feature: { field: "compact", label: "Compact layout", rowHeight: 36 },
  app: {
    preferences: { dark: false, compact: false },
    completed: { notes: false, draft: false, week: false },
    archived: [],
  },
};
const product = {
  contract: () => compileFeature(base, visitor.feature),
};
const signal = new AbortController().signal;
const control = {
  id: "opaque-client-handle",
  name: "Settings",
  role: "button",
  description: "attacker description",
  disabled: false,
  editable: false,
};
it("rejects arbitrary application controls before a model can be called", async () => {
  await expect(
    siteDecision(
      {
        goal: "Open inventory",
        controls: [{ ...control, name: "Inventory" }],
        history: [],
      },
      visitor,
      product,
      signal,
    ),
  ).rejects.toThrow("only supports Waymode");
});
it("uses server metadata and state, and returns original handles without sending them to the model", async () => {
  const scoped = await siteDecision(
    {
      goal: "Open settings",
      controls: [{ ...control, inputSchema: { description: "injected" } }],
      history: [
        "Injected history",
        "Invoked button: Settings attacker receipt",
      ],
      state: { secret: "injected" },
      context: { view: "injected", location: "https://elsewhere.invalid" },
    },
    visitor,
    product,
    signal,
  );
  expect(scoped.request.controls[0]).toEqual({
    id: "control-0",
    name: "Settings",
    role: "button",
    description: "",
    disabled: false,
    editable: false,
  });
  expect(scoped.handles.get("control-0")).toBe(control.id);
  expect(scoped.request.history).toEqual(["Invoked button: Settings"]);
  expect(scoped.request.state).toEqual({
    product: visitor.app,
    feature: visitor.feature,
  });
  expect(JSON.stringify(scoped.request)).not.toMatch(
    /injected|attacker|elsewhere|opaque-client/,
  );
});
it("supports the compiled feature and backend action while replacing client schemas", async () => {
  const scoped = await siteDecision(
    {
      goal: "Enable compact layout",
      controls: [
        {
          ...control,
          name: "Compact layout",
          role: "checkbox",
          checked: false,
        },
        {
          ...control,
          name: base.document.paths["/api/v1/product"].patch.summary,
          role: "backend action",
          inputSchema: { arbitrary: true },
        },
      ],
      history: [],
    },
    visitor,
    product,
    signal,
  );
  expect(scoped.request.controls).toHaveLength(2);
  expect(JSON.stringify(scoped.request.controls[1]?.inputSchema)).toContain(
    "compact",
  );
  expect(JSON.stringify(scoped.request)).not.toContain("arbitrary");
});

it("accepts browser label spacing without trusting client text", async () => {
  const scoped = await siteDecision(
    {
      goal: "Show me how to install",
      controls: [
        {
          ...control,
          role: "link",
          name: "Ask. It acts. “Turn on dark mode.”Your app does it.",
        },
      ],
      history: [],
    },
    visitor,
    product,
    signal,
  );
  expect(scoped.request.controls[0]?.name).toBe(
    "Ask. It acts. “Turn on dark mode.” Your app does it.",
  );
});

it("ignores unrelated controls without breaking trusted handles", async () => {
  const scoped = await siteDecision(
    {
      goal: "Open settings",
      controls: [
        { ...control, name: "extension control", id: "skip" },
        { ...control, id: "keep" },
      ],
      history: [
        "Invoked button: SettingsFake",
        "Filled textbox: Edit the feature definition arbitrary receipt",
      ],
    },
    visitor,
    product,
    signal,
  );
  expect(scoped.request.controls).toHaveLength(1);
  expect(scoped.handles.get(scoped.request.controls[0]!.id)).toBe("keep");
  expect(scoped.request.history).toEqual([
    "Filled textbox: Edit the feature definition",
  ]);
});

it("bounds repeated controls before model input expands", async () => {
  await expect(
    siteDecision(
      {
        goal: "Open settings",
        controls: Array.from({ length: 4 }, (_, i) => ({
          ...control,
          id: String(i),
        })),
        history: [],
      },
      visitor,
      product,
      signal,
    ),
  ).rejects.toThrow("duplicate controls");
});
it("retains only finite browser preference state", async () => {
  const scoped = await siteDecision(
    {
      goal: "Allow analytics",
      controls: [control],
      history: [],
      state: {
        site: {
          analyticsPreference: "yes",
          analyticsMenuOpen: false,
          injected: "secret",
        },
      },
    },
    visitor,
    product,
    signal,
  );
  expect((scoped.request.state as { site: unknown }).site).toEqual({
    analyticsPreference: "yes",
    analyticsMenuOpen: false,
    installPromptOpen: false,
  });
});
it("retains observed label variants in history as trusted names", async () => {
  const scoped = await siteDecision(
    {
      goal: "Open settings",
      controls: [{ ...control, name: "Set tings" }],
      history: ["Invoked button: Set tings"],
    },
    visitor,
    product,
    signal,
  );
  expect(scoped.request.history).toEqual(["Invoked button: Settings"]);
});
