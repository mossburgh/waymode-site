import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import {
  origin,
  featurePath,
  frozenHashes,
  ask,
  receiptBody,
} from "./public-demo.mjs";

const directory = `artifacts/public-recording-${Date.now()}`;
await mkdir(directory, { recursive: true });
const evidence = {
  startedAt: new Date().toISOString(),
  origin,
  speed: "1x; continuous page captures, no synthetic requests or responses",
  featureBefore: await readFile(featurePath, "utf8"),
  coreBefore: await frozenHashes(),
  receipts: [],
  errors: [],
};
const browser = await chromium.launch({
  channel: "chrome",
  headless: false,
  args: ["--window-position=0,0", "--window-size=840,980"],
});
const context = await browser.newContext({
  viewport: { width: 840, height: 940 },
  recordVideo: { dir: directory, size: { width: 1000, height: 940 } },
});
const page = await context.newPage();
page.setDefaultTimeout(15_000);
const pending = [];
let inspector;
page.on("pageerror", (error) => evidence.errors.push(error.message));
page.on("response", (response) => {
  if (response.url().endsWith("/api/v1/decisions")) {
    pending.push(
      receiptBody(response)
        .then((body) =>
          evidence.receipts.push({ status: response.status(), body }),
        )
        .catch((error) => {
          evidence.errors.push(error.message);
          evidence.receipts.push({
            status: response.status(),
            body: { costSource: "unavailable" },
          });
        }),
    );
  }
});
try {
  await page.goto(`${origin}/product.html`);
  await page.locator("[data-view=settings]").waitFor();
  if (await page.getByRole("checkbox", { name: "Dark mode" }).isVisible()) {
    throw new Error("Settings must start hidden.");
  }
  evidence.initial = await (
    await context.request.get(`${origin}/api/v1/daylist`)
  ).json();
  if (await page.getByRole("checkbox", { name: "Compact layout" }).count()) {
    throw new Error("Start with the compact feature absent.");
  }
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open inspector" }).click();
  inspector = await popup;
  inspector.on("pageerror", (error) => evidence.errors.push(error.message));
  const protocol = await context.newCDPSession(inspector);
  const { windowId } = await protocol.send("Browser.getWindowForTarget");
  await protocol.send("Browser.setWindowBounds", {
    windowId,
    bounds: { left: 845, top: 0, width: 1020, height: 980 },
  });
  await inspector.setViewportSize({ width: 1000, height: 940 });
  await inspector
    .locator("#source-code")
    .filter({ hasText: "mountFeature" })
    .waitFor({ state: "attached" });
  evidence.captureReadyAt = new Date().toISOString();
  await page.waitForTimeout(1000);
  await ask(page, "Show me how to open settings here in chat", true);
  if (
    (await page
      .locator("#chat-view > #daylist[data-view=settings]")
      .count()) !== 1
  ) {
    throw new Error("Settings did not open in chat.");
  }
  await page.waitForTimeout(1400);
  await ask(page, "Turn on dark mode", true);
  if (!(await page.getByRole("checkbox", { name: "Dark mode" }).isChecked())) {
    throw new Error("Dark mode did not save.");
  }
  await inspector.getByRole("button", { name: /04 \/ CHECK/ }).click();
  await page.waitForTimeout(1800);
  await inspector.getByRole("tab", { name: "Feature source" }).click();
  evidence.beforeHeight = (
    await page.locator(".task").first().boundingBox()
  ).height;
  await writeFile(`${directory}/ready`, evidence.startedAt);
  console.log(JSON.stringify({ readyForFeatureEdit: true, directory }));
  await page
    .getByRole("checkbox", { name: "Compact layout" })
    .waitFor({ timeout: 240_000 });
  evidence.featureAppearedAt = new Date().toISOString();
  await page.waitForTimeout(1800);
  await inspector.getByRole("tab", { name: "Trace", exact: true }).click();
  await inspector.getByRole("button", { name: "Follow live" }).click();
  await ask(page, "Show me how to turn on compact layout", true);
  evidence.saved = await (
    await context.request.get(`${origin}/api/v1/daylist`)
  ).json();
  evidence.afterHeight = (
    await page.locator(".task").first().boundingBox()
  ).height;
  await inspector.getByRole("button", { name: /04 \/ CHECK/ }).click();
  await page.waitForTimeout(1700);
  await inspector.getByRole("tab", { name: "Network", exact: true }).click();
  await inspector
    .locator("#network-events button")
    .filter({ hasText: "PATCH" })
    .last()
    .click();
  await page.waitForTimeout(1800);
  await inspector.getByRole("tab", { name: "Evals", exact: true }).click();
  await inspector.getByRole("button", { name: "Refresh results" }).click();
  await page.waitForTimeout(1800);
  await page.screenshot({ path: `${directory}/app.png` });
  await inspector.screenshot({ path: `${directory}/inspector.png` });
  await Promise.all(pending);
  evidence.coreAfter = await frozenHashes();
  evidence.coreUnchanged = isDeepStrictEqual(
    evidence.coreBefore,
    evidence.coreAfter,
  );
  evidence.featureAfter = await readFile(featurePath, "utf8");
  evidence.expected = structuredClone(evidence.initial);
  Object.assign(evidence.expected.preferences, { dark: true, compact: true });
  evidence.passed =
    evidence.coreUnchanged &&
    evidence.featureBefore !== evidence.featureAfter &&
    isDeepStrictEqual(evidence.saved, evidence.expected) &&
    evidence.afterHeight < evidence.beforeHeight &&
    evidence.receipts.length >= 6 &&
    evidence.receipts.filter((row) => row.body.outcome === "completed")
      .length === 3 &&
    evidence.receipts.every((row) => row.status === 200) &&
    evidence.errors.length === 0;
  if (!evidence.passed) {
    process.exitCode = 1;
  }
} catch (error) {
  evidence.failure = error.message;
  process.exitCode = 1;
  await page.screenshot({ path: `${directory}/failure.png` });
} finally {
  evidence.finishedAt = new Date().toISOString();
  await context.close();
  await page.video().saveAs(`${directory}/app.webm`);
  if (inspector) {
    await inspector.video().saveAs(`${directory}/inspector.webm`);
  }
  await browser.close();
  await writeFile(
    `${directory}/evidence.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      directory,
      passed: evidence.passed,
      failure: evidence.failure,
      coreUnchanged: evidence.coreUnchanged,
      calls: evidence.receipts.length,
    }),
  );
}
