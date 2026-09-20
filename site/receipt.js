import { rateLimitDetail } from "./request-error.js";
const element = (tag, text, className) => {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) {
    node.className = className;
  }
  return node;
};
const stateFor = (outcome) => {
  if (outcome === "Running") {
    return ["pending", "◌"];
  }
  if (outcome === "Blocked") {
    return ["blocked", "⊘"];
  }
  if (["Finished", "Playing", "Your turn"].includes(outcome)) {
    return ["done", "✓"];
  }
  return ["stopped", "—"];
};
function shell(history, goal) {
  const row = document.createElement("details");
  row.className = "tool-call";
  const icon = element("span", "◌", "tool-icon");
  const target = element("span", goal, "tool-target");
  const outcome = element("span", "Running", "tool-outcome");
  const summary = document.createElement("summary");
  summary.append(icon, element("code", "waymode.run"), target, outcome);
  const steps = element("ol", "", "tool-steps");
  row.append(summary, steps);
  row.dataset.outcome = "pending";
  history.replaceChildren(row);
  return { row, icon, target, outcome, summary, steps };
}
const costText = (cost) =>
  typeof cost === "number" ? `$${cost.toFixed(8)}` : "Cost unavailable";
function decisionStep(ui, decision) {
  const step = document.createElement("li");
  step.append(
    element(
      "small",
      `${decision.model} · ${Math.round(decision.elapsedMs)} ms · ${decision.outcome} · ${costText(decision.costUsd)} ${decision.costSource ?? ""}`,
      "tool-model",
    ),
  );
  ui.steps.append(step);
}
function targetStep(ui, control) {
  ui.target.textContent = control.name;
  const step = ui.steps.lastElementChild;
  if (step && !step.querySelector("span")) {
    step.prepend(element("span", `Guide to “${control.name}”`));
  }
}
function addEvidence(ui, trace, cost, decisions, unknown) {
  const disclosure = document.createElement("details");
  disclosure.className = "tool-evidence";
  disclosure.append(
    element("summary", "Full trace"),
    element("pre", JSON.stringify(trace, null, 2)),
  );
  ui.row.append(disclosure);
  ui.summary.after(
    element(
      "small",
      `${decisions} decisions · ${costText(cost)} reported${unknown ? " + unknown" : ""}`,
      "tool-model",
    ),
  );
}
function callbacks(ui, trace, usage) {
  return {
    onObservation(request) {
      trace.push({ request });
    },
    onTarget(control) {
      targetStep(ui, control);
    },
    onDecision(decision) {
      trace.at(-1).decision = decision;
      usage.decisions++;
      if (typeof decision.costUsd === "number") {
        usage.cost += decision.costUsd;
      } else {
        usage.unknown = true;
      }
      decisionStep(ui, decision);
    },
    onReceipt(receipt) {
      const action = ui.steps.lastElementChild?.querySelector("span");
      if (action) {
        action.textContent = `✓ Used “${receipt.before.name}”`;
      }
      trace.push({ receipt });
      ui.target.textContent = "Checking the page…";
    },
  };
}
export function createReceipt(history, status, goal) {
  const ui = shell(history, goal);
  const trace = [];
  const usage = { cost: 0, decisions: 0, unknown: false };
  status.textContent = "";
  return {
    callbacks: callbacks(ui, trace, usage),
    finish(outcome, message) {
      const [state, icon] = stateFor(outcome);
      ui.row.dataset.outcome = state;
      ui.icon.textContent = icon;
      ui.outcome.textContent = outcome;
      ui.target.textContent = goal;
      status.textContent = message;
    },
    error(error) {
      trace.push({ error: error.message });
      usage.unknown = true;
    },
    seal() {
      addEvidence(ui, trace, usage.cost, usage.decisions, usage.unknown);
    },
  };
}
export function outcomeFor(result) {
  if (result.reason === "cancelled") {
    return result.handoff
      ? ["Playing", result.handoff]
      : ["Stopped", "Stopped. Actions already taken stay in place."];
  }
  return {
    completed: ["Finished", "Waymode finished this walkthrough."],
    abstained: [
      "No action",
      "Waymode could not choose a supported next action.",
    ],
    limit: ["Step limit", "Stopped after five actions. Ask again to continue."],
    stale: [
      "Page changed",
      "The page changed before the action. Ask again using its current state.",
    ],
    "confirmation-required": ["Your turn", result.handoff],
    denied: ["Unavailable", "That action is not available."],
  }[result.reason];
}

export function failureFor(error, aborted) {
  if (aborted) {
    return ["Stopped", "Stopped."];
  }
  const limited = rateLimitDetail(error);
  if (limited) {
    return ["Limit reached", limited];
  }
  return [
    "Failed",
    "Waymode couldn’t finish this request. Your last action stays in place. Try again.",
  ];
}
