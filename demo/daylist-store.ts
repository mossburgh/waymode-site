import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { patch as appPatch } from "./daylist-contract.js";

import {
  stateSchema,
  patchSchema,
  completed,
  initialState,
  type DaylistState,
  type DaylistPatch,
} from "./daylist-state.js";
export {
  initialState,
  type DaylistState,
  type DaylistPatch,
} from "./daylist-state.js";

const mergePatch = (previous: DaylistState, update: DaylistPatch) => {
  return stateSchema.parse({
    archived: previous.archived,
    preferences: { ...previous.preferences, ...update.preferences },
    completed: { ...previous.completed, ...update.completed },
  });
};

const configuredState = (state: DaylistState, next?: string) => {
  state.preferences = { dark: state.preferences.dark === true };
  if (next) {
    state.preferences[next] = false;
  }
  return state;
};

const readSavedState = (path: string): DaylistState => {
  try {
    return stateSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return initialState();
    }
    throw error;
  }
};

/** Local demo storage. Synchronous, atomic writes keep each small patch indivisible. */
export const createDaylistStore = (directory: string) => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const path = (id: string) => join(directory, `${z.uuid().parse(id)}.json`);
  const read = (id: string) => readSavedState(path(id));
  const patch = (
    id: string,
    input: unknown,
    contract: z.ZodType = appPatch,
  ) => {
    const update = patchSchema.parse(contract.parse(input));
    const next = mergePatch(read(id), update);
    return write(id, next);
  };
  const write = (id: string, next: DaylistState) => {
    writeFileSync(`${path(id)}.tmp`, JSON.stringify(next), { mode: 0o600 });
    renameSync(`${path(id)}.tmp`, path(id));
    return next;
  };
  const archiveCompleted = (id: string) => {
    const previous = read(id);
    const archived = completed
      .keyof()
      .options.filter((task) => previous.completed[task]);
    return write(id, { ...previous, archived });
  };
  const configureFeature = (id: string, next?: string) =>
    write(id, configuredState(read(id), next));
  const restore = (id: string, input: unknown) =>
    write(id, stateSchema.parse(input));
  return { read, patch, archiveCompleted, configureFeature, restore };
};
