export function connectAnalyticsFrames() {
  const seen = new WeakSet();
  function visit(doc) {
    if (seen.has(doc)) {
      return;
    }
    seen.add(doc);
    if (doc !== document) {
      const script = doc.createElement("script");
      script.type = "module";
      script.src = "/waymode/analytics.js";
      doc.head.append(script);
    }
    const connect = (frame) => {
      try {
        if (frame.contentDocument) {
          visit(frame.contentDocument);
        }
      } catch {
        // Only same-origin demo frames share this analytics project.
      }
    };
    doc.querySelectorAll("iframe").forEach(connect);
    doc.addEventListener(
      "load",
      (event) => {
        if (event.target.tagName === "IFRAME") {
          connect(event.target);
        }
      },
      true,
    );
  }
  visit(document);
}
