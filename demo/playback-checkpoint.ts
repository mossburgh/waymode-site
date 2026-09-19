type Checkpoint = { stage?: string; hold: (wait: Promise<void>) => void };
export const playbackCheckpoint = async (
  signal: AbortSignal,
  stage?: string,
) => {
  const waits: Promise<void>[] = [];
  document.dispatchEvent(
    new CustomEvent<Checkpoint>("waymode:checkpoint", {
      detail: {
        ...(stage && { stage }),
        hold: (wait) => {
          waits.push(wait);
        },
      },
    }),
  );
  await Promise.all(waits);
  signal.throwIfAborted();
};
export const connectPlaybackCheckpoints = (
  document: Document,
  wait: (stage?: string) => Promise<void>,
) => {
  document.addEventListener("waymode:checkpoint", (event) => {
    const { stage, hold } = (event as CustomEvent<Checkpoint>).detail;
    hold(wait(stage));
  });
};
