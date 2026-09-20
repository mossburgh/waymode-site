import { embedView } from "@mossburgh/waymode";
import { createChatCard } from "./chat-card.js";
import { tasks } from "./tasks.js";
import type { ProductPatch, ProductState } from "./product-store.js";

export type FeatureContext = {
  root: HTMLElement;
  container: HTMLElement;
  state: ProductState;
  save: (patch: ProductPatch) => void;
};
export const preferenceSwitch = (
  label: string,
  checked: boolean,
  change: (checked: boolean) => void,
) => {
  const row = document.createElement("label");
  row.className = "preference";
  const title = document.createElement("span");
  title.textContent = label;
  const input = document.createElement("input");
  input.type = "checkbox";
  input.setAttribute("aria-label", label);
  input.checked = checked;
  input.addEventListener("change", () => change(input.checked));
  row.append(title, input);
  return row;
};
export const readState = async (): Promise<ProductState> => {
  const response = await fetch("/api/v1/product");
  if (!response.ok) {
    throw new Error("Could not read saved state.");
  }
  return response.json() as Promise<ProductState>;
};

type ProductView = "today" | "archive" | "settings";
type App = {
  root: HTMLElement;
  content: HTMLElement;
  settings: HTMLElement;
  restoreSettings?: () => void;
  state: ProductState;
  pending: Promise<void>;
  failure: Error | undefined;
  feature: (context: FeatureContext) => void;
  view: ProductView;
  chatSettings?: ReturnType<typeof createChatCard>;
};
const renderTasks = (app: App) => {
  const { root, state, view } = app;
  const archiveOpen = view === "archive";
  root.querySelector<HTMLElement>(".tasks")!.hidden = view === "settings";
  root.querySelector(".tasks h2")!.textContent = archiveOpen
    ? "Archive"
    : "Today";
  root
    .querySelector(".tasks")!
    .setAttribute(
      "aria-label",
      archiveOpen ? "Archived tasks" : "Today’s tasks",
    );
  const list = root.querySelector(".task-list")!;
  list.replaceChildren();
  for (const { id, title, category } of tasks) {
    if (state.archived.includes(id) !== archiveOpen) {
      continue;
    }
    const row = preferenceSwitch(title, state.completed[id], (checked) =>
      save(app, { completed: { [id]: checked } }),
    );
    row.querySelector("input")!.disabled = archiveOpen;
    row.className = "task";
    row.classList.toggle("done", state.completed[id]);
    const tag = document.createElement("small");
    tag.textContent = category;
    row.append(tag);
    list.append(row);
  }
  root.querySelector(".tasks header span")!.textContent =
    `${list.children.length} tasks`;
};
const renderSettings = (app: App, settings: HTMLElement) => {
  settings.innerHTML = "<h2>Settings</h2>";
  settings.append(
    preferenceSwitch("Dark mode", app.state.preferences.dark === true, (dark) =>
      save(app, { preferences: { dark } }),
    ),
  );
  app.feature({
    root: app.root,
    container: settings,
    state: app.state,
    save: (patch) => save(app, patch),
  });
};
const refreshSettings = (app: App, container: HTMLElement) => {
  const focused = container.contains(document.activeElement)
    ? document.activeElement?.getAttribute("aria-label")
    : null;
  renderSettings(app, container);
  if (focused) {
    [...container.querySelectorAll<HTMLInputElement>("input")]
      .find((input) => input.getAttribute("aria-label") === focused)
      ?.focus();
  }
};
const openChatSettings = (app: App, container: HTMLElement) => {
  app.chatSettings ??= createChatCard(container, "Settings", () =>
    openChatSettings(app, container),
  );
  app.chatSettings.expand();
  container.classList.add("chat-settings");
  app.restoreSettings ??= embedView(app.settings, app.chatSettings.body);
  app.view = app.view === "settings" ? "today" : app.view;
  renderWorkspace(app);
  app.chatSettings.reveal();
};
const renderThemeRequests = (state: ProductState) => {
  const action = `turn ${state.preferences.dark ? "off" : "on"} dark mode`;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-theme-request]",
  )) {
    const request =
      button.dataset.themeRequest === "guide"
        ? `Show me how to ${action}`
        : action.charAt(0).toUpperCase() + action.slice(1);
    button.textContent = request;
    button.dataset.request = request;
  }
};
const renderWorkspace = (app: App) => {
  const { root, state, view } = app;
  renderThemeRequests(state);
  document.documentElement.dataset.theme = state.preferences.dark
    ? "dark"
    : "light";
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    "[data-view]",
  )) {
    button.setAttribute("aria-expanded", String(button.dataset.view === view));
  }
  root.dataset.view = view;
  root.setAttribute("aria-label", `Your Product ${view}`);
  app.settings.hidden = !app.restoreSettings && view !== "settings";
  renderTasks(app);
};
const render = (app: App) => {
  app.content.querySelector(".save-error")?.remove();
  app.chatSettings?.body.querySelector(".save-error")?.remove();
  renderWorkspace(app);
  refreshSettings(app, app.settings);
};
const save = (app: App, patch: ProductPatch) =>
  send(app, "/api/v1/product", "PATCH", patch);
const send = (
  app: App,
  path: string,
  method: string,
  input?: ProductPatch,
): void => {
  app.failure = undefined;
  app.pending = app.pending
    .then(async () => {
      const response = await fetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        throw new Error("The app could not save this change.");
      }
      app.state = (await response.json()) as ProductState;
      render(app);
    })
    .catch((error: unknown) => {
      app.failure =
        error instanceof Error
          ? error
          : new Error("The app could not save this change.", { cause: error });
      render(app);
      const notice = document.createElement("p");
      notice.setAttribute("role", "alert");
      notice.className = "save-error";
      notice.textContent = "Save failed. Your last saved state is shown.";
      app.content.append(notice);
      app.chatSettings?.body.append(notice.cloneNode(true));
    });
};
const rendered = (app: App) => ({
  view: app.chatSettings?.isExpanded()
    ? "Settings"
    : app.root.getAttribute("aria-label"),
  location: app.chatSettings?.isExpanded()
    ? "Chat"
    : app.root.parentElement?.getAttribute("aria-label"),
  theme: document.documentElement.dataset.theme,
  controls: [
    ...app.root.querySelectorAll<HTMLInputElement>(
      '.tasks input[type="checkbox"]',
    ),
    ...app.settings.querySelectorAll<HTMLInputElement>(
      'input[type="checkbox"]',
    ),
  ].map((input) => ({
    name: input.labels?.[0]?.querySelector("span")?.textContent ?? "",
    checked: input.checked,
  })),
  rowHeight: app.root.querySelector(".task")?.getBoundingClientRect().height,
});
const showView = (app: App, view: ProductView) => {
  if (view === "settings") {
    app.restoreSettings?.();
    delete app.restoreSettings;
    app.chatSettings?.collapse();
  }
  app.view = view;
  renderWorkspace(app);
};
const bindNavigation = (app: App) => {
  const { root } = app;
  for (const button of root.querySelectorAll<HTMLButtonElement>(
    "[data-view]",
  )) {
    button.onclick = () => {
      showView(app, button.dataset.view as ProductView);
    };
  }
};
export const createProduct = async (
  root: HTMLElement,
  mountFeature: (context: FeatureContext) => void,
) => {
  const state = await readState();
  root.innerHTML =
    '<nav class="app-navigation" aria-label="Your Product views"><button type="button" data-view="today">Today</button><button type="button" data-view="archive">Archive</button><button type="button" data-view="settings" aria-expanded="false" aria-controls="product-settings">Settings</button></nav><div class="app-content"><section id="product-settings" class="preferences" aria-label="Settings"></section><section class="tasks" aria-label="Today’s tasks"><header><h2>Today</h2><span></span></header><div class="task-list"></div></section></div>';
  const app: App = {
    root,
    state,
    content: root.querySelector<HTMLElement>(".app-content")!,
    settings: root.querySelector<HTMLElement>("#product-settings")!,
    pending: Promise.resolve(),
    failure: undefined,
    feature: mountFeature,
    view: "today",
  };
  bindNavigation(app);
  render(app);
  return appController(app);
};
const appController = (app: App) => {
  const { root } = app;
  return {
    show: (view: ProductView) => showView(app, view),
    refresh: async () => {
      app.state = await readState();
      render(app);
    },
    snapshot: () => structuredClone(app.state),
    rendered: () => rendered(app),
    surface: () =>
      app.chatSettings?.isExpanded() ? app.chatSettings.container : root,
    isSettingsInChatVisible: () => app.chatSettings?.isVisible() ?? false,
    revealSettingsInChat: () => app.chatSettings?.reveal(),
    isSettingsInChatExpanded: () => app.chatSettings?.isExpanded() ?? false,
    openSettingsInChat: openChatSettings.bind(null, app),
    settle: async () => {
      await app.pending;
      if (app.failure) {
        throw app.failure;
      }
    },
    feature: (next: App["feature"]) => {
      app.feature = next;
      render(app);
    },
  };
};
