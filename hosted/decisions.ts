import {
  createOpenApiSurface,
  decisionRequestSchema,
} from "@mossburgh/waymode/server";
import type { Control, DecisionRequest } from "@mossburgh/waymode";
import { z } from "zod";
import { tasks } from "../demo/tasks.js";
import story from "../demo/launch/story.json" with { type: "json" };
import catalog from "./site-controls.json" with { type: "json" };
import type { Product } from "./product.js";
import type { Visitor } from "./store.js";
import { HttpError } from "./http.js";

type Template = Omit<Control, "id" | "disabled">;
const button = (name: string): Template => ({
  name,
  role: "button",
  editable: false,
  description: "",
});
function templates(visitor: Visitor): Template[] {
  const scenes = story.interactive.interactions;
  return [
    ...catalog,
    ...[
      "Today",
      "Archive",
      "Settings",
      "Collapse Settings",
      "Expand Settings",
      "Copied",
      "Save definition",
      "Pause",
      "Analytics preferences",
    ].map(button),
    {
      ...button("Open Settings in chat"),
      description:
        "Present the app’s live Settings controls inside chat. Keeps the workspace visible; does not change saved values.",
    },
    ...scenes.flatMap((scene) => [
      button(scene.label),
      ...scene.chapters.map((chapter) => button(chapter.label)),
    ]),
    ...[
      "Dark mode",
      ...tasks.map((task) => task.title),
      ...(visitor.feature ? [visitor.feature.label] : []),
    ].map((name) => ({
      name,
      role: "checkbox",
      description: "",
      editable: false,
    })),
    ...(visitor.feature
      ? [button(`Ask: “Turn on ${visitor.feature.label}”`)]
      : []),
  ];
}
async function backendControls(
  product: Pick<Product, "contract">,
  visitor: Visitor,
  signal: AbortSignal,
) {
  const surface = createOpenApiSurface({
    document: () => product.contract(visitor).document,
    readState: () => Promise.resolve(visitor.app),
    authorize: () => Promise.resolve("allow"),
    dispatch: () => Promise.reject(new Error("Catalog is read-only.")),
    resolveInput: () => Promise.resolve({ outcome: "abstained" }),
  });
  return (await surface.observe(signal)).controls;
}
function trustedControl(
  control: Control,
  known: Template[],
  index: number,
): Control | undefined {
  const template = known.find(
    (item) =>
      item.name.replace(/\s+/g, "") === control.name.replace(/\s+/g, "") &&
      item.role === control.role,
  );
  if (!template) {
    return undefined;
  }
  return {
    ...template,
    id: `control-${index}`,
    disabled: control.disabled,
    ...(control.checked !== undefined && { checked: control.checked }),
    ...(control.expanded !== undefined && { expanded: control.expanded }),
  };
}
const pageState = z.object({
  site: z
    .object({
      analyticsPreference: z
        .enum(["yes", "no", "unset", "blocked"])
        .default("unset"),
      analyticsMenuOpen: z.boolean().default(false),
      installPromptOpen: z.boolean().default(false),
    })
    .optional(),
});
const normalName = (name: string) => name.replace(/\s+/g, "");
function trustedHistory(
  history: string[],
  known: Template[],
  observed: Control[],
) {
  const prefixes = known
    .flatMap((control) =>
      ["Invoked", "Filled"].map(
        (verb) => `${verb} ${control.role}: ${control.name}`,
      ),
    )
    .sort((a, b) => b.length - a.length);
  const aliases = observed
    .flatMap((control) => {
      const template = known.find(
        (item) =>
          item.role === control.role &&
          normalName(item.name) === normalName(control.name),
      );
      return template
        ? ["Invoked", "Filled"].map((verb) => ({
            from: `${verb} ${control.role}: ${control.name}`,
            to: `${verb} ${template.role}: ${template.name}`,
          }))
        : [];
    })
    .sort((a, b) => b.from.length - a.from.length);
  return history.flatMap((item) => {
    const alias = aliases.find(
      ({ from }) => item === from || item.startsWith(from + " "),
    );
    if (alias) {
      return [alias.to];
    }
    const prefix = prefixes.find(
      (prefix) => item === prefix || item.startsWith(prefix + " "),
    );
    return prefix ? [prefix] : [];
  });
}
export async function siteDecision(
  input: unknown,
  visitor: Visitor,
  product: Pick<Product, "contract">,
  signal: AbortSignal,
) {
  const request = decisionRequestSchema.parse(input);
  const known = [
    ...templates(visitor),
    ...(await backendControls(product, visitor, signal)),
  ];
  const matched = matchControls(request.controls, known);
  const controls = matched.map(({ trusted }) => trusted);
  boundControls(controls);
  const page = pageState.safeParse(request.state);
  const decision: DecisionRequest = {
    goal: request.goal,
    ...(request.request && { request: request.request }),
    ...(request.action && { action: request.action }),
    ...(request.mode && { mode: request.mode }),
    controls,
    history: trustedHistory(request.history, known, request.controls),
    state: {
      product: visitor.app,
      feature: visitor.feature,
      ...(page.success && page.data.site ? { site: page.data.site } : {}),
    },
    context: {
      view: "Waymode site and Your Product demo",
      location: "https://waymode.ai/",
    },
  };
  const handles = new Map(
    matched.map(({ trusted, handle }) => [trusted.id, handle]),
  );
  return { request: decision, handles };
}

function boundControls(controls: Control[]) {
  const counts = new Map<string, number>();
  for (const control of controls) {
    const key = `${control.role}:${control.name}`;
    const count = (counts.get(key) ?? 0) + 1;
    if (count > 3) {
      throw new HttpError(400, "Too many duplicate controls.");
    }
    counts.set(key, count);
  }
  if (JSON.stringify(controls).length > 32000) {
    throw new HttpError(400, "The control catalog is too large.");
  }
}

function matchControls(controls: Control[], known: Template[]) {
  const matched = controls.flatMap((control, index) => {
    const trusted = trustedControl(control, known, index);
    return trusted ? [{ trusted, handle: control.id }] : [];
  });
  if (!matched.length) {
    throw new HttpError(
      400,
      "This model endpoint only supports Waymode site and demo controls.",
    );
  }
  return matched;
}
