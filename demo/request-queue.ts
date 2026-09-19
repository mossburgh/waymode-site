export const createRequestQueue = (
  execute: (goal: string, watched: boolean) => Promise<void>,
  cancel: () => void,
) => {
  let current: { watched: boolean; done: Promise<void> } | undefined;
  let version = 0;
  return async (goal: string, watched = false) => {
    if (!goal.trim() || (current && !current.watched)) {
      return;
    }
    const request = ++version;
    if (current) {
      cancel();
      await current.done.catch(() => undefined);
    }
    if (request !== version) {
      return;
    }
    const next = { watched, done: execute(goal, watched) };
    current = next;
    try {
      await next.done;
    } finally {
      if (current === next) {
        current = undefined;
      }
    }
  };
};
