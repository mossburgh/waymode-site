import { z } from "zod";
import type { DemoSessionState } from "./session.js";
import type * as AppContract from "./daylist-contract.js";

export const featureDefinition = z.strictObject({
  field: z
    .string()
    .regex(/^[a-z][a-zA-Z0-9]{0,31}$/)
    .refine((key) => !["dark", "constructor", "prototype"].includes(key)),
  label: z.string().trim().min(1).max(80),
  rowHeight: z.number().int().min(36).max(72),
});
export type FeatureDefinition = z.infer<typeof featureDefinition>;

export const createFeatureStore = () => {
  const definitions = new WeakMap<DemoSessionState, FeatureDefinition | null>();
  return {
    has: (session: DemoSessionState) => definitions.has(session),
    read: (session: DemoSessionState) => definitions.get(session) ?? null,
    write: (session: DemoSessionState, input: unknown) => {
      const definition = featureDefinition.nullable().parse(input);
      definitions.set(session, definition);
      return definition;
    },
  };
};

/** Compile this demo's bounded feature language into its ordinary API contract. */
export const compileFeature = (
  base: typeof AppContract,
  definition: FeatureDefinition | null,
) => {
  const fields: Record<string, z.ZodBoolean> = {
    dark: z.boolean().describe("Dark mode"),
  };
  if (definition) {
    fields[definition.field] = z.boolean().describe(definition.label);
  }
  const patch = base.patch.extend({
    preferences: z.strictObject(fields).partial().optional(),
  });
  const document = structuredClone(base.document);
  document.paths["/api/v1/daylist"].patch.requestBody.content[
    "application/json"
  ].schema = z.toJSONSchema(patch, { target: "draft-2020-12" });
  return { patch, document };
};
