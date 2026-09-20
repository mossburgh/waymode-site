import { expect, it } from "vitest";
import * as base from "./product-contract.js";
import { compileFeature, createFeatureStore } from "./showcase-feature.js";

const session = () => ({ calls: 0, active: false, expires: Date.now() + 1000 });
const definition = { field: "dense", label: "Dense rows", rowHeight: 44 };

it("derives the API from the feature and removes obsolete fields", () => {
  const compiled = compileFeature(base, definition);
  expect(compiled.patch.parse({ preferences: { dense: true } })).toEqual({
    preferences: { dense: true },
  });
  expect(() =>
    compiled.patch.parse({ preferences: { compact: true } }),
  ).toThrow();
  const schema = JSON.stringify(compiled.document);
  expect(schema).toContain("Dense rows");
  expect(schema).not.toContain("Compact layout");
  expect(() =>
    compileFeature(base, null).patch.parse({
      preferences: { dense: true },
    }),
  ).toThrow();
});

it("isolates visitors and keeps the last valid definition on rejection", () => {
  const store = createFeatureStore();
  const owner = session();
  const other = session();
  store.write(owner, definition);
  expect(store.has(other)).toBe(false);
  expect(store.read(other)).toBeNull();
  expect(() => store.write(owner, { ...definition, rowHeight: 0 })).toThrow();
  expect(store.read(owner)).toEqual(definition);
});

it.each(["__proto__", "constructor", "prototype", "dark", "a.b"])(
  "rejects reserved or non-field keys: %s",
  (field) => {
    const store = createFeatureStore();
    expect(() => store.write(session(), { ...definition, field })).toThrow();
  },
);
