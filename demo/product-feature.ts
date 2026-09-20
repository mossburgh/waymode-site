import story from "./launch/story.json" with { type: "json" };
import { preferenceSwitch, type FeatureContext } from "./product-app.js";

export const mountFeature = ({
  root,
  container,
  state,
  save,
}: FeatureContext) => {
  const control = preferenceSwitch(
    "Compact layout",
    state.preferences.compact === true,
    (compact) => save({ preferences: { compact } }),
  );
  root.style.setProperty(
    "--task-row-height",
    `${state.preferences.compact ? story.interactive.definition.rowHeight : story.app.rowHeight}px`,
  );
  container.append(control);
};
