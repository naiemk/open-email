import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["client/**/*.test.ts", "relayer/**/*.test.ts", "node/**/*.test.ts", "dal/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
