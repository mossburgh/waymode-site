import { z } from "zod";
const preferences = z
  .record(
    z
      .string()
      .regex(/^[a-z][a-zA-Z0-9]{0,31}$/)
      .refine((key) => !["constructor", "prototype"].includes(key)),
    z.union([z.boolean(), z.string().max(2000), z.number().finite()]),
  )
  .refine((value) => Object.keys(value).length <= 32);
export const completed = z
  .object({ notes: z.boolean(), draft: z.boolean(), week: z.boolean() })
  .strict();
const archived = z.array(completed.keyof()).max(3);
export const stateSchema = z
  .object({ preferences, completed, archived: archived.default([]) })
  .strict()
  .refine(
    (state) => state.archived.every((task) => state.completed[task]),
    "Archived tasks must remain completed.",
  );
export const patchSchema = z
  .object({
    preferences: preferences.optional(),
    completed: completed.partial().optional(),
  })
  .strict();
export type ProductState = z.infer<typeof stateSchema>;
export type ProductPatch = z.infer<typeof patchSchema>;
export const initialState = (): ProductState => ({
  archived: [],
  preferences: { dark: false },
  completed: { notes: false, draft: false, week: false },
});
