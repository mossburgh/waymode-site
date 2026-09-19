// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { createChatCard } from "./chat-card.js";

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

it("does not count an expanded card outside the chat viewport as presented", () => {
  const conversation = document.createElement("section");
  const container = document.createElement("section");
  conversation.append(container);
  document.body.append(conversation);
  const card = createChatCard(container, "Settings");
  vi.spyOn(conversation, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 100, 300, 200),
  );
  const bounds = vi.spyOn(container, "getBoundingClientRect");
  bounds.mockReturnValue(new DOMRect(0, -50, 300, 120));
  expect(card.isExpanded()).toBe(true);
  expect(card.isVisible()).toBe(false);
  bounds.mockReturnValue(new DOMRect(0, 110, 300, 120));
  expect(card.isVisible()).toBe(true);
  card.collapse();
  expect(card.isVisible()).toBe(false);
});

it("reveals a retained card by scrolling chat without moving its history entry", () => {
  const conversation = document.createElement("section");
  const container = document.createElement("section");
  conversation.append(container);
  document.body.append(conversation);
  const card = createChatCard(container, "Settings");
  const laterReply = document.createElement("p");
  conversation.append(laterReply);
  conversation.scrollTop = 400;
  vi.spyOn(conversation, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 100, 300, 200),
  );
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, -100, 300, 120),
  );
  card.reveal();
  expect(conversation.scrollTop).toBe(192);
  expect([...conversation.children]).toEqual([container, laterReply]);
});
