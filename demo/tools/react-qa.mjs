import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";

await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://localhost:4317/react.html");
  const field = page.getByLabel("Display name");
  await field.fill("Draft stays with me");
  const original = await field.elementHandle();
  await page
    .getByRole("button", { name: "Embed in chat", exact: true })
    .click();
  await expect(field).toHaveValue("Draft stays with me");
  if (
    !(await original.evaluate(
      (node) => node === document.querySelector("input"),
    ))
  ) {
    throw new Error("Portal replaced the input.");
  }
  await page.getByRole("button", { name: "Add a sample control" }).click();
  await page.getByLabel("Ask Jev").fill("Enable weekly digest.");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Weekly digest enabled" }),
  ).toBeDisabled({ timeout: 30_000 });
  await page.screenshot({ path: "artifacts/react-live-view.png" });
  await page.getByRole("button", { name: "Return to workspace" }).click();
  await expect(field).toHaveValue("Draft stays with me");
  await writeFile(
    "artifacts/react-qa.json",
    JSON.stringify(
      {
        errors,
        sameNode: await original.evaluate(
          (node) => node === document.querySelector("input"),
        ),
        draft: await field.inputValue(),
        newFeatureEnabled: true,
      },
      undefined,
      2,
    ),
  );
  console.log("React live view and newly added control verified.", { errors });
  if (errors.length) {
    throw new Error("React browser errors.");
  }
} finally {
  await browser.close();
}
