export const cursorPause = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve, reject) => {
    const abort = (): void => {
      clearTimeout(timer);
      reject(
        signal.reason instanceof Error
          ? signal.reason
          : new Error("Cursor guidance was cancelled.", {
              cause: signal.reason,
            }),
      );
    };
    const timer = window.setTimeout(
      () => {
        signal.removeEventListener("abort", abort);
        resolve();
      },
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 420,
    );
    signal.addEventListener("abort", abort, { once: true });
  });
