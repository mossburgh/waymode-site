import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
const receipts = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("response", async (response) => {
  if (response.url().endsWith("/api/v1/decisions")) {
    receipts.push({ status: response.status(), body: await response.json() });
  }
});
try {
  await page.goto("http://localhost:4317/account.html");
  await page
    .locator("#source-code")
    .filter({ hasText: "mountFeature" })
    .waitFor();
  await page.screenshot({ path: "artifacts/baseline.png" });
  await page.getByLabel("Ask the app to do something").fill("Open Settings.");
  await page.getByRole("button", { name: "Send" }).click();
  await page
    .getByRole("heading", { name: "Settings", exact: true })
    .waitFor({ timeout: 30_000 });
  await page
    .locator("#stop-button")
    .waitFor({ state: "hidden", timeout: 30_000 });
  await page.screenshot({ path: "artifacts/jev-settings.png" });
  const evidence = {
    errors,
    receipts,
    text: await page.locator("body").innerText(),
  };
  await writeFile("artifacts/qa.json", JSON.stringify(evidence, undefined, 2));
  console.log(JSON.stringify(evidence, undefined, 2));
  if (errors.length || receipts.some((receipt) => receipt.status !== 200)) {
    throw new Error("Browser QA failed.");
  }
} finally {
  await browser.close();
}
