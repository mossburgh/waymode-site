import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { origin, frozenHashes, ask } from "./public-demo.mjs";

const report = {
  at: new Date().toISOString(),
  scope:
    "Same model and runtime: visible UI controls versus an external process using the app API. Not a comparison against a third-party computer-use product.",
  before: await frozenHashes(),
  cases: [],
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const examples = [
  {
    field: "compact",
    label: "Compact layout",
    rowHeight: 44,
    goal: "Make the list compact",
  },
  {
    field: "focus",
    label: "Focus layout",
    rowHeight: 48,
    goal: "Turn on Focus layout",
  },
  {
    field: "dense",
    label: "Dense layout",
    rowHeight: 40,
    goal: "Make the list compact",
  },
];
const setup = async (definition, mode) => {
  const context = await browser.newContext({
    viewport: { width: 840, height: 940 },
  });
  await context.request.get(origin + "/api/v1/session");
  await context.request.put(origin + "/api/v1/feature", {
    data: definition,
    headers: { Origin: origin },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.__updated = false;
    window.addEventListener("message", (event) => {
      if (event.source === window && event.data?.type === "waymode:updated") {
        window.__updated = true;
      }
    });
  });
  await page.goto(
    `${origin}/product.html?showcase=1${mode === "ui" ? "&surface=browser" : ""}`,
  );
  await page.waitForFunction(() => window.__updated);
  await page.evaluate(() => {
    window.__results = [];
    window.__receipts = [];
    window.addEventListener("message", (event) => {
      if (event.data?.type === "waymode:result") {
        window.__results.push(event.data);
      }
    });
    window.__stream = new EventSource("/api/v1/trace");
    window.__stream.onmessage = (message) =>
      window.__receipts.push(JSON.parse(message.data));
  });
  return { context, page };
};
const readOutcome = async (context, page, row) => {
  row.saved = await (
    await context.request.get(origin + "/api/v1/daylist")
  ).json();
  row.events = await page.evaluate(() => window.__receipts);
  row.calls = row.events.filter(
    (event) => event.kind === "model.receipt",
  ).length;
  row.settingsOpened = await page.locator(".preferences").isVisible();
  await page.reload();
  await page.waitForFunction(() => window.__updated);
  row.rowHeight = (await page.locator(".task").first().boundingBox()).height;
};
const run = async ({ goal, ...definition }, mode) => {
  const { context, page } = await setup(definition, mode);
  const row = { definition, goal, mode, pass: false };
  const started = performance.now();
  try {
    if (mode === "ui") {
      await ask(page, goal);
      row.result = await page.evaluate(() => window.__results.at(-1));
    } else {
      const response = await context.request.post(origin + "/api/v1/external", {
        data: { goal },
        headers: { Origin: origin },
      });
      row.result = await response.json();
    }
    row.elapsedMs = performance.now() - started;
    await readOutcome(context, page, row);
    const reason =
      mode === "ui" ? row.result?.reason : row.result?.result?.reason;
    row.pass =
      reason === "completed" &&
      row.saved.preferences[definition.field] === true &&
      row.rowHeight === definition.rowHeight;
  } catch (error) {
    row.error = error.message;
  }
  report.cases.push(row);
  console.log(
    JSON.stringify({
      mode,
      field: definition.field,
      pass: row.pass,
      elapsedMs: row.elapsedMs,
      calls: row.calls,
      settingsOpened: row.settingsOpened,
    }),
  );
  await context.close();
};
try {
  for (const example of examples) {
    for (const mode of ["ui", "external"]) {
      await run(example, mode);
    }
  }
} finally {
  await browser.close();
  report.after = await frozenHashes();
  report.runtimeUnchanged = isDeepStrictEqual(report.before, report.after);
  report.passed = report.cases.filter((row) => row.pass).length;
  report.total = report.cases.length;
  await mkdir("artifacts", { recursive: true });
  const path = `artifacts/agent-paths-${Date.now()}.json`;
  await writeFile(path, JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify({
      path,
      passed: report.passed,
      total: report.total,
      runtimeUnchanged: report.runtimeUnchanged,
    }),
  );
}
