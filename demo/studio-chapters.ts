type Chapter = { id: string; label: string };
const timeLabel = (milliseconds: number) => {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

export class StudioChapters {
  private entries = new Map<string, HTMLButtonElement>();
  private current: string | undefined;

  constructor(private readonly review: (id: string) => void) {}

  reset(chapters: Chapter[]) {
    const focused = (document.activeElement as HTMLElement | null)?.dataset
      .chapter;
    this.entries.clear();
    this.current = undefined;
    const container = document.getElementById("chapters")!;
    container.replaceChildren();
    for (const chapter of chapters) {
      const button = document.createElement("button");
      button.textContent = chapter.label;
      button.disabled = false;
      button.dataset.chapter = chapter.id;
      button.type = "button";
      button.onclick = () => this.review(chapter.id);
      this.entries.set(chapter.id, button);
      container.append(button);
      if (focused === chapter.id) {
        button.focus();
      }
    }
  }

  reach(id: string, elapsedMs: number) {
    const next = this.entries.get(id);
    if (!next || this.current === id) {
      return;
    }
    let before = true;
    for (const [key, button] of this.entries) {
      if (key === id) {
        before = false;
      }
      button.dataset.complete = String(before);
      button.setAttribute("aria-current", key === id ? "step" : "false");
    }
    if (!next.title) {
      next.title = `${timeLabel(elapsedMs)} · ${next.textContent}`;
    }
    this.current = id;
  }
}
