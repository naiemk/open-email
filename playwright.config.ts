import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  fullyParallel: false,
  workers: 1,
  use: {
    ...devices["Desktop Chrome"],
    locale: "en-US",
    trace: "on-first-retry",
  },
  globalSetup: "./e2e/global-setup.ts",
});
