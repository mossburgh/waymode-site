import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const directory = resolve(process.argv[2] ?? "");
const appStart = Number(process.argv[3]);
const inspectorStart = Number(process.argv[4]);
if (
  !process.argv[2] ||
  !Number.isFinite(appStart) ||
  !Number.isFinite(inspectorStart) ||
  appStart < 0 ||
  inspectorStart < 0
) {
  throw new Error(
    "Usage: compose-public DIRECTORY APP_START_SECONDS INSPECTOR_START_SECONDS. Align the same visible request submission in both captures.",
  );
}
const evidence = JSON.parse(
  await readFile(`${directory}/evidence.json`, "utf8"),
);
const review = process.argv[5] === "--review";
if (!evidence.passed && !review) {
  throw new Error("The captured run did not pass its saved-state checks.");
}
const heading = evidence.passed
  ? "Add a feature. The app can use it."
  : "Development run · completion check failed";
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><style>
  *{box-sizing:border-box}body{margin:0;background:#dfe5ef;color:#1b2b3e;font-family:system-ui,sans-serif}.heading{position:absolute;left:28px;top:20px;font-size:25px;letter-spacing:-.7px;font-weight:600}.caption{position:absolute;right:36px;top:27px;font:12px ui-monospace,monospace;color:#485970}.window{position:absolute;top:78px;height:968px;border-radius:10px;background:#f3f5f8;box-shadow:0 8px 28px #192f451a;overflow:hidden}.left{left:24px;width:840px}.right{left:884px;width:1000px}.bar{height:28px;background:#ecf0f5;display:flex;align-items:center;padding:0 12px;gap:5px;border-bottom:1px solid #cfd7e3;font:10px ui-monospace,monospace;color:#57667a}.dot{width:7px;height:7px;border-radius:50%;background:#bec8d7}.bar span:last-child{margin-left:10px}.foot{position:absolute;left:28px;right:36px;bottom:10px;display:flex;justify-content:space-between;font:10px ui-monospace,monospace;color:#485970}
  </style><div class="heading">${heading}</div><div class="caption">waymode × Jev · live browser captures · 1× speed</div><div class="window left"><div class="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span>Daylist / local app</span></div></div><div class="window right"><div class="bar"><i class="dot"></i><i class="dot"></i><i class="dot"></i><span>waymode / live inspector</span></div></div><div class="foot"><span>Ordinary app code added. SDK, prompt and integration unchanged.</span><span>Source, network, saved-state checks and eval failures retained.</span></div>`);
  await page.screenshot({ path: `${directory}/frame.png` });
} finally {
  await browser.close();
}
const output = `${directory}/waymode-daylist.mp4`;
const filters = `[1:v]trim=start=${appStart},setpts=PTS-STARTPTS,crop=840:940:0:0[app];[2:v]trim=start=${inspectorStart},setpts=PTS-STARTPTS[trace];[0:v][app]overlay=24:106:shortest=1[base];[base][trace]overlay=884:106:shortest=1[out]`;
execFileSync(
  "ffmpeg",
  [
    "-v",
    "error",
    "-y",
    "-loop",
    "1",
    "-i",
    `${directory}/frame.png`,
    "-i",
    `${directory}/app.webm`,
    "-i",
    `${directory}/inspector.webm`,
    "-filter_complex",
    filters,
    "-map",
    "[out]",
    "-r",
    "25",
    "-c:v",
    "libx264",
    "-crf",
    "18",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    output,
  ],
  { stdio: "inherit" },
);
await writeFile(
  `${directory}/composition.json`,
  JSON.stringify(
    {
      appStart,
      inspectorStart,
      speed: 1,
      passed: evidence.passed,
      review,
      method:
        "Continuous source captures aligned to the same request submission. Only startup frames trimmed; no time compression or synthetic app content. Decorative title/window frame added.",
      output,
    },
    null,
    2,
  ),
);
console.log(output);
