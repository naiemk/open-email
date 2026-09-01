import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "node/web/src"),
      "@client": resolve(__dirname, "client/src"),
    },
  },
  test: {
    include: [
      "client/**/*.test.ts",
      "relayer/**/*.test.ts",
      "node/**/*.test.ts",
      "node/web/**/*.test.ts",
      "dal/**/*.test.ts",
    ],
    fileParallelism: false,
    testTimeout: process.env.RUN_L2_TESTS ? 180_000 : 60_000,
    hookTimeout: process.env.RUN_L2_TESTS ? 180_000 : 60_000,
  },
});
