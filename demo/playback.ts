export type Seek = { chapter: string; elapsedMs?: number; paused: boolean };

export class Playback {
  readonly controller = new AbortController();
  paused = false;
  private elapsed = 0;
  private started = performance.now();

  constructor(private target?: Seek) {}

  get seeking() {
    return this.target !== undefined;
  }

  async checkpoint(id: string) {
    if (this.target && (this.target.chapter === id || id === "verify")) {
      const target = this.target;
      this.target = undefined;
      this.elapsed = target.elapsedMs ?? this.elapsedMs;
      this.started = performance.now();
      if (target.paused) {
        this.pause();
      }
    }
    await this.wait();
  }

  get signal() {
    return this.controller.signal;
  }

  startClock() {
    this.elapsed = 0;
    this.started = performance.now();
  }

  get elapsedMs() {
    return this.elapsed + (this.paused ? 0 : performance.now() - this.started);
  }

  pause() {
    if (this.target) {
      this.target.paused = true;
    }
    if (!this.paused) {
      this.elapsed = this.elapsedMs;
      this.paused = true;
    }
  }

  resume() {
    if (this.target) {
      this.target.paused = false;
    }
    if (this.paused) {
      this.started = performance.now();
      this.paused = false;
    }
  }

  abort() {
    this.pause();
    this.controller.abort();
  }

  async wait(milliseconds = 0) {
    if (this.seeking) {
      this.signal.throwIfAborted();
      this.elapsed += milliseconds;
      return;
    }
    const until = this.elapsedMs + milliseconds;
    while (this.paused || this.elapsedMs < until) {
      this.signal.throwIfAborted();
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    this.signal.throwIfAborted();
  }
}
