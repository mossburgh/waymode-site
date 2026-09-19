import type { Decision, DecisionRequest } from "@mossburgh/waymode";

export const presentationRequest = (goal: string): DecisionRequest => ({
  goal: "Choose how to fulfill the original request: perform it directly unless the user explicitly asks to be shown how, taught, or guided through visible steps. Asking to open or show a view is a direct request, not a request for teaching.",
  request: goal,
  mode: "step",
  history: [],
  controls: [
    {
      id: "act",
      name: "Perform the request directly",
      description:
        "Make the requested change or open the requested view using the shortest supported route.",
      role: "button",
      disabled: false,
      editable: false,
    },
    {
      id: "guide",
      name: "Show the user how with on-screen guidance",
      description:
        "Demonstrate the requested task through visible controls, with a cursor showing each step.",
      role: "button",
      disabled: false,
      editable: false,
    },
  ],
});

export const presentationMode = (decision: Decision) => {
  if (
    decision.outcome !== "selected" ||
    !["act", "guide"].includes(decision.target ?? "")
  ) {
    throw new Error("Would you like me to make the change, or show you how?");
  }
  return decision.target === "guide" ? "guide" : "act";
};

export const requestMode = async (goal: string, signal: AbortSignal) => {
  const response = await fetch("/api/v1/presentation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
    signal,
  });
  if (!response.ok) {
    throw new Error("I couldn’t read your request. Please try again.");
  }
  const result = (await response.json()) as { mode?: unknown };
  if (result.mode !== "act" && result.mode !== "guide") {
    throw new Error("Would you like me to make the change, or show you how?");
  }
  return result.mode;
};
