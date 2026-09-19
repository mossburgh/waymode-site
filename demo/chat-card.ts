const setCardExpanded = (
  toggle: HTMLButtonElement,
  body: HTMLElement,
  title: string,
  expanded: boolean,
) => {
  body.hidden = !expanded;
  toggle.setAttribute("aria-expanded", String(expanded));
  toggle.setAttribute(
    "aria-label",
    `${expanded ? "Collapse" : "Expand"} ${title}`,
  );
  toggle.textContent = expanded ? "Collapse" : title;
};
const cardIsVisible = (container: HTMLElement, body: HTMLElement) => {
  const viewport = container.parentElement?.getBoundingClientRect();
  const bounds = container.getBoundingClientRect();
  return Boolean(
    !body.hidden &&
    viewport &&
    bounds.height > 0 &&
    bounds.top >= viewport.top &&
    bounds.bottom <= viewport.bottom,
  );
};
const revealCard = (container: HTMLElement) => {
  const parent = container.parentElement;
  if (parent) {
    parent.scrollTop +=
      container.getBoundingClientRect().top -
      parent.getBoundingClientRect().top -
      8;
  }
};
export const createChatCard = (
  container: HTMLElement,
  title: string,
  onExpand?: () => void,
) => {
  const heading = document.createElement("div");
  heading.className = "chat-card-heading";
  const toggle = document.createElement("button");
  const body = document.createElement("div");
  body.id = `chat-card-${crypto.randomUUID()}`;
  body.className = "chat-card-body";
  toggle.type = "button";
  toggle.className = "chat-card-toggle";
  toggle.setAttribute("aria-controls", body.id);
  const setExpanded = (expanded: boolean) =>
    setCardExpanded(toggle, body, title, expanded);
  toggle.onclick = () => {
    if (body.hidden) {
      onExpand?.();
      setExpanded(true);
    } else {
      setExpanded(false);
    }
  };
  heading.append(toggle);
  container.replaceChildren(heading, body);
  container.hidden = false;
  container.setAttribute("aria-label", title);
  container.parentElement?.append(container);
  setExpanded(true);
  return {
    container,
    body,
    isExpanded: () => !body.hidden,
    isVisible: () => cardIsVisible(container, body),
    reveal: () => revealCard(container),
    expand: () => setExpanded(true),
    collapse: () => setExpanded(false),
  };
};
