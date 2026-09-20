import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { createProductStore } from "./product-store.js";

it("persists new preferences through the ordinary app API and isolates sessions", () => {
  const directory = mkdtempSync(join(tmpdir(), "product-"));
  try {
    const store = createProductStore(directory);
    const owner = randomUUID();
    store.patch(owner, { preferences: { compact: true } });
    store.patch(owner, { completed: { notes: true } });
    expect(createProductStore(directory).read(owner)).toEqual({
      archived: [],
      preferences: { dark: false, compact: true },
      completed: { notes: true, draft: false, week: false },
    });
    expect(store.read(randomUUID()).preferences.compact).toBeUndefined();
    expect(() =>
      store.patch(owner, { preferences: { compact: "yes" } }),
    ).toThrow();
    expect(() =>
      store.patch(owner, { completed: { unknown: true } }),
    ).toThrow();
    expect(() =>
      store.patch(owner, JSON.parse('{"preferences":{"__proto__":true}}')),
    ).toThrow();
    expect(Object.hasOwn(store.read(owner).preferences, "__proto__")).toBe(
      false,
    );
    expect(() => store.patch("../outside", {})).toThrow();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("archives only completed tasks and keeps their saved content and other state", () => {
  const directory = mkdtempSync(join(tmpdir(), "product-archive-"));
  try {
    const store = createProductStore(directory);
    const owner = randomUUID();
    const before = store.patch(owner, {
      preferences: { dark: true, compact: true },
      completed: { notes: true, week: true },
    });
    const saved = store.archiveCompleted(owner);
    expect(saved).toEqual({ ...before, archived: ["notes", "week"] });
    expect(createProductStore(directory).read(owner)).toEqual(saved);
    expect(store.archiveCompleted(owner)).toEqual(saved);
    expect(store.read(randomUUID()).archived).toEqual([]);
    expect(() => store.patch(owner, { completed: { notes: false } })).toThrow();
    expect(store.read(owner)).toEqual(saved);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("upgrades old saved state and archives later completed tasks", () => {
  const directory = mkdtempSync(join(tmpdir(), "product-upgrade-"));
  try {
    const owner = randomUUID();
    const before = {
      preferences: { dark: true },
      completed: { notes: false, draft: false, week: false },
    };
    writeFileSync(join(directory, `${owner}.json`), JSON.stringify(before));
    const store = createProductStore(directory);
    expect(store.read(owner)).toEqual({ ...before, archived: [] });
    store.patch(owner, { completed: { draft: true } });
    expect(store.archiveCompleted(owner)).toEqual({
      ...before,
      completed: { ...before.completed, draft: true },
      archived: ["draft"],
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
