import assert from "node:assert/strict";

/** CDP can deliver frames out of order. Equal timestamps keep the last delivery. */
export const captureTimeline = (frames, start, end) => {
  assert.ok(Number.isFinite(start) && Number.isFinite(end) && end > start);
  const byTimestamp = new Map();
  for (const frame of frames) {
    assert.ok(Number.isFinite(frame.at), "Frame timestamp must be finite");
    assert.match(frame.file, /^(app|inspector)\/\d+\.jpg$/);
    byTimestamp.set(frame.at, frame);
  }
  const ordered = [...byTimestamp.values()].sort((a, b) => a.at - b.at);
  const first = ordered.findLast((frame) => frame.at <= start);
  assert.ok(first, "Capture must begin before the first source edit");
  const selected = [
    { ...first, at: start },
    ...ordered.filter((frame) => frame.at > start && frame.at < end),
  ];
  return selected.map((frame, index) => {
    const duration = ((selected[index + 1]?.at ?? end) - frame.at) / 1000;
    assert.ok(duration > 0, "Every frame must hold for positive time");
    return { file: frame.file, duration };
  });
};
