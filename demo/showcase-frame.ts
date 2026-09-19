import story from "./launch/story.json" with { type: "json" };
import {
  preferenceSwitch,
  type createDaylist,
  type FeatureContext,
} from "./daylist-app.js";
import {
  featureDefinition,
  type FeatureDefinition,
} from "./showcase-feature.js";

const renderFeature =
  (definition: FeatureDefinition | null) =>
  ({ root, container, state, save }: FeatureContext) => {
    const checked = definition && state.preferences[definition.field] === true;
    root.style.setProperty(
      "--task-row-height",
      `${checked ? definition.rowHeight : story.app.rowHeight}px`,
    );
    if (!definition) {
      return;
    }
    const control = preferenceSwitch(
      definition.label,
      checked === true,
      (value) => save({ preferences: { [definition.field]: value } }),
    );
    container.append(control);
  };

const featureNotice = (app: Awaited<ReturnType<typeof createDaylist>>) => {
  let previous = "null";
  return (definition: FeatureDefinition | null) => {
    const current = JSON.stringify(definition);
    if (current === previous) {
      return;
    }
    previous = current;
    document.getElementById("feature-announcement")!.hidden = !definition;
    document.getElementById("feature-location")!.textContent = definition
      ? `${definition.label} added to Your Product → Settings. Ready to turn on.`
      : "";
    document.getElementById("view-feature")!.onclick = () =>
      app.show("settings");
  };
};

export const connectShowcase = async (
  app: Awaited<ReturnType<typeof createDaylist>>,
) => {
  if (!new URLSearchParams(location.search).has("showcase")) {
    return;
  }
  const announceFeature = featureNotice(app);
  const refresh = async () => {
    const response = await fetch("/api/v1/feature");
    const body = (await response.json()) as { definition: unknown };
    const definition = featureDefinition.nullable().parse(body.definition);
    app.feature(renderFeature(definition));
    await app.refresh();
    announceFeature(definition);
    window.parent.postMessage({ type: "waymode:updated" }, location.origin);
  };
  await refresh();
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.origin !== location.origin || event.source !== window.parent) {
      return;
    }
    if (event.data === "waymode:refresh") {
      void refresh();
    }
  });
  for (const type of ["pointerdown", "keydown"]) {
    document.addEventListener(type, (event) => {
      if (event.isTrusted) {
        window.parent.postMessage(
          { type: "waymode:takeover" },
          location.origin,
        );
      }
    });
  }
};
