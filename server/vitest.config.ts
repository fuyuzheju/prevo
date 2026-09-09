import { defineConfig } from "vitest/config";

export default defineConfig({
  server: {
    fs: {
      // allow importing the shared domain model next to server/
      allow: [".."],
    },
  },
  test: {
    globalSetup: ["tests/globalSetup.ts"],
    setupFiles: ["tests/setupEnv.ts"],
    // Tests share one sqlite file; a single worker keeps them serial.
    fileParallelism: false,
  },
});
