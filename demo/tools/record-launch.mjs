import { createHash } from "node:crypto";
import { chromium } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { story } from "./launch-story.mjs";
import {
  origin,
  featurePath,
  baselineFeature,
  compactFeature,
  frozenHashes,
  ask,
} from "./public-demo.mjs";

const checkOnly = process.argv.includes("--check");
const directory = `artifacts/launch-${Date.now()}`;
await mkdir(directory, { recursive: true });
const contractPath = "demo/product-contract.ts";
const originals = {
  feature: await readFile(featurePath, "utf8"),
  contract: await readFile(contractPath, "utf8"),
};
const baselineContract = originals.contract.replace(/^ {2}compact:.*\n/m, "");
if (baselineContract === originals.contract) {
  throw new Error("Expected the ordinary compact API field.");
}
const evidence = {
  story,
  startedAt: new Date().toISOString(),
  speed: 1,
  beats: [],
  sourceChanges: [],
  errors: [],
  coreBefore: await frozenHashes(),
  passed: false,
};
const browser = await chromium.launch({
  channel: "chrome",
  headless: checkOnly,
  args: ["--window-position=0,0", "--window-size=850,990"],
});
const context = await browser.newContext({
  viewport: story.app,
  deviceScaleFactor: 1,
});
const page = await context.newPage();
page.setDefaultTimeout(20_000);
let inspector;
const captures = [];

const captureWindow = async (target, name) => {
  const session = await context.newCDPSession(target);
  const frames = [];
  const pending = [];
  await mkdir(`${directory}/${name}`);
  session.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    const file = `${name}/${String(frames.length).padStart(5, "0")}.jpg`;
    frames.push({ file, at: metadata.timestamp * 1000 });
    pending.push(
      writeFile(`${directory}/${file}`, Buffer.from(data, "base64")),
    );
    void session.send("Page.screencastFrameAck", { sessionId });
  });
  await session.send("Page.startScreencast", {
    format: "jpeg",
    quality: 95,
    everyNthFrame: 1,
  });
  return async () => {
    await session.send("Page.stopScreencast");
    await Promise.all(pending);
    await writeFile(`${directory}/${name}/frames.json`, JSON.stringify(frames));
    return { name, frames: frames.length };
  };
};
const savedState = async () =>
  (await context.request.get(`${origin}/api/v1/product`)).json();
const height = async () =>
  (await page.locator(".task").first().boundingBox()).height;
const mark = (id) => {
  const beat = story.beats.find((value) => value.id === id);
  evidence.beats.push({ ...beat, at: Date.now() });
  console.log(JSON.stringify({ beat: id, at: Date.now() }));
  return beat;
};
const observeEvents = async () => {
  const { traceChannel } = await (await fetch("/api/v1/session")).json();
  window.__launchEvents = [];
  window.__launchModelEvents = [];
  window.__launchTrace = new EventSource("/api/v1/trace");
  window.__launchTrace.onmessage = (event) =>
    window.__launchModelEvents.push(JSON.parse(event.data));
  window.__launchChannel = new BroadcastChannel(traceChannel);
  window.__launchChannel.onmessage = (event) =>
    window.__launchEvents.push(event.data);
  window.__launchCursorSamples = 0;
  window.__launchCursorTimer = setInterval(() => {
    if (!document.getElementById("agent-cursor").hidden) {
      window.__launchCursorSamples++;
    }
  }, 30);
};
const prepareWindows = async () => {
  await page.goto(`${origin}/product.html`);
  await page.locator(".task").first().waitFor();
  await page.evaluate(observeEvents);
  const popup = page.waitForEvent("popup");
  await page.getByRole("button", { name: "Open inspector" }).click();
  inspector = await popup;
  await inspector.goto(`${origin}/inspect.html?studio`);
  await inspector
    .locator("#source-code")
    .filter({ hasText: "mountFeature" })
    .waitFor();
  if (!checkOnly) {
    const protocol = await context.newCDPSession(inspector);
    const { windowId } = await protocol.send("Browser.getWindowForTarget");
    await protocol.send("Browser.setWindowBounds", {
      windowId,
      bounds: { left: 850, top: 0, width: 1010, height: 990 },
    });
  }
  await inspector.setViewportSize(story.inspector);
  for (const target of [page, inspector]) {
    target.on("pageerror", (error) => evidence.errors.push(error.message));
  }
};
const saveSource = async (file, source, selector) => {
  await inspector
    .getByLabel("Source file", { exact: true })
    .selectOption(selector);
  await writeFile(file, source);
  await inspector.locator("#source-path").filter({ hasText: file }).waitFor();
  const sha256 = createHash("sha256").update(source).digest("hex");
  await inspector.locator("#source-hash").filter({ hasText: sha256 }).waitFor();
  evidence.sourceChanges.push({ file, source, sha256, at: Date.now() });
  await page.waitForTimeout(1000);
};
const buildFeature = async () => {
  mark("build");
  await saveSource(contractPath, originals.contract, "contract");
  const withoutStyle = compactFeature().replace(
    / {2}const style =[^]*? {2}container.append\(control, style\);/,
    "  container.append(control);",
  );
  await saveSource(featurePath, withoutStyle, "feature");
  await saveSource(featurePath, compactFeature(), "feature");
  await page.waitForFunction(
    () => document.querySelector(".preferences input") !== null,
  );
};
const runRequest = async (id) => {
  const previous = await page.evaluate(() => window.__launchEvents.length);
  const beat = mark(id);
  await ask(
    page,
    beat.guided ? `Show me how to: ${beat.goal}` : beat.goal,
    true,
  );
  const events = await page.evaluate(() => window.__launchEvents);
  const result = events
    .slice(previous)
    .findLast((event) => event.kind === "verified");
  if (result?.data.result.reason !== "completed") {
    throw new Error(`${id}: request did not complete`);
  }
  return {
    saved: await savedState(),
    height: await height(),
    verification: result,
    at: Date.now(),
  };
};
const assertInitialState = async () => {
  evidence.initial = await savedState();
  evidence.beforeHeight = await height();
  const schema = await (
    await context.request.get(`${origin}/api/v1/openapi`)
  ).json();
  if (
    JSON.stringify(schema).includes('"compact"') ||
    "compact" in evidence.initial.preferences
  ) {
    throw new Error("The feature must be absent from the API and saved state.");
  }
  if (await page.getByRole("checkbox", { name: "Dark mode" }).isVisible()) {
    throw new Error("Settings must start hidden.");
  }
};
const verifyFeature = async () => {
  evidence.compact = await runRequest("use");
  if (
    evidence.compact.saved.preferences.compact !== true ||
    evidence.compact.height !== story.interactive.definition.rowHeight ||
    evidence.beforeHeight !== story.app.rowHeight
  ) {
    throw new Error("Compact state or row-height proof failed.");
  }
};
const finishEvidence = async () => {
  await page.waitForTimeout(1300);
  evidence.cursorSamples = await page.evaluate(
    () => window.__launchCursorSamples,
  );
  evidence.events = await page.evaluate(() => window.__launchEvents);
  evidence.modelEvents = await page.evaluate(() => window.__launchModelEvents);
  evidence.coreAfter = await frozenHashes();
  evidence.coreUnchanged = isDeepStrictEqual(
    evidence.coreBefore,
    evidence.coreAfter,
  );
  evidence.passed = evidence.coreUnchanged && evidence.errors.length === 0;
};
const captureHandoffFrames = async () => {
  evidence.finalFrames = {};
  for (const [name, viewport] of Object.entries(story.handoff.viewports)) {
    const final = await context.newPage();
    await final.setViewportSize(viewport);
    await final.goto(`${origin}/product.html?launch=1`);
    await final.locator(".task").first().waitFor();
    const finalHeight = (await final.locator(".task").first().boundingBox())
      .height;
    if (finalHeight !== story.interactive.definition.rowHeight) {
      throw new Error("Handoff frame must show the saved compact state.");
    }
    const file = `${directory}/final-${name}.png`;
    await final.screenshot({ path: file });
    evidence.finalFrames[name] = {
      file,
      viewport,
      rowHeight: finalHeight,
      sha256: createHash("sha256")
        .update(await readFile(file))
        .digest("hex"),
    };
    await final.close();
  }
};
const proveStory = async () => {
  await assertInitialState();
  evidence.captureStart = Date.now();
  await buildFeature();
  await verifyFeature();
  mark("proof");
  await page.waitForTimeout(1500);
  await finishEvidence();
  evidence.persisted = await savedState();
  await page.reload();
  await page.locator(".task").first().waitFor();
  evidence.reloadedHeight = await height();
  evidence.passed =
    evidence.passed &&
    evidence.reloadedHeight === story.interactive.definition.rowHeight &&
    evidence.persisted.preferences.compact === true;
  mark("finish");
  await page.waitForTimeout(story.handoff.holdMs);
  evidence.captureEnd = Date.now();
};
try {
  await writeFile(contractPath, baselineContract);
  await writeFile(featurePath, baselineFeature);
  await prepareWindows();
  if (!checkOnly) {
    captures.push(
      await captureWindow(page, "app"),
      await captureWindow(inspector, "inspector"),
    );
  }
  await page.waitForTimeout(500);
  await proveStory();
  await captureHandoffFrames();
  await page.screenshot({ path: `${directory}/app-final.png` });
  await inspector.screenshot({ path: `${directory}/inspector-final.png` });
} catch (error) {
  evidence.passed = false;
  evidence.failure = error.message;
  evidence.events = await page.evaluate(() => window.__launchEvents ?? []);
  evidence.modelEvents = await page.evaluate(
    () => window.__launchModelEvents ?? [],
  );
  evidence.captureEnd = Date.now();
  await page.screenshot({ path: `${directory}/failure.png` });
} finally {
  evidence.captures = await Promise.all(captures.map((stop) => stop()));
  await context.close();
  await browser.close();
  await writeFile(featurePath, originals.feature);
  await writeFile(contractPath, originals.contract);
  await writeFile(
    `${directory}/evidence.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    JSON.stringify({
      directory,
      passed: evidence.passed,
      failure: evidence.failure,
      duration: (evidence.captureEnd - evidence.captureStart) / 1000,
    }),
  );
  if (!evidence.passed) {
    process.exitCode = 1;
  }
}
