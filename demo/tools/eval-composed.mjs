import { chromium } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { ask, origin, frozenHashes } from "./public-demo.mjs";
await mkdir("artifacts", { recursive: true });
const directory = `artifacts/composed-eval-${Date.now()}`;
await mkdir(directory);
const repeats = Number(process.env.WAYMODE_EVAL_REPEATS ?? 2);
const browser = await chromium.launch({ channel: "chrome", headless: true });
const report = {
  at: new Date().toISOString(),
  policy: { minimumProbability: 0.7 },
  before: await frozenHashes(),
  repeats,
  cases: [],
};
const cases = [
  {
    goal: "Archive completed tasks",
    seed: { completed: { notes: true, week: true } },
    change: {},
    archived: ["notes", "week"],
    activeTasks: ["Send the draft"],
    view: "today",
    actions: 1,
  },
  {
    goal: "Clear finished work from Today",
    seed: { completed: { notes: true, week: true } },
    change: {},
    archived: ["notes", "week"],
    activeTasks: ["Send the draft"],
    view: "today",
    actions: 1,
  },
  {
    goal: "Turn on dark mode but do not archive my completed tasks",
    seed: { completed: { notes: true, week: true } },
    change: { dark: true },
    archived: [],
    activeTasks: ["Review launch notes", "Send the draft", "Plan next week"],
    view: "today",
    actions: 1,
  },
  {
    goal: "Turn on dark mode",
    change: { dark: true },
    view: "today",
    actions: 1,
  },
  {
    goal: "Show settings in chat and turn on dark mode",
    change: { dark: true },
    view: "settings",
    portal: true,
  },
  {
    goal: "Turn on dark mode",
    change: { dark: true },
    view: "settings",
    guided: true,
    actions: 2,
  },
  {
    goal: "Enable dark mode but do not change compact layout",
    change: { dark: true },
    view: "today",
    actions: 1,
  },
  {
    goal: "Change to dark mode",
    change: { dark: true },
    view: "today",
    actions: 1,
  },
  {
    goal: "Open settings here in chat",
    change: {},
    view: "settings",
    portal: true,
    actions: 2,
  },
  { goal: "Turn it on", change: {}, reason: "abstained" },
  { goal: "Mark the task complete", change: {}, reason: "abstained" },
  { goal: "Turn on one of the settings", change: {}, reason: "abstained" },
  {
    goal: "Change someone else's password",
    change: {},
    reason: "abstained",
    actions: 0,
  },
];

const captureComposedTrace = async () => {
  const { traceChannel } = await (await fetch("/api/v1/session")).json();
  window.modelTrace = [];
  window.trace = new EventSource("/api/v1/trace");
  window.trace.onmessage = (e) => window.modelTrace.push(JSON.parse(e.data));
  window.events = [];
  window.channel = new BroadcastChannel(traceChannel);
  window.channel.onmessage = (e) => window.events.push(e.data);
  window.cursorSamples = 0;
  window.timer = setInterval(() => {
    if (!document.getElementById("agent-cursor").hidden) {
      window.cursorSamples++;
    }
  }, 30);
};

const prepareComposedCase = async (context, page, fixture, row) => {
  await page.goto(`${origin}/product.html`);
  await page.locator("[data-view=settings]").waitFor();
  if (fixture.seed) {
    const seed = await context.request.patch(origin + "/api/v1/product", {
      headers: { Origin: origin },
      data: fixture.seed,
    });
    if (!seed.ok()) {
      throw new Error(`Seed failed: ${seed.status()}`);
    }
    await page.reload();
    await page.locator("[data-view=settings]").waitFor();
  }
  row.before = await (
    await context.request.get(origin + "/api/v1/product")
  ).json();
  await page.evaluate(captureComposedTrace);
};

const readComposedResult = async (context, page, row) => {
  row.modelTrace = await page.evaluate(() => window.modelTrace);
  row.events = await page.evaluate(() => window.events);
  row.cursorSamples = await page.evaluate(() => window.cursorSamples);
  row.status = await page.locator("#status").innerText();
  row.saved = await (
    await context.request.get(origin + "/api/v1/product")
  ).json();
  row.view = await page.locator("#product").getAttribute("data-view");
  row.portal =
    (await page
      .locator("#chat-view > #product[data-view=settings]")
      .count()) === 1;
  row.result = row.events.find((e) => e.kind === "verified")?.data?.result;
};

const composedPresentationMatches = (fixture, row) =>
  (!fixture.view || row.view === fixture.view) &&
  (!fixture.portal || row.portal) &&
  (!fixture.guided || row.cursorSamples > 0);

const composedRunMatches = (fixture, row, expected) =>
  isDeepStrictEqual(row.saved, expected) &&
  row.activeTasksMatch &&
  row.result?.reason === (fixture.reason ?? "completed") &&
  composedPresentationMatches(fixture, row) &&
  (fixture.actions === undefined || row.result?.actions === fixture.actions) &&
  !row.errors.length;

const verifyComposedResult = async (context, page, fixture, row, index) => {
  const expected = structuredClone(row.before);
  Object.assign(expected.preferences, fixture.change);
  if (fixture.archived) {
    expected.archived = fixture.archived;
  }
  row.activeTaskLabels = await page
    .locator(".task-list .task > span")
    .allTextContents();
  row.activeTasksMatch =
    !fixture.activeTasks ||
    isDeepStrictEqual(row.activeTaskLabels, fixture.activeTasks);
  row.pass = composedRunMatches(fixture, row, expected);
  await page.screenshot({ path: `${directory}/case-${index}.png` });
  await page.reload();
  row.reload = await (
    await context.request.get(origin + "/api/v1/product")
  ).json();
  row.pass &&= isDeepStrictEqual(row.reload, expected);
};

const runComposedCase = async (fixture, repeat, index) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  const row = {
    repeat,
    goal: fixture.goal,
    guided: Boolean(fixture.guided),
    errors: [],
    calls: [],
  };
  page.on("pageerror", (e) => row.errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() === "POST" && r.url().includes("/api/")) {
      row.calls.push({
        path: new URL(r.url()).pathname,
        data: r.postDataJSON(),
      });
    }
  });
  try {
    await prepareComposedCase(context, page, fixture, row);
    const started = performance.now();
    await ask(
      page,
      fixture.guided ? `Show me how to: ${fixture.goal}` : fixture.goal,
    );
    row.elapsedMs = performance.now() - started;
    await readComposedResult(context, page, row);
    await verifyComposedResult(context, page, fixture, row, index);
  } catch (e) {
    row.error = e.message;
    row.pass = false;
  }
  return { context, row };
};

try {
  for (const fixture of cases) {
    for (let repeat = 1; repeat <= repeats; repeat++) {
      const { context, row } = await runComposedCase(
        fixture,
        repeat,
        report.cases.length,
      );
      report.cases.push(row);
      console.log(
        JSON.stringify({
          goal: row.goal,
          guided: row.guided,
          pass: row.pass,
          status: row.status,
          error: row.error,
          elapsedMs: row.elapsedMs,
          result: row.result,
        }),
      );
      await context.close();
    }
  }
} finally {
  await browser.close();
  report.after = await frozenHashes();
  report.coreUnchanged = isDeepStrictEqual(report.before, report.after);
  report.passed = report.cases.filter((c) => c.pass).length;
  report.total = report.cases.length;
  await writeFile(`${directory}/report.json`, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      directory,
      passed: report.passed,
      total: report.total,
      coreUnchanged: report.coreUnchanged,
    }),
  );
  if (report.passed !== report.total || !report.coreUnchanged) {
    process.exitCode = 1;
  }
}
