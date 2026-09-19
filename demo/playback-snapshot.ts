import { z } from "zod";
import { stateSchema } from "./daylist-state.js";
import { featureDefinition, compileFeature } from "./showcase-feature.js";
import * as contract from "./daylist-contract.js";
export const playbackSnapshot = z
  .strictObject({ state: stateSchema, feature: featureDefinition.nullable() })
  .superRefine((snapshot, context) => {
    const schema = compileFeature(contract, snapshot.feature).patch.shape
      .preferences;
    if (!schema.safeParse(snapshot.state.preferences).success) {
      context.addIssue({
        code: "custom",
        message: "Saved preferences must match the feature definition.",
      });
    }
  });
export type PlaybackSnapshot = z.infer<typeof playbackSnapshot>;
