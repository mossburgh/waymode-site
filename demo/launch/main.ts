import "./launch.css";
import story from "./story.json" with { type: "json" };
import { connectHandoff } from "./handoff.js";

const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const video = get<HTMLVideoElement>("film");
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const viewport = () => {
  if (innerWidth < 600) {
    return "mobile";
  }
  return innerWidth < 1024 ? "tablet" : "desktop";
};
const stage = document.querySelector<HTMLElement>(".stage")!;
const canvas = document.querySelector<HTMLElement>(".canvas")!;
const resize = () => {
  canvas.style.transform = `scale(${stage.clientWidth / story.handoff.viewports[viewport()].width})`;
};
new ResizeObserver(resize).observe(stage);
connectHandoff({
  video,
  overlay: get("film-overlay"),
  frame: get("live-app"),
  activate: get("try-live"),
  replay: get("replay"),
  status: get("handoff-status"),
  reducedMotion,
});
for (const beat of story.beats.filter((beat) => beat.caption)) {
  const item = document.createElement("li");
  item.textContent = `${beat.start}s — ${beat.caption}`;
  get("captions").append(item);
}
const playFilm = () => {
  if (!reducedMotion.matches) {
    void video.play().catch(() => {
      get("handoff-status").textContent = "Press Play or Try it live.";
    });
  }
};
const loadFilm = async () => {
  const response = await fetch("/launch/release.json");
  if (
    !response.ok ||
    !response.headers.get("content-type")?.includes("application/json")
  ) {
    return;
  }
  const release = (await response.json()) as {
    passed: boolean;
    variants: Record<string, { video: string; poster: string }>;
    captions: string;
    evidence: string;
  };
  const asset = release.variants[viewport()];
  if (!release.passed || !asset) {
    return;
  }
  get<HTMLButtonElement>("replay").disabled = false;
  video.src = asset.video;
  video.poster = asset.poster;
  const track = document.createElement("track");
  Object.assign(track, {
    kind: "captions",
    label: "English",
    srclang: "en",
    src: release.captions,
    default: true,
  });
  video.append(track);
  get("pending").hidden = true;
  const link = get<HTMLAnchorElement>("evidence-link");
  link.href = release.evidence;
  link.hidden = false;
  get("proof-status").textContent =
    "Open the retained run to inspect the exact checks and results.";
  playFilm();
};
void loadFilm().catch(() => {
  get("proof-status").textContent =
    "The film is unavailable. The interactive app still works.";
});

get<HTMLIFrameElement>("live-app").src = "/product.html?launch=1";
