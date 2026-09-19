export const reportFrameSize = (element: HTMLElement) => {
  const observer = new ResizeObserver(() => {
    window.parent.postMessage(
      {
        type: "waymode:resize",
        height: Math.ceil(element.getBoundingClientRect().height),
      },
      location.origin,
    );
  });
  observer.observe(element);
  window.addEventListener("pagehide", () => observer.disconnect(), {
    once: true,
  });
};
