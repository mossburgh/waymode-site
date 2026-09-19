import {
  StaleActionError,
  type AppSurface,
  type Observation,
} from "@mossburgh/waymode/core";
import type { Control } from "@mossburgh/waymode";

type Panel = {
  name: string;
  isOpen: () => boolean;
  open: () => void;
};

const panelControl = (panel: Panel): Control => ({
  id: crypto.randomUUID(),
  name: `Open ${panel.name} in chat`,
  role: "button",
  description: `Present the app’s live ${panel.name} controls inside chat. Keeps the workspace visible; does not change saved values.`,
  disabled: panel.isOpen(),
  expanded: panel.isOpen(),
  editable: false,
});

/** Exposes host-owned live panels; their contents and handlers remain app-owned. */
export const createPanelSurface = (panels: Panel[]): AppSurface => {
  const handles = new Map<string, { panel: Panel; control: Control }>();
  const assertCurrent = (snapshot: Observation, signal: AbortSignal) => {
    signal.throwIfAborted();
    if (snapshot.controls.length !== handles.size) {
      throw new StaleActionError("The panel observation was replaced.");
    }
    for (const control of snapshot.controls) {
      const entry = handles.get(control.id);
      if (!entry || entry.panel.isOpen() !== control.expanded) {
        throw new StaleActionError("The panel state changed.");
      }
    }
  };
  return {
    observe: (signal) => {
      signal.throwIfAborted();
      handles.clear();
      const controls = panels.map(panelControl);
      controls.forEach((control, index) =>
        handles.set(control.id, { control, panel: panels[index]! }),
      );
      return { controls };
    },
    assertCurrent,
    invoke: (control, value, signal) => {
      signal.throwIfAborted();
      const entry = handles.get(control.id);
      if (!entry || value !== undefined || entry.panel.isOpen()) {
        throw new StaleActionError("The panel action is no longer available.");
      }
      handles.clear();
      entry.panel.open();
      return { status: "invoked", before: entry.control };
    },
    retire: () => handles.clear(),
  };
};
