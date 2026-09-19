import { chromium, expect } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { origin } from "./public-demo.mjs";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const errors = [];
const evidence = { modelCalls: 0, errors };
const directory = "artifacts/public-qa";
await mkdir(directory, { recursive: true });
try {
  const context = await browser.newContext({
    viewport: { width: 840, height: 940 },
  });
  const app = await context.newPage();
  app.on("pageerror", (error) => errors.push(error.message));
  await app.goto(`${origin}/product.html`);
  const savedResponse = app.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/daylist") &&
      response.request().method() === "PATCH",
    { timeout: 10_000 },
  );
  await app.locator("[data-view=settings]").click();
  await app.getByRole("checkbox", { name: "Dark mode" }).check();
  expect((await savedResponse).status()).toBe(200);
  await expect
    .poll(
      async () =>
        (await (await context.request.get(`${origin}/api/v1/daylist`)).json())
          .preferences.dark,
    )
    .toBe(true);
  const oldSession = await (
    await context.request.get(`${origin}/api/v1/session`)
  ).json();
  await context.clearCookies();
  const inspector = await context.newPage();
  inspector.on("pageerror", (error) => errors.push(error.message));
  await inspector.goto(`${origin}/inspect.html`);
  await expect(inspector.locator("#connection")).toContainText("Connected");
  const currentSession = await (
    await context.request.get(`${origin}/api/v1/session`)
  ).json();
  expect(currentSession.traceChannel).not.toBe(oldSession.traceChannel);
  expect(
    (await (await context.request.get(`${origin}/api/v1/daylist`)).json())
      .preferences.dark,
  ).toBe(false);
  await app.evaluate((channelName) => {
    const channel = new BroadcastChannel(channelName);
    channel.postMessage({
      id: "session-isolation-witness",
      at: Date.now(),
      kind: "run",
      data: { goal: "OLD SESSION PRIVATE TEST" },
    });
    channel.close();
  }, oldSession.traceChannel);
  await inspector.waitForTimeout(200);
  await expect(inspector.locator("#goal")).not.toContainText(
    "OLD SESSION PRIVATE TEST",
  );
  evidence.sessionRotation =
    "new channel, isolated state, old channel event ignored";
  await inspector.getByRole("tab", { name: "Feature source" }).click();
  await expect(inspector.locator("#source-code")).toContainText("mountFeature");
  await inspector.screenshot({ path: `${directory}/source.png` });
  await app.setViewportSize({ width: 390, height: 844 });
  await app.reload();
  await app.locator("[data-view=settings]").click();
  await app.getByRole("checkbox", { name: "Dark mode" }).waitFor();
  expect(
    await app.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await app.screenshot({ path: `${directory}/mobile.png`, fullPage: true });
  evidence.mobile = "390px viewport; no horizontal overflow";
  const foreign = await context.request.patch(`${origin}/api/v1/daylist`, {
    headers: { Origin: "https://example.invalid" },
    data: { preferences: { dark: true } },
  });
  expect(foreign.status()).toBe(403);
  evidence.foreignOrigin = "403";
  await app.goto(`${origin}/account.html`);
  await expect(app.locator("#source-path")).toHaveText("demo/feature.ts");
  evidence.accountSource = "legacy account source preserved";
  expect(errors).toEqual([]);
  evidence.passed = true;
} catch (error) {
  evidence.failure = error.message;
  process.exitCode = 1;
} finally {
  await browser.close();
  await writeFile(
    `${directory}/evidence.json`,
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
}
