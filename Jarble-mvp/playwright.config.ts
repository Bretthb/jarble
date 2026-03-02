import { defineConfig, devices } from "@playwright/test";
import * as path from "path";
import * as fs from "fs";

// Use auth state if it exists (created by auth-setup.ts)
const authFile = path.join(__dirname, "e2e", ".auth", "storageState.json");
const hasAuth = fs.existsSync(authFile);

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  timeout: 120_000,
  retries: 0,
  reporter: [["html", { open: "always" }]],
  use: {
    baseURL: "http://localhost:3000",
    screenshot: "on",
    trace: "on",
    ...(hasAuth ? { storageState: authFile } : {}),
    ...devices["Desktop Chrome"],
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: true,
  },
});
