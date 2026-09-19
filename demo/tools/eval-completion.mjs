import { demoEvaluationOptions } from "../model.ts";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createDecider } from "@mossburgh/waymode/server";
import { experimental_evaluate as evaluate } from "ai";
import { frozenHashes } from "./public-demo.mjs";

const control = (name, checked) => ({
  id: name,
  name,
  checked,
  description: "",
  role: "checkbox",
  editable: false,
  disabled: false,
});
const recorded = JSON.parse(
  await readFile("demo/tools/eval-completion.fixture.json", "utf8"),
);
const cases = [
  {
    name: "Renamed setting among full live controls",
    goal: recorded.step.goal,
    controls: recorded.controls,
    context: recorded.context,
    history: recorded.history,
    complete: true,
  },
  ...[
    ["Dense layout", "Make the list compact"],
    ["Night theme", "Turn on dark mode"],
    ["Email summaries", "Enable email summaries"],
  ].flatMap(([name, goal]) => [
    {
      name: `${name} enabled`,
      goal,
      controls: [control(name, true)],
      complete: true,
    },
    {
      name: `${name} unchanged`,
      goal,
      controls: [control(name, false)],
      complete: false,
    },
  ]),
  {
    name: "Unrelated checked control",
    goal: "Make the list compact",
    controls: [control("Dark mode", true)],
    complete: false,
  },
  {
    name: "History without current proof",
    goal: "Make the list compact",
    controls: [control("Dark mode", false)],
    history: ["Compact layout"],
    complete: false,
  },
  {
    name: "Only part of the goal satisfied",
    goal: "Enable dark mode and email summaries",
    controls: [control("Dark mode", true), control("Email summaries", false)],
    complete: false,
  },
  {
    name: "Requested chat location missing",
    goal: "Open settings here in chat",
    controls: [control("Dark mode", true)],
    context: { view: "Settings", location: "Workspace" },
    complete: false,
  },
  {
    name: "Requested view and location present",
    goal: "Open settings here in chat",
    controls: [control("Dark mode", true)],
    context: { view: "Settings", location: "Chat" },
    complete: true,
  },
];
const report = {
  at: new Date().toISOString(),
  scope:
    "Synthetic observed-state fixtures with real Jev; no browser execution proof.",
  repeats: 3,
  threshold: 0.7,
  before: await frozenHashes(),
  cases: [],
};

const recordedDecider = (row) =>
  createDecider(
    demoEvaluationOptions({
      evaluate: async (options) => {
        const result = await evaluate(options);
        row.calls.push({
          state: options.state,
          questions: options.questions,
          answers: result.answers,
        });
        return result;
      },
    }),
  );

const checkCase = async (fixture, repeat) => {
  const row = {
    name: fixture.name,
    repeat,
    expectedComplete: fixture.complete,
    calls: [],
    pass: false,
  };
  const decide = recordedDecider(row);
  try {
    row.decision = await decide(
      {
        goal: fixture.goal,
        controls: fixture.controls,
        history: fixture.history ?? [],
        mode: "task",
        context: fixture.context ?? { view: "Settings", location: "Workspace" },
      },
      new AbortController().signal,
    );
    row.pass = (row.decision.outcome === "completed") === fixture.complete;
  } catch (error) {
    row.error = error instanceof Error ? error.name : "Unknown error";
  }
  report.cases.push(row);
  console.log(
    JSON.stringify({
      name: row.name,
      repeat,
      pass: row.pass,
      decision: row.decision,
      error: row.error,
    }),
  );
};

try {
  for (const fixture of cases) {
    for (let repeat = 1; repeat <= report.repeats; repeat++) {
      await checkCase(fixture, repeat);
    }
  }
} finally {
  report.after = await frozenHashes();
  report.runtimeUnchanged =
    JSON.stringify(report.before) === JSON.stringify(report.after);
  report.passed = report.cases.filter((row) => row.pass).length;
  report.total = report.cases.length;
  await mkdir("artifacts", { recursive: true });
  const path = `artifacts/completion-eval-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      path,
      passed: report.passed,
      total: report.total,
      runtimeUnchanged: report.runtimeUnchanged,
    }),
  );
  if (
    report.passed !== cases.length * report.repeats ||
    !report.runtimeUnchanged
  ) {
    process.exitCode = 1;
  }
}
