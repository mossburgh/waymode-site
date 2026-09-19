// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { connectProductTrace } from "./product-trace.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  history.replaceState(null, "", "/");
});

it("uses its parent's trace in the showcase, accepting only that same-origin frame", () => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  vi.spyOn(window, "parent", "get").mockReturnValue(frame.contentWindow!);
  history.replaceState(null, "", "/?showcase=1");
  const createStream = vi.fn();
  vi.stubGlobal("EventSource", createStream);
  const consume = vi.fn();
  const disconnect = connectProductTrace(consume);
  const send = (origin: string, source: Window) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        origin,
        source,
        data: { type: "waymode:trace", json: "{}" },
      }),
    );
  send("https://example.org", frame.contentWindow!);
  send(location.origin, window);
  expect(consume).not.toHaveBeenCalled();
  send(location.origin, frame.contentWindow!);
  expect(consume).toHaveBeenCalledExactlyOnceWith("{}");
  expect(createStream).not.toHaveBeenCalled();
  disconnect();
  send(location.origin, frame.contentWindow!);
  expect(consume).toHaveBeenCalledOnce();
});
