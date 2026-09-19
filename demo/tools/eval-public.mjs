import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  origin,
  featurePath,
  baselineFeature,
  compactFeature,
  frozenHashes,
  ask,
  receiptBody,
  verifiedRun,
} from "./public-demo.mjs";

const cases = [
  {
    name: "Existing preference",
    feature: baselineFeature,
    goal: "Turn on dark mode",
    change: { dark: true },
    actions: 2,
  },
  {
    name: "Existing task",
    feature: baselineFeature,
    goal: "Mark Review launch notes as complete",
    task: "notes",
    actions: 1,
  },
  {
    name: "Feature absent",
    feature: baselineFeature,
    goal: "Turn on compact layout",
    actions: [0, 1, 2],
    reason: "abstained",
  },
  {
    name: "Feature added",
    feature: compactFeature(),
    goal: "Turn on compact layout",
    change: { compact: true },
    actions: 2,
  },
  {
    name: "Renamed control / old name",
    feature: compactFeature("Dense layout"),
    goal: "Turn on compact layout",
    change: { compact: true },
    actions: 2,
  },
  {
    name: "Feature removed",
    feature: baselineFeature,
    goal: "Turn on compact layout",
    actions: [0, 1, 2],
    reason: "abstained",
  },
  {
    name: "Feature disabled",
    feature: compactFeature("Compact layout", true),
    goal: "Turn on compact layout",
    actions: [0, 1, 2],
    reason: "abstained",
  },
  {
    name: "Ambiguous task",
    feature: compactFeature(),
    goal: "Mark the task as complete",
    actions: [0, 1, 2],
    reason: "abstained",
  },
  {
    name: "Already enabled",
    feature: compactFeature(),
    goal: "Turn on dark mode",
    initial: { dark: true },
    actions: 1,
    reason: "completed",
  },
  {
    name: "Unavailable account action",
    feature: compactFeature(),
    goal: "Change someone else's password",
    actions: [0, 1, 2],
    reason: "abstained",
  },
];
cases.push(
  {
    name: "Open settings in chat",
    feature: compactFeature(),
    goal: "Open settings here in chat",
    actions: 2,
    embedded: true,
  },
  {
    name: "Guided hidden setting",
    feature: compactFeature(),
    goal: "Turn on dark mode",
    change: { dark: true },
    actions: 2,
    guided: true,
  },
  {
    name: "Portal and change",
    feature: compactFeature(),
    goal: "Show settings in chat and turn on dark mode",
    change: { dark: true },
    actions: 3,
    embedded: true,
  },
);
const repeats = Number(process.env.WAYMODE_EVAL_REPEATS ?? 2);
const report = {
  at: new Date().toISOString(),
  model: "typesafe-ai/jev",
  scope: "browser-only",
  oracle:
    "Exact server state, checkbox state, reload persistence, task completion or explicit abstention, bounded navigation, visible portal/cursor, saved state after reload; every attempt counted",
  repeats,
  cases: [],
  before: await frozenHashes(),
};
const original = await readFile(featurePath, "utf8");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const path = `artifacts/public-eval-${Date.now()}.json`;
await mkdir("artifacts", { recursive: true });
const recordPublicCase = (page, fixture, repeat) => {
  const row = {
    name: `${fixture.name} · ${repeat}`,
    goal: fixture.goal,
    feature: fixture.feature,
    pass: false,
    elapsedMs: 0,
    receipts: [],
    errors: [],
  };
  page.on("pageerror", (error) => row.errors.push(error.message));
  const pending = [];
  page.on("response", (response) => {
    if (response.url().endsWith("/api/v1/decisions")) {
      pending.push(
        receiptBody(response)
          .then((body) =>
            row.receipts.push({ status: response.status(), body }),
          )
          .catch((error) => {
            row.errors.push(error.message);
            row.receipts.push({
              status: response.status(),
              body: { costSource: "unavailable" },
            });
          }),
      );
    }
  });
  return { row, pending };
};

const seedPublicState = async (context, fixture) => {
  const baseline = await (
    await context.request.get(`${origin}/api/v1/daylist`)
  ).json();
  const initial = {
    preferences: { dark: false, compact: false, ...fixture.initial },
    completed: { notes: false, draft: false, week: false },
  };
  const reset = await context.request.patch(`${origin}/api/v1/daylist`, {
    data: initial,
    headers: { Origin: origin },
  });
  if (!reset.ok()) {
    throw new Error(`Fixture setup failed: ${reset.status()}`);
  }
  return {
    ...baseline,
    preferences: { ...baseline.preferences, ...initial.preferences },
    completed: { ...baseline.completed, ...initial.completed },
  };
};

const capturePublicTrace = async () => {
  const { traceChannel } = await (await fetch("/api/v1/session")).json();
  window.__waymodeEvents = [];
  window.__waymodeObserver = new BroadcastChannel(traceChannel);
  window.__waymodeObserver.onmessage = (event) =>
    window.__waymodeEvents.push(event.data);
  window.__modelTrace = [];
  const trace = new EventSource("/api/v1/trace");
  trace.onmessage = (event) => window.__modelTrace.push(JSON.parse(event.data));
};

const samplePublicCursor = () => {
  window.__cursorSamples = 0;
  window.__cursorTimer = setInterval(() => {
    const cursor = document.getElementById("agent-cursor");
    if (cursor && !cursor.hidden) {
      window.__cursorSamples++;
    }
  }, 50);
};

const preparePublicCase = async (context, page, fixture, row) => {
  const initial = await seedPublicState(context, fixture);
  await page.goto(`${origin}/product.html?surface=browser`);
  await page.locator("[data-view=settings]").waitFor();
  await page.evaluate(capturePublicTrace);
  if (fixture.guided) {
    await page.evaluate(samplePublicCursor);
  }
  row.before = await (
    await context.request.get(`${origin}/api/v1/daylist`)
  ).json();
  row.beforeHeight = (await page.locator(".task").first().boundingBox()).height;
  return initial;
};

const capturePublicResult = async (context, page, fixture, initial, row) => {
  row.after = await (
    await context.request.get(`${origin}/api/v1/daylist`)
  ).json();
  row.expected = structuredClone(initial);
  Object.assign(row.expected.preferences, fixture.change);
  if (fixture.task) {
    row.expected.completed[fixture.task] = true;
  }
  row.expectedActions = fixture.actions ?? 2;
  row.expectedReason = fixture.reason ?? "completed";
  row.browserEvents = await page.evaluate(() => window.__waymodeEvents);
  row.modelTrace = await page.evaluate(() => window.__modelTrace);
  row.actualActions = row.browserEvents.filter(
    (event) => event.kind === "handler",
  ).length;
  row.status = await page.locator("#status").innerText();
  row.embedded =
    (await page
      .locator("#chat-view > #daylist[data-view=settings]")
      .count()) === 1;
  row.cursorSamples = await page.evaluate(() => window.__cursorSamples ?? 0);
  if (fixture.guided) {
    await page.evaluate(() => clearInterval(window.__cursorTimer));
  }
};

const readPublicReload = async (context, page, row, index) => {
  await page.screenshot({ path: path.replace(".json", `-${index}.png`) });
  await page.reload();
  await page.locator("[data-view=settings]").click();
  await page.getByRole("checkbox", { name: "Dark mode" }).waitFor();
  row.afterReload = await (
    await context.request.get(`${origin}/api/v1/daylist`)
  ).json();
  row.darkChecked = await page
    .getByRole("checkbox", { name: "Dark mode" })
    .isChecked();
  row.taskChecked = await page
    .getByRole("checkbox", { name: "Review launch notes" })
    .isChecked();
  row.afterHeight = (await page.locator(".task").first().boundingBox()).height;
};

const publicStateMatches = (row) =>
  isDeepStrictEqual(row.after, row.expected) &&
  isDeepStrictEqual(row.afterReload, row.expected) &&
  row.darkChecked === row.expected.preferences.dark &&
  row.taskChecked === row.expected.completed.notes;

const publicExecutionMatches = (row) =>
  (Array.isArray(row.expectedActions)
    ? row.expectedActions
    : [row.expectedActions]
  ).includes(row.actualActions) &&
  verifiedRun(row.browserEvents, row.actualActions, row.expectedReason);

const publicPresentationMatches = (fixture, row) =>
  (!fixture.embedded || row.embedded) &&
  (!fixture.guided || row.cursorSamples > 0) &&
  (fixture.change?.compact !== true || row.afterHeight < row.beforeHeight);

const publicCasePassed = (fixture, row) =>
  publicStateMatches(row) &&
  publicExecutionMatches(row) &&
  publicPresentationMatches(fixture, row) &&
  row.receipts.length > 0 &&
  row.receipts.every((receipt) => receipt.status === 200) &&
  row.errors.length === 0;

const runPublicCase = async (fixture, repeat, index) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(10_000);
  console.log(`START ${fixture.name} · ${repeat}`);
  const { row, pending } = recordPublicCase(page, fixture, repeat);
  try {
    const initial = await preparePublicCase(context, page, fixture, row);
    const started = performance.now();
    await ask(
      page,
      fixture.guided ? `Show me how to: ${fixture.goal}` : fixture.goal,
    );
    row.elapsedMs = performance.now() - started;
    await Promise.all(pending);
    await capturePublicResult(context, page, fixture, initial, row);
    await readPublicReload(context, page, row, index);
    row.pass = publicCasePassed(fixture, row);
  } catch (error) {
    row.errors.push(error.message);
  } finally {
    await context.close();
  }
  return row;
};

try {
  for (const fixture of cases) {
    await writeFile(featurePath, fixture.feature);
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const row = await runPublicCase(fixture, repeat, report.cases.length);
      report.cases.push(row);
      console.log(
        `${row.pass ? "PASS" : "FAIL"} ${row.name} · ${Math.round(row.elapsedMs)} ms`,
      );
      await writeFile(path, JSON.stringify(report, null, 2));
    }
  }
} finally {
  await writeFile(featurePath, original);
  await browser.close();
  report.after = await frozenHashes();
  report.runtimeUnchanged = isDeepStrictEqual(report.before, report.after);
  report.total = report.cases.length;
  report.passed = report.cases.filter((row) => row.pass).length;
  const receipts = report.cases.flatMap((row) => row.receipts);
  report.knownCostUsd = receipts.reduce(
    (sum, row) => sum + (row.body.costUsd ?? 0),
    0,
  );
  report.unknownCosts = receipts.filter(
    (row) => row.status !== 200 || row.body.costUsd === undefined,
  ).length;
  const times = report.cases.map((row) => row.elapsedMs).sort((a, b) => a - b);
  report.p50Ms = times[Math.ceil(times.length * 0.5) - 1];
  report.p95Ms = times[Math.ceil(times.length * 0.95) - 1];
  await writeFile(path, JSON.stringify(report, null, 2));
  await writeFile(
    ".demo-data/public-evals.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      path,
      passed: report.passed,
      total: report.total,
      runtimeUnchanged: report.runtimeUnchanged,
      cost: report.knownCostUsd,
      unknownCosts: report.unknownCosts,
      p50Ms: report.p50Ms,
      p95Ms: report.p95Ms,
    }),
  );
  if (!report.runtimeUnchanged || report.passed !== cases.length * repeats) {
    process.exitCode = 1;
  }
}
