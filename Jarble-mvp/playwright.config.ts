import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  timeout: 30_000,
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "on",
  },
  projects: [
    { name: "chromium", use: { browserName: "chromium" } },
  ],
  // Assume dev server is already running
  webServer: undefined,
});
