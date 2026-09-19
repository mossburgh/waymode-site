import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["demo/**/*.test.{ts,tsx,mjs}", "hosted/**/*.test.ts"],
    maxWorkers: 2,
  },
});
