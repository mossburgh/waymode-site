type Result = { type?: string; reason?: string; verified?: boolean };
const appResult = (
  event: MessageEvent<unknown>,
  frame: HTMLIFrameElement,
  type: string,
) => {
  if (
    event.origin !== location.origin ||
    event.source !== frame.contentWindow
  ) {
    return undefined;
  }
  const data = event.data as Result | null;
  return data?.type === type ? data : undefined;
};
const resultFailure = (data: Result) =>
  data.reason === "completed" && data.verified === true
    ? undefined
    : new Error("The app did not verify completion. Inspect the trace.");

const awaitAppMessage = (
  frame: HTMLIFrameElement,
  signal: AbortSignal,
  type: string,
  timeoutMs = 30_000,
) =>
  new Promise<Result>((accept, reject) => {
    const timeout = timeoutMs
      ? setTimeout(
          () => finish(new Error("App verification timed out.")),
          timeoutMs,
        )
      : undefined;
    const finish = (error?: Error, data: Result = {}) => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
      signal.removeEventListener("abort", abort);
      if (error) {
        reject(error);
      } else {
        accept(data);
      }
    };
    const receive = (event: MessageEvent<unknown>) => {
      const data = appResult(event, frame, type);
      if (data) {
        finish(undefined, data);
      }
    };
    const abort = () => finish(new Error("Playback interrupted."));
    window.addEventListener("message", receive);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
    }
  });

export const awaitAppResult = async (
  frame: HTMLIFrameElement,
  signal: AbortSignal,
  timeoutMs = 30_000,
) => {
  const data = await awaitAppMessage(
    frame,
    signal,
    "waymode:result",
    timeoutMs,
  );
  const error = resultFailure(data);
  if (error) {
    throw error;
  }
};
export const awaitAppUpdate = (frame: HTMLIFrameElement) =>
  awaitAppMessage(frame, AbortSignal.timeout(5000), "waymode:updated");

export const awaitAppReady = (frame: HTMLIFrameElement, signal: AbortSignal) =>
  awaitAppMessage(frame, signal, "waymode:ready");
