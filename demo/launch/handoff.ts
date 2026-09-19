type HandoffOptions = {
  video: HTMLVideoElement;
  overlay: HTMLElement;
  frame: HTMLIFrameElement;
  activate: HTMLButtonElement;
  replay: HTMLButtonElement;
  status: HTMLElement;
  reducedMotion: MediaQueryList;
};

class LiveHandoff {
  private ready = false;
  private live = false;
  constructor(private readonly options: HandoffOptions) {
    const { video, frame, activate, replay, reducedMotion } = options;
    frame.inert = true;
    window.addEventListener("message", this.receive);
    video.addEventListener("ended", this.ended);
    activate.addEventListener("click", this.showLive);
    replay.addEventListener("click", this.restart);
    reducedMotion.addEventListener("change", this.motionChanged);
  }
  showLive = () => {
    const { video, overlay, frame, activate, replay, status } = this.options;
    if (!this.ready || this.live) {
      return;
    }
    this.live = true;
    video.pause();
    overlay.classList.add("is-live");
    overlay.inert = true;
    frame.inert = false;
    frame.focus({ preventScroll: true });
    activate.hidden = true;
    replay.hidden = false;
    status.textContent = "Live app. Your next request runs here.";
  };
  private receive = (event: MessageEvent<unknown>) => {
    const { frame, activate, status } = this.options;
    if (
      event.origin !== location.origin ||
      event.source !== frame.contentWindow
    ) {
      return;
    }
    if (
      typeof event.data !== "object" ||
      event.data === null ||
      !("type" in event.data)
    ) {
      return;
    }
    if (event.data.type === "waymode:ready") {
      this.ready = true;
      activate.disabled = false;
      status.textContent = "The live app is ready beneath the film.";
      if (this.options.video.ended) {
        this.ended();
      }
    }
  };
  restart = () => {
    const { video, overlay, frame, activate, replay, status, reducedMotion } =
      this.options;
    this.live = false;
    overlay.inert = false;
    frame.inert = true;
    overlay.classList.remove("is-live");
    activate.hidden = false;
    replay.hidden = true;
    video.currentTime = 0;
    video.focus({ preventScroll: true });
    status.textContent = "Replay keeps your live app state.";
    if (!reducedMotion.matches) {
      void video.play().catch(() => {
        status.textContent = "Press Play to replay.";
      });
    }
  };
  private ended = () => {
    const { reducedMotion } = this.options;
    if (!reducedMotion.matches) {
      this.showLive();
    }
  };
  private motionChanged = () => {
    const { reducedMotion, video } = this.options;
    if (reducedMotion.matches) {
      video.pause();
    }
  };
  dispose = () => {
    const { video, activate, replay, reducedMotion } = this.options;
    window.removeEventListener("message", this.receive);
    video.removeEventListener("ended", this.ended);
    activate.removeEventListener("click", this.showLive);
    replay.removeEventListener("click", this.restart);
    reducedMotion.removeEventListener("change", this.motionChanged);
  };
}

export const connectHandoff = (options: HandoffOptions) =>
  new LiveHandoff(options);
