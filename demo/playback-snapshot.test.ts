import { it, expect } from "vitest";
import { playbackSnapshot } from "./playback-snapshot.js";
import { initialState } from "./product-state.js";
it("restores a completed scene to its actual initial state", () => {
  const snapshot = {
    state: initialState(),
    feature: { field: "compact", label: "Compact layout", rowHeight: 36 },
  };
  snapshot.state.preferences.compact = false;
  snapshot.state.completed.notes = true;
  snapshot.state.archived = ["notes"];
  expect(playbackSnapshot.parse(snapshot)).toEqual(snapshot);
});
it("rejects a foreign state field, unsupported setting and invalid archive", () => {
  expect(
    playbackSnapshot.safeParse({
      state: initialState(),
      feature: null,
      owner: "another-session",
    }).success,
  ).toBe(false);
  const state = initialState();
  state.preferences.compact = true;
  expect(playbackSnapshot.safeParse({ state, feature: null }).success).toBe(
    false,
  );
  const archived = initialState();
  archived.archived = ["notes"];
  expect(
    playbackSnapshot.safeParse({ state: archived, feature: null }).success,
  ).toBe(false);
});
