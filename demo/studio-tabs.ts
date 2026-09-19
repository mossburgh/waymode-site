const tabs = () => [
  ...document.querySelectorAll<HTMLButtonElement>("[role=tab][data-panel]"),
];
export const selectDevtoolsTab = (id: string, focus = false) => {
  for (const tab of tabs()) {
    const selected = tab.id === id;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    document.getElementById(tab.dataset.panel!)!.hidden = !selected;
    if (selected && focus) {
      tab.focus();
    }
  }
};
export const connectDevtoolsTabs = () => {
  const items = tabs();
  items.forEach((tab, index) => {
    tab.onclick = () => selectDevtoolsTab(tab.id);
    tab.onkeydown = (event) => {
      const targets: Record<string, number> = {
        ArrowRight: (index + 1) % items.length,
        ArrowLeft: (index + items.length - 1) % items.length,
        Home: 0,
        End: items.length - 1,
      };
      const target = targets[event.key];
      if (target !== undefined) {
        event.preventDefault();
        selectDevtoolsTab(items[target]!.id, true);
      }
    };
  });
};

export const selectStudioPanel = (panel: "product" | "tools") => {
  document.querySelector<HTMLElement>(".studio")!.dataset.panel = panel;
  document
    .querySelectorAll<HTMLButtonElement>("[data-studio-panel]")
    .forEach((button) => {
      button.setAttribute(
        "aria-pressed",
        String(button.dataset.studioPanel === panel),
      );
    });
};
export const connectStudioPanels = () => {
  document
    .querySelectorAll<HTMLButtonElement>("[data-studio-panel]")
    .forEach((button) => {
      button.onclick = () =>
        selectStudioPanel(
          button.dataset.studioPanel === "tools" ? "tools" : "product",
        );
    });
};
