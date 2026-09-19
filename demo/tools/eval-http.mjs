import { chromium, expect } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import { origin } from "./public-demo.mjs";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext();
const headers = { Origin: origin };
const report = { at: new Date().toISOString(), cases: [] };
const check = async (name, run) => {
  try {
    await run();
    report.cases.push({ name, passed: true });
  } catch (error) {
    report.cases.push({ name, passed: false, error: error.message });
  }
};
const read = async (client = context) => {
  const response = await client.request.get(origin + "/api/v1/daylist");
  expect(response.status()).toBe(200);
  return response.json();
};
try {
  await check("Action start requires an established session", async () => {
    const start = () =>
      context.request.post(origin + "/api/v1/actions/start", {
        headers,
        data: { goal: "Archive completed tasks" },
      });
    expect((await start()).status()).toBe(409);
    // The response establishes the cookie. The next call binds that same owner.
    expect((await start()).status()).toBe(200);
  });
  await check(
    "Bodyless POST archives only this session's completed tasks",
    async () => {
      const seed = await context.request.patch(origin + "/api/v1/daylist", {
        headers,
        data: { completed: { notes: true, week: true } },
      });
      expect(seed.status()).toBe(200);
      const before = await read();
      const archived = await context.request.post(
        origin + "/api/v1/daylist/archive-completed",
        { headers },
      );
      expect(archived.status()).toBe(200);
      expect(await archived.json()).toEqual({
        ...before,
        archived: ["notes", "week"],
      });
      const other = await browser.newContext();
      try {
        expect((await read(other)).archived).toEqual([]);
      } finally {
        await other.close();
      }
    },
  );
  await check(
    "Cross-origin POST and archived-task uncompletion cannot write",
    async () => {
      const before = await read();
      const crossOrigin = await context.request.post(
        origin + "/api/v1/daylist/archive-completed",
        {
          headers: { Origin: "https://example.invalid" },
        },
      );
      expect(crossOrigin.status()).toBe(403);
      const uncomplete = await context.request.patch(
        origin + "/api/v1/daylist",
        {
          headers,
          data: { completed: { notes: false } },
        },
      );
      expect(uncomplete.status()).toBe(400);
      expect(await read()).toEqual(before);
    },
  );
} finally {
  await browser.close();
  await mkdir("artifacts", { recursive: true });
  const output = `artifacts/http-eval-${Date.now()}.json`;
  await writeFile(output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, ...report }));
  if (report.cases.some((row) => !row.passed)) {
    process.exitCode = 1;
  }
}
