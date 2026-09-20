type Result = {
  goal: string;
  detail: string;
  elapsedMs: number;
  actions?: number;
  completed: boolean;
  verified: boolean;
  failed?: boolean;
  stopped?: boolean;
  rateLimited?: boolean;
};
export const resultStatus = (result: Result) => {
  if (result.stopped) {
    return "Stopped";
  }
  if (result.rateLimited) {
    return "Limit reached";
  }
  if (result.failed) {
    return "Failed";
  }
  if (!result.completed || !result.verified) {
    return "Not confirmed";
  }
  return result.actions === 0 ? "No change needed" : "Completed";
};
export const appendChatResult = (container: HTMLElement, result: Result) => {
  const item = document.createElement("details");
  item.className = "chat-result";
  const summary = document.createElement("summary");
  const goal = document.createElement("span");
  goal.textContent = result.goal;
  const status = document.createElement("span");
  status.className = "result-status";
  status.textContent = resultStatus(result);
  summary.append(goal, status);
  const detail = document.createElement("p");
  detail.textContent = result.detail;
  const timing = document.createElement("small");
  const actions =
    result.actions === undefined
      ? "Actions unconfirmed"
      : `${result.actions} actions`;
  timing.textContent = `${actions} · ${(result.elapsedMs / 1000).toFixed(2)}s`;
  item.append(summary, detail, timing);
  container.append(item);
  container.scrollTop = container.scrollHeight;
};
