import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

export const origin =
  process.env.WAYMODE_DEMO_ORIGIN ?? "http://localhost:4317";
export const featurePath = "demo/daylist-feature.ts";
export const baselineFeature =
  'import type { FeatureContext } from "./daylist-app.js";\n\nexport const mountFeature = (context: FeatureContext) => { context.root.style.removeProperty("--task-row-height"); };\n';
export const compactFeature = (
  label = "Compact layout",
  disabled = false,
) => `import story from "./launch/story.json" with { type: "json" };
import { preferenceSwitch, type FeatureContext } from "./daylist-app.js";

export const mountFeature = ({ root, container, state, save }: FeatureContext) => {
  const control = preferenceSwitch(
    ${JSON.stringify(label)},
    state.preferences.compact === true,
    (compact) => save({ preferences: { compact } }),
  );
${disabled ? '  control.querySelector("input")!.disabled = true;\n' : ""}  root.style.setProperty("--task-row-height", String(state.preferences.compact ? story.interactive.definition.rowHeight : story.app.rowHeight) + "px");
  container.append(control);
};
`;
const hostFiles = [
  "demo/server.ts",
  "demo/daylist-app.ts",
  "demo/daylist-main.ts",
  "demo/daylist-store.ts",
  "demo/daylist.css",
  "demo/session.ts",
  "demo/studio.ts",
  "demo/studio-player.ts",
  "demo/studio-chapters.ts",
  "demo/playback.ts",
  "demo/product-trace.ts",
  "demo/request-queue.ts",
  "demo/studio-tabs.ts",
  "demo/panel-surface.ts",
  "demo/chat-card.ts",
  "demo/chat-result.ts",
  "demo/model-usage.ts",
  "demo/request-mode.ts",
  "demo/frame-size.ts",
  "demo/launch/story.json",
  "demo/studio-trace.ts",
  "demo/studio-result.ts",
  "demo/showcase-feature.ts",
  "demo/showcase-frame.ts",
  "demo/external-agent.ts",
  "demo/tools/external-agent.mjs",
];
export const frozenHashes = async () => {
  const files = (
    await readdir("node_modules/@mossburgh/waymode/dist", { recursive: true })
  )
    .filter((file) => /\.(js|ts)$/.test(file))
    .map((file) => join("node_modules/@mossburgh/waymode/dist", file));
  files.push(...hostFiles);
  return Object.fromEntries(
    await Promise.all(
      files.sort().map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(file))
          .digest("hex"),
      ]),
    ),
  );
};
export const ask = async (page, goal, type = false) => {
  const input = page.getByLabel("Ask your product to do something");
  if (type) {
    await input.click();
    await input.pressSequentially(goal, { delay: 35 });
  } else {
    await input.fill(goal);
  }
  await page.getByRole("button", { name: "Send request" }).click();
  await page.waitForFunction(
    () => document.getElementById("stop").hidden,
    {},
    { timeout: 30_000 },
  );
};

export const receiptBody = async (response) => {
  let timer;
  try {
    return await Promise.race([
      response.json(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Response body unavailable after 5 seconds.")),
          5000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

export const verifiedRun = (
  events,
  actions,
  reason = actions ? "limit" : "abstained",
) => {
  const checks = events.filter((event) => event.kind === "verified");
  const result = checks[0]?.data;
  return (
    !events.some((event) => event.kind === "error") &&
    checks.length === 1 &&
    (result.stateMatchesSaved ?? result.viewMatchesSaved) === true &&
    result.result.actions === actions &&
    result.result.reason === reason &&
    events.filter((event) => event.kind === "handler").length === actions
  );
};
