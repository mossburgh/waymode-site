const secretKey =
  /authorization|cookie|password|secret|credential|token$|api[_-]?key|^(?:session(?:id)?|traceChannel)$/i;
export function redactText(text: string) {
  return text
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*/g, "[redacted]")
    .replace(
      /\b(?:Bearer\s+\S+|(?:sk|phx|ghp|github_pat|xox[baprs])[_-][A-Za-z0-9_-]*|(?:AKIA|ASIA)[A-Z0-9]*|eyJ[A-Za-z0-9_-]*(?:\.[A-Za-z0-9_-]*){0,2})/gi,
      "[redacted]",
    )
    .replace(
      /((?:api[_ -]?key|password|secret|token)\s*[:=]\s*)[^\s,;]+/gi,
      "$1[redacted]",
    );
}
export function cleanActivity(value: unknown, depth = 0): unknown {
  if (depth > 10) {
    return "[depth limit]";
  }
  if (typeof value === "string") {
    return redactText(value.slice(0, 16000));
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, 100)
      .map((item: unknown) => cleanActivity(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 100)
        .map(([key, item]) => [
          key,
          secretKey.test(key) ? "[redacted]" : cleanActivity(item, depth + 1),
        ]),
    );
  }
  return value;
}
export function recordActivity(
  surface: "site" | "product",
  kind: string,
  data: unknown,
) {
  try {
    const owner = window.top ?? window;
    owner.document.dispatchEvent(
      new CustomEvent("waymode:activity", {
        detail: { surface, kind, data },
      }),
    );
  } catch {
    // A cross-origin embed has no analytics bridge.
  }
}
