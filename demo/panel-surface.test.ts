import { expect, it, vi } from "vitest";
import { createPanelSurface } from "./panel-surface.js";

it("opens the app-owned panel once and retires its handle", async () => {
  const open = vi.fn();
  const surface = createPanelSurface([
    { name: "Account", isOpen: () => false, open },
  ]);
  const signal = new AbortController().signal;
  const snapshot = await surface.observe(signal);
  await surface.assertCurrent(snapshot, signal);
  await surface.invoke(snapshot.controls[0]!, undefined, signal);
  expect(open).toHaveBeenCalledOnce();
  expect(() =>
    surface.invoke(snapshot.controls[0]!, undefined, signal),
  ).toThrow();
});

it("rejects a panel that changed while a model was deciding", async () => {
  let isOpen = false;
  const open = vi.fn();
  const surface = createPanelSurface([
    { name: "Settings", isOpen: () => isOpen, open },
  ]);
  const signal = new AbortController().signal;
  const snapshot = await surface.observe(signal);
  isOpen = true;
  expect(() => surface.assertCurrent(snapshot, signal)).toThrow(
    "panel state changed",
  );
  expect(() =>
    surface.invoke(snapshot.controls[0]!, undefined, signal),
  ).toThrow();
  expect(open).not.toHaveBeenCalled();
});

it("rejects cancellation and handles replaced by a fresh observation", async () => {
  const open = vi.fn();
  const surface = createPanelSurface([
    { name: "Settings", isOpen: () => false, open },
  ]);
  const controller = new AbortController();
  const snapshot = await surface.observe(controller.signal);
  await surface.observe(controller.signal);
  expect(() => surface.assertCurrent(snapshot, controller.signal)).toThrow();
  controller.abort();
  expect(() =>
    surface.invoke(snapshot.controls[0]!, undefined, controller.signal),
  ).toThrow();
  expect(open).not.toHaveBeenCalled();
});
