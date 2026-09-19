import { chromium } from "@playwright/test";
import { createCursor } from "ghost-cursor-playwright";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { frozenHashes } from "./public-demo.mjs";

const directory = `artifacts/recording-${Date.now()}`;
await mkdir(directory, { recursive: true });
const evidence = {
  startedAt: new Date().toISOString(),
  authenticator: "Chrome DevTools virtual WebAuthn authenticator",
  coreBefore: await frozenHashes(),
  decisions: [],
  errors: [],
  featureBefore: await readFile("demo/feature.ts", "utf8"),
};
const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: { dir: directory, size: { width: 1440, height: 900 } },
});
const page = await context.newPage();
const protocol = await context.newCDPSession(page);
await protocol.send("WebAuthn.enable");
await protocol.send("WebAuthn.addVirtualAuthenticator", {
  options: {
    protocol: "ctap2",
    transport: "internal",
    hasResidentKey: true,
    hasUserVerification: true,
    isUserVerified: true,
    automaticPresenceSimulation: true,
  },
});
page.on("pageerror", (error) => evidence.errors.push(error.message));
page.on("response", async (response) => {
  if (response.url().endsWith("/api/v1/decisions")) {
    evidence.decisions.push({
      status: response.status(),
      receipt: await response.json(),
    });
  }
});
const cursor = await createCursor(page);
const click = async (locator) => {
  await locator.scrollIntoViewIfNeeded();
  const bounds = await locator.boundingBox();
  if (!bounds) {
    throw new Error("Recording control is not visible.");
  }
  await cursor.actions.move({
    x: bounds.x + bounds.width / 2,
    y: bounds.y + bounds.height / 2,
  });
  await page.mouse.down();
  await page.waitForTimeout(60);
  await page.mouse.up();
};
const ask = async (goal) => {
  await click(page.getByLabel("Ask the app to do something"));
  await page.keyboard.type(goal, { delay: 32 });
  await click(page.getByRole("button", { name: "Send" }));
  await page
    .locator("#stop-button")
    .waitFor({ state: "hidden", timeout: 45_000 });
};
try {
  await page.goto("http://localhost:4317/account.html?record=1");
  await page
    .locator("#source-code")
    .filter({ hasText: "mountFeature" })
    .waitFor();
  await page.evaluate(() => {
    const pointer = document.createElement("div");
    pointer.style.cssText =
      "position:fixed;left:-30px;top:-30px;width:14px;height:14px;border-radius:50%;background:#192330;border:2px solid white;z-index:99999;pointer-events:none;transform:translate(-50%,-50%)";
    document.body.append(pointer);
    document.addEventListener("mousemove", (event) => {
      pointer.style.left = `${event.clientX}px`;
      pointer.style.top = `${event.clientY}px`;
    });
  });
  await page.waitForTimeout(1500);
  await ask("Open Settings.");
  await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
  await ask("Embed the app in chat.");
  await page.getByRole("button", { name: "Return to workspace" }).waitFor();
  await page.screenshot({ path: `${directory}/before.png` });
  if (
    await page
      .getByRole("button", { name: "Set up passkey", exact: true })
      .count()
  ) {
    throw new Error("Start the recording before adding the passkey feature.");
  }
  console.log("READY_FOR_LIVE_FEATURE_EDIT");
  await writeFile(`${directory}/ready`, evidence.startedAt);
  await page
    .getByRole("button", { name: "Set up passkey", exact: true })
    .waitFor({ timeout: 240_000 });
  evidence.featureAppearedAt = new Date().toISOString();
  await page.waitForTimeout(1200);
  await ask("Set up a passkey.");
  await page
    .getByRole("button", { name: "Confirm on this device", exact: true })
    .waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1000);
  await click(
    page.getByRole("button", { name: "Confirm on this device", exact: true }),
  );
  await page
    .getByText("Passkey saved. Verified by the server.", { exact: true })
    .waitFor({ timeout: 30_000 });
  evidence.savedStatus = await (
    await context.request.get("http://localhost:4317/api/v1/passkeys")
  ).json();
  await page.screenshot({ path: `${directory}/after.png` });
  await page.waitForTimeout(2500);
  evidence.coreAfter = await frozenHashes();
  evidence.featureAfter = await readFile("demo/feature.ts", "utf8");
  evidence.coreUnchanged =
    JSON.stringify(evidence.coreBefore) === JSON.stringify(evidence.coreAfter);
  if (
    !evidence.coreUnchanged ||
    evidence.featureBefore === evidence.featureAfter ||
    !evidence.savedStatus.registered ||
    evidence.errors.length
  ) {
    throw new Error("Recording acceptance failed.");
  }
  evidence.passed = true;
} catch (error) {
  evidence.failure = error instanceof Error ? error.message : String(error);
  await page.screenshot({ path: `${directory}/failure.png` });
  process.exitCode = 1;
} finally {
  evidence.finishedAt = new Date().toISOString();
  await context.close();
  await page.video().saveAs(`${directory}/waymode-raw.webm`);
  await browser.close();
  await writeFile(
    `${directory}/evidence.json`,
    JSON.stringify(evidence, undefined, 2),
  );
  console.log(
    JSON.stringify({
      passed: evidence.passed,
      failure: evidence.failure,
      calls: evidence.decisions.length,
      coreUnchanged: evidence.coreUnchanged,
      savedStatus: evidence.savedStatus,
    }),
  );
}
