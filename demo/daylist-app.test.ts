// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { mountFeature } from "./daylist-feature.js";
import { createDaylist } from "./daylist-app.js";
import { initialState } from "./daylist-store.js";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
});

it("recovers from a rejected save and settles the next native change", async () => {
  const saved = initialState();
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(Response.json(saved))
    .mockResolvedValueOnce(new Response(null, { status: 500 }))
    .mockResolvedValueOnce(
      Response.json({
        ...saved,
        completed: { ...saved.completed, notes: true },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  const root = document.createElement("main");
  document.body.append(root);
  const app = await createDaylist(root, () => {});
  root.querySelector<HTMLInputElement>('.task input[type="checkbox"]')!.click();
  await expect(app.settle()).rejects.toThrow("The app could not save");
  expect(app.snapshot()).toEqual(saved);
  expect(root.querySelector('[role="alert"]')?.textContent).toContain(
    "Save failed",
  );
  root.querySelector<HTMLInputElement>('.task input[type="checkbox"]')!.click();
  await app.settle();
  expect(app.snapshot().completed.notes).toBe(true);
  expect(
    root.querySelector<HTMLInputElement>('.task input[type="checkbox"]')!
      .checked,
  ).toBe(true);
  expect(root.querySelector('[role="alert"]')).toBeNull();
});

const failingSave = async (reason: unknown) => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(initialState()))
      .mockRejectedValueOnce(reason),
  );
  const root = document.createElement("main");
  document.body.append(root);
  const app = await createDaylist(root, () => {});
  root.querySelector<HTMLInputElement>(".task input")!.click();
  return app;
};
it("preserves the original Error from a rejected save", async () => {
  const reason = new Error("network unavailable");
  const app = await failingSave(reason);
  await expect(app.settle()).rejects.toBe(reason);
  expect(app.snapshot()).toEqual(initialState());
});
it("wraps a non-Error save failure with the original cause", async () => {
  const app = await failingSave("network unavailable");
  await expect(app.settle()).rejects.toMatchObject({
    message: "The app could not save this change.",
    cause: "network unavailable",
  });
  expect(app.snapshot()).toEqual(initialState());
});

it("keeps the workspace visible when live settings save from chat", async () => {
  const state = initialState();
  const updated = {
    ...state,
    preferences: { ...state.preferences, dark: true },
  };
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(state))
      .mockResolvedValueOnce(Response.json(updated)),
  );
  const root = document.createElement("main");
  const chat = document.createElement("section");
  document.body.append(root, chat);
  const app = await createDaylist(root, () => {});
  app.openSettingsInChat(chat);
  expect(root.querySelectorAll(".task")).toHaveLength(3);
  expect(app.rendered().location).toBe("Chat");
  const toggle = chat.querySelector<HTMLInputElement>("input")!;
  toggle.focus();
  toggle.click();
  await app.settle();
  expect(app.snapshot().preferences.dark).toBe(true);
  expect(root.dataset.view).toBe("today");
  expect(root.parentElement).toBe(document.body);
  expect(chat.querySelector<HTMLInputElement>("input")!.checked).toBe(true);
  expect(document.activeElement).toBe(chat.querySelector("input"));
  chat.querySelector<HTMLButtonElement>(".chat-card-toggle")!.click();
  expect(chat.hidden).toBe(false);
  expect(app.isSettingsInChatExpanded()).toBe(false);
  expect(chat.querySelector("h2")?.textContent).toBe("Settings");
  expect(app.surface()).toBe(root);
});

it("refreshes the same live chat panel when a feature changes", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json(initialState())),
  );
  const root = document.createElement("main");
  const chat = document.createElement("section");
  document.body.append(root, chat);
  const app = await createDaylist(root, () => {});
  app.openSettingsInChat(chat);
  app.feature(({ container }) => {
    const label = document.createElement("span");
    label.textContent = "Dense layout";
    container.append(label);
  });
  expect(chat.textContent).toContain("Dense layout");
  expect(app.surface()).toBe(chat);
  app.feature(() => {});
  expect(chat.textContent).not.toContain("Dense layout");
});

it("a collapsed chat card keeps current state without overriding feature styling", async () => {
  const state = initialState();
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(state))
      .mockResolvedValueOnce(
        Response.json({
          ...state,
          preferences: { ...state.preferences, compact: true },
        }),
      ),
  );
  const root = document.createElement("main");
  const chat = document.createElement("section");
  document.body.append(root, chat);
  const app = await createDaylist(root, mountFeature);
  app.openSettingsInChat(chat);
  chat.querySelector<HTMLButtonElement>(".chat-card-toggle")!.click();
  app.show("settings");
  root
    .querySelector<HTMLInputElement>('input[aria-label="Compact layout"]')!
    .click();
  await app.settle();
  expect(root.style.getPropertyValue("--task-row-height")).toBe("36px");
  expect(app.isSettingsInChatExpanded()).toBe(false);
  chat.querySelector<HTMLButtonElement>(".chat-card-toggle")!.click();
  expect(
    chat.querySelector<HTMLInputElement>('input[aria-label="Compact layout"]')!
      .checked,
  ).toBe(true);
  expect(app.isSettingsInChatExpanded()).toBe(true);
});

it("reopens a retained card in place after later messages and refresh", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockImplementation(async () => Response.json(initialState())),
  );
  const root = document.createElement("main");
  const conversation = document.createElement("section");
  const chat = document.createElement("section");
  const request = document.createElement("p");
  const reply = document.createElement("p");
  document.body.append(root, conversation);
  conversation.append(chat, request);
  const app = await createDaylist(root, () => {});
  app.openSettingsInChat(chat);
  conversation.append(reply);
  const toggle = chat.querySelector<HTMLButtonElement>(".chat-card-toggle")!;
  toggle.focus();
  toggle.click();
  await app.refresh();
  expect(app.isSettingsInChatExpanded()).toBe(false);
  expect(document.activeElement).toBe(toggle);
  app.openSettingsInChat(chat);
  expect(app.isSettingsInChatExpanded()).toBe(true);
  expect([...conversation.children]).toEqual([request, chat, reply]);
  expect(chat.querySelector(".chat-card-toggle")).toBe(toggle);
});

it("updates direct and guided suggestions from saved theme state", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(initialState()))
      .mockResolvedValueOnce(
        Response.json({ ...initialState(), preferences: { dark: true } }),
      ),
  );
  const root = document.createElement("main");
  const direct = document.createElement("button");
  direct.dataset.themeRequest = "direct";
  const guided = document.createElement("button");
  guided.dataset.themeRequest = "guide";
  document.body.append(root, direct, guided);
  const app = await createDaylist(root, () => {});
  expect(direct.dataset.request).toBe("Turn on dark mode");
  expect(guided.textContent).toBe("Show me how to turn on dark mode");
  await app.refresh();
  expect(direct.textContent).toBe("Turn off dark mode");
  expect(direct.dataset.request).toBe(direct.textContent);
  expect(guided.dataset.request).toBe("Show me how to turn off dark mode");
});

it("portals the existing Settings nodes into chat and back without adding app buttons", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(Response.json(initialState())),
  );
  const root = document.createElement("main");
  const chat = document.createElement("section");
  document.body.append(root, chat);
  const app = await createDaylist(root, () => {});
  app.show("settings");
  const settings = root.querySelector<HTMLElement>("#daylist-settings")!;
  const checkbox = settings.querySelector("input")!;
  expect(settings.querySelectorAll("button")).toHaveLength(0);
  app.openSettingsInChat(chat);
  expect(chat.querySelector("#daylist-settings")).toBe(settings);
  expect(chat.querySelector("input")).toBe(checkbox);
  expect(root.querySelector("#daylist-settings")).toBeNull();
  app.show("settings");
  expect(root.querySelector("#daylist-settings")).toBe(settings);
  expect(settings.querySelector("input")).toBe(checkbox);
  expect(app.isSettingsInChatExpanded()).toBe(false);
  chat.querySelector<HTMLButtonElement>(".chat-card-toggle")!.click();
  expect(chat.querySelector("input")).toBe(checkbox);
  expect(document.querySelectorAll("#daylist-settings")).toHaveLength(1);
  expect(settings.className).toBe("preferences");
});

it("shows only preferences on Settings and restores the task list on Today", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>().mockResolvedValue(Response.json(initialState())),
  );
  const root = document.createElement("main");
  document.body.append(root);
  const app = await createDaylist(root, () => {});
  app.show("settings");
  expect(root.querySelector<HTMLElement>(".tasks")!.hidden).toBe(true);
  expect(root.querySelector<HTMLElement>(".preferences")!.hidden).toBe(false);
  app.show("today");
  expect(root.querySelector<HTMLElement>(".tasks")!.hidden).toBe(false);
  expect(root.querySelector<HTMLElement>(".preferences")!.hidden).toBe(true);
  expect(root.querySelectorAll(".task")).toHaveLength(3);
});
