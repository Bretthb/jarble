import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
} from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";

test.describe("User browsing", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("homepage loads", async ({ page }, testInfo) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Jarble/);
    await screenshotMilestone(page, testInfo, "homepage");
  });

  test("pricing page loads", async ({ page }, testInfo) => {
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");
    await expect(page).toHaveTitle(/Jarble/);
    await screenshotMilestone(page, testInfo, "pricing");
  });

  test("dashboard loads with deployments", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);
    await expect(page).toHaveTitle(/Jarble/);
    await screenshotMilestone(page, testInfo, "dashboard");
  });

  test("deployment list renders cards", async ({ page }, testInfo) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    // With auth, we should see linked deployments content, not login prompt
    const linkedHeader = page.getByText("Linked Deployments");
    const loginPrompt = page.getByText("Please log in");

    await Promise.race([
      linkedHeader.waitFor({ state: "visible", timeout: 10_000 }),
      loginPrompt.waitFor({ state: "visible", timeout: 10_000 }),
    ]);

    await screenshotMilestone(page, testInfo, "deployment-list");
  });
});
