import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["client/**/*.test.ts", "relayer/**/*.test.ts", "node/**/*.test.ts", "dal/**/*.test.ts"],
    exclude: process.env.RUN_L2_TESTS ? [] : ["relayer/src/l2.test.ts"],
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
