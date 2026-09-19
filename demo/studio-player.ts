import { StudioChapters } from "./studio-chapters.js";
import story from "./launch/story.json" with { type: "json" };
import { Playback } from "./playback.js";

export const interactions = story.interactive.interactions;
export type Interaction = (typeof interactions)[number];
export const interactionRequest = (interaction: Interaction, dark: boolean) =>
  interaction.request.replace("{theme}", dark ? "light" : "dark");
const get = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const clockText = (milliseconds: number) => {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

const sceneButton = (interaction: Interaction, index: number) => {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("aria-label", interaction.label);
  const number = document.createElement("span");
  number.className = "scene-number";
  number.textContent = String(index + 1).padStart(2, "0");
  const copy = document.createElement("span");
  const title = document.createElement("strong");
  title.textContent = interaction.label;
  const caption = document.createElement("small");
  caption.textContent = interaction.caption;
  copy.append(title, caption);
  button.append(number, copy);
  return button;
};

export class StudioPlayer {
  private playback: Playback | undefined;
  private live = false;
  private readonly play = get<HTMLButtonElement>("play-story");
  private readonly buttons: HTMLButtonElement[];
  private readonly times = new Map<string, number>();
  private readonly chapters = new StudioChapters((id) => {
    const elapsedMs = this.times.get(id);
    const paused = !this.playback || this.playback.paused;
    this.chapters.reach(id, elapsedMs ?? 0);
    this.phase("Seeking");
    this.seek({
      chapter: id,
      ...(elapsedMs !== undefined && { elapsedMs }),
      paused,
    });
  });
  selected = interactions[0]!;
  customRequest: string | undefined;

  constructor(
    select: (interaction: Interaction) => void,
    private readonly seek: (
      target: import("./playback.js").Seek,
    ) => void = () => {},
  ) {
    const picker = get<HTMLDialogElement>("scene-picker");
    get("open-scenes").onclick = () => picker.showModal();
    get("close-scenes").onclick = () => picker.close();
    this.buttons = interactions.map((interaction, index) => {
      const button = sceneButton(interaction, index);
      button.setAttribute(
        "aria-pressed",
        String(interaction === this.selected),
      );
      button.onclick = () => {
        this.select(interaction);
        picker.close();
        select(interaction);
      };
      get("interactions").append(button);
      return button;
    });
    this.chapters.reset(this.selected.chapters);
    const interval = window.setInterval(() => this.render(), 250);
    window.addEventListener("pagehide", () => clearInterval(interval), {
      once: true,
    });
  }

  private render() {
    const playing = this.playback && !this.playback.paused;
    const label = playing && !this.live ? "Pause" : "Play";
    this.play.dataset.state = playing && !this.live ? "playing" : "paused";
    this.play.setAttribute("aria-label", label);
    this.play.title = playing ? "Pause" : "Play selected interaction";
    get("play-label").textContent = label;
    if (this.playback) {
      get("elapsed").textContent = clockText(this.playback.elapsedMs);
    }
  }

  select(interaction: Interaction) {
    this.selected = interaction;
    this.times.clear();
    this.customRequest = undefined;
    this.buttons.forEach((button, index) => {
      button.setAttribute(
        "aria-pressed",
        String(interactions[index] === interaction),
      );
    });
    this.chapters.reset(interaction.chapters);
  }

  start(playback: Playback) {
    this.playback = playback;
    this.live = false;
    this.chapters.reset(
      this.customRequest
        ? story.interactive.requestChapters
        : this.selected.chapters,
    );
    this.phase("Playing");
    this.render();
  }

  follow(goal: string) {
    this.customRequest = goal;
    this.times.clear();
    this.chapters.reset(story.interactive.requestChapters);
    this.playback = new Playback();
    this.live = true;
    this.busy(true);
    this.buttons.forEach((button) =>
      button.setAttribute("aria-pressed", "false"),
    );
    this.phase("Your request");
    this.chapter("ask");
    this.render();
  }

  chapter(id: string) {
    const elapsedMs = this.playback?.elapsedMs ?? 0;
    if (!this.times.has(id)) {
      this.times.set(id, elapsedMs);
    }
    this.chapters.reach(id, elapsedMs);
  }

  phase(label: string) {
    get("player-phase").textContent = label;
  }

  busy(value: boolean) {
    this.play.disabled = value;
    this.buttons.forEach((button) => {
      button.disabled = value;
    });
  }

  toggle() {
    if (this.playback?.paused) {
      this.playback.resume();
      this.phase("Playing");
    } else {
      this.playback?.pause();
      this.phase("Paused");
    }
    this.render();
  }

  finish() {
    this.playback?.pause();
    this.render();
    this.playback = undefined;
    this.live = false;
    this.busy(false);
    this.render();
  }
}
