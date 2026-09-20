import { tasks } from "./tasks.js";
import { z } from "zod";

export const preferences = z.strictObject({
  dark: z.boolean().describe("Dark mode"),
  compact: z.boolean().describe("Compact layout"),
});

export const patch = z.strictObject({
  preferences: preferences.partial().optional(),
  completed: z
    .strictObject({
      notes: z.boolean().describe(`${tasks[0].title} task completed`),
      draft: z.boolean().describe(`${tasks[1].title} task completed`),
      week: z.boolean().describe(`${tasks[2].title} task completed`),
    })
    .partial()
    .optional(),
});

export const document = {
  openapi: "3.1.0",
  info: { title: "Your Product API", version: "1.0.0" },
  paths: {
    "/api/v1/product/archive-completed": {
      post: {
        operationId: "archiveCompletedTasks",
        summary:
          "Archive completed tasks: move finished work out of Today and preserve unfinished tasks",
        responses: {
          "200": {
            description:
              "Saved product state with completed task IDs in archived",
          },
        },
      },
    },
    "/api/v1/product": {
      patch: {
        operationId: "updateProduct",
        summary: "Update saved product preferences and task completion",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: z.toJSONSchema(patch, { target: "draft-2020-12" }),
            },
          },
        },
        responses: { "200": { description: "Saved product state" } },
      },
    },
  },
};
