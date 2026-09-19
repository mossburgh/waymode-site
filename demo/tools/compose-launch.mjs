import assert from "node:assert/strict";
import { captureTimeline } from "./capture-timeline.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  writeFile,
} from "node:fs/promises";
import { resolve, join } from "node:path";

const take = resolve(process.argv[2] ?? "");
await mkdir("brag-output", { recursive: true });
const output = await mkdtemp(resolve("brag-output/composition-"));
const evidence = JSON.parse(
  await readFile(join(take, "evidence.json"), "utf8"),
);
assert.equal(evidence.passed, true, "Only a passing take can be composed");
assert.equal(evidence.speed, 1);
assert.equal(evidence.coreUnchanged, true);
const duration = (evidence.captureEnd - evidence.captureStart) / 1000;
await mkdir(join(output, "assets"), { recursive: true });
const animation = await fetch(
  "https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js",
  { signal: AbortSignal.timeout(15_000) },
);
assert.ok(animation.ok, "Could not fetch the pinned animation runtime");
const animationBytes = Buffer.from(await animation.arrayBuffer());
assert.equal(
  createHash("sha256").update(animationBytes).digest("hex"),
  "c174bfce53a729418d57a8ad8625e7247c793a22fef8e2851e3cfa3de9cd8280",
);
await writeFile(join(output, "assets/gsap.min.js"), animationBytes);

const concatFrames = (frames) => {
  const selected = captureTimeline(
    frames,
    evidence.captureStart,
    evidence.captureEnd,
  );
  const lines = selected.flatMap((frame) => [
    `file '${join(take, frame.file).replaceAll("'", "'\\''")}'`,
    `duration ${frame.duration}`,
  ]);
  return ["ffconcat version 1.0", ...lines, lines.at(-2)].join("\n") + "\n";
};

const encodeWindow = async (name) => {
  const frames = JSON.parse(
    await readFile(join(take, name, "frames.json"), "utf8"),
  );
  const list = join(take, `${name}.ffconcat`);
  await writeFile(list, concatFrames(frames));
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      list,
      "-vf",
      `scale=${evidence.story[name].width}:${evidence.story[name].height}:force_original_aspect_ratio=decrease,fps=30`,
      "-t",
      String(duration),
      "-c:v",
      "libx264",
      "-threads",
      "2",
      "-preset",
      "ultrafast",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      join(output, "assets", `${name}.mp4`),
    ],
    { timeout: 300_000 },
  );
};
await encodeWindow("app");
await encodeWindow("inspector");
const captions = evidence.beats.map((beat, index) => {
  const start = (beat.at - evidence.captureStart) / 1000;
  const end =
    (evidence.beats[index + 1]?.at ?? evidence.captureEnd) -
    evidence.captureStart;
  return { caption: beat.caption, start, duration: end / 1000 - start };
});
const template = await readFile("demo/tools/templates/launch.html", "utf8");
const captionHtml = captions
  .map(
    (beat, index) =>
      `<h1 id="beat-${index}" class="clip caption" data-start="${beat.start}" data-duration="${beat.duration}" data-track-index="3">${beat.caption}</h1>`,
  )
  .join("\n");
await writeFile(
  join(output, "index.html"),
  template
    .replaceAll("__DURATION__", String(duration))
    .replace("__CAPTIONS__", captionHtml),
);
await copyFile(
  join(take, "evidence.json"),
  join(output, "assets", "evidence.json"),
);
console.log(
  JSON.stringify({ take, output, duration, speed: 1, windows: 2, cuts: 0 }),
);
