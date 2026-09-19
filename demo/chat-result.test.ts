// @vitest-environment happy-dom
import { expect, it } from "vitest";
import { appendChatResult, resultStatus } from "./chat-result.js";

const result = {
  goal: "Turn on dark mode",
  detail: "Already in the requested state.",
  elapsedMs: 300,
  actions: 0,
  completed: true,
  verified: true,
};
it("distinguishes satisfied no-ops from an abstention or failed verification", () => {
  expect(resultStatus(result)).toBe("No change needed");
  expect(resultStatus({ ...result, completed: false })).toBe("Not confirmed");
  expect(resultStatus({ ...result, verified: false })).toBe("Not confirmed");
  expect(resultStatus({ ...result, actions: 1 })).toBe("Completed");
});
it("keeps a compact accessible receipt with real action counts and safe text", () => {
  const container = document.createElement("section");
  appendChatResult(container, { ...result, goal: "<img src=x>" });
  expect(container.querySelector("details")?.open).toBe(false);
  expect(container.querySelector("summary")?.textContent).toBe(
    "<img src=x>No change needed",
  );
  expect(container.querySelector("img")).toBeNull();
  expect(container.querySelector("small")?.textContent).toBe(
    "0 actions · 0.30s",
  );
  expect(container.querySelector("p")?.textContent).toBe(result.detail);
});
it("does not claim zero actions when an error leaves the outcome unknown", () => {
  const container = document.createElement("section");
  appendChatResult(container, {
    goal: result.goal,
    detail: result.detail,
    elapsedMs: result.elapsedMs,
    completed: false,
    verified: false,
    failed: true,
  });
  expect(container.textContent).toContain("Actions unconfirmed");
  expect(container.querySelector("summary")?.textContent).toContain("Failed");
});

it("shows an intentional interruption without claiming a verified result", () => {
  expect(
    resultStatus({
      ...result,
      completed: false,
      verified: false,
      stopped: true,
    }),
  ).toBe("Stopped");
});
