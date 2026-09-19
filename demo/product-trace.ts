export const connectProductTrace = (consume: (json: string) => void) => {
  if (
    window.parent !== window &&
    new URLSearchParams(location.search).has("showcase")
  ) {
    const receive = (event: MessageEvent<unknown>) => {
      if (event.origin !== location.origin || event.source !== window.parent) {
        return;
      }
      const data = event.data as { type?: string; json?: unknown } | null;
      if (data?.type === "waymode:trace" && typeof data.json === "string") {
        consume(data.json);
      }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }
  const stream = new EventSource("/api/v1/trace");
  stream.onmessage = (event) => consume(event.data as string);
  return () => stream.close();
};
