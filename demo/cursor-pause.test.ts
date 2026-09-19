// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { cursorPause } from "./cursor-pause.js";

it.each([new Error("cancelled"), new DOMException("cancelled", "AbortError")])(
  "retains cancellation Error identity: %s",
  async (reason) => {
    const controller = new AbortController();
    const pending = cursorPause(controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  },
);
it("wraps a non-Error cancellation with the original cause", async () => {
  const controller = new AbortController();
  const pending = cursorPause(controller.signal);
  controller.abort("cancelled by user");
  await expect(pending).rejects.toMatchObject({
    message: "Cursor guidance was cancelled.",
    cause: "cancelled by user",
  });
});
