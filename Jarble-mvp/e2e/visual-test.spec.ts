import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
  getTestConfig,
} from "./helpers/logging";
import { setupAuthIntercept, waitForAuthReady } from "./helpers/auth";

test.describe("Visual testing — authenticated flows", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;

    // Intercept Auth0 token refresh to prevent rotation invalidation
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("homepage — authenticated user sees nav changes", async ({ page }, testInfo) => {
    await page.goto("/");
    await page.waitForTimeout(3_000);
    await screenshotMilestone(page, testInfo, "homepage-authed");
  });

  test("dashboard — shows user content", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    await waitForAuthReady(page);
    await screenshotMilestone(page, testInfo, "dashboard-authed");
  });

  test("deployments — linked graph view", async ({ page }, testInfo) => {
    await page.goto("/deployments");
    await waitForAuthReady(page);
    await screenshotMilestone(page, testInfo, "deployments-graph");
  });

  test("deployment chat page — loads UI", async ({ page }, testInfo) => {
    const config = getTestConfig();
    test.skip(!config.deploymentId, "No deploymentId configured");

    await page.goto(`/d/${config.deploymentId}`);
    await page.waitForTimeout(5_000);
    await screenshotMilestone(page, testInfo, "chat-page");

    // Check for chat textarea
    const textarea = page.locator("textarea");
    const hasInput = await textarea.isVisible().catch(() => false);
    if (hasInput) {
      await screenshotMilestone(page, testInfo, "chat-with-input");
    }
  });

  test("deployment chat — send stat_grid prompt", async ({ page }, testInfo) => {
    const config = getTestConfig();
    test.skip(!config.deploymentId, "No deploymentId configured");

    await page.goto(`/d/${config.deploymentId}`);
    await page.waitForTimeout(5_000);

    const textarea = page.locator("textarea");
    test.skip(!(await textarea.isVisible().catch(() => false)), "No chat input — bot not accessible");

    await textarea.fill("Show me a stat grid with 4 metrics: Revenue ($1.2M), Users (45K), Growth (23%), Churn (2.1%)");
    await screenshotMilestone(page, testInfo, "prompt-filled");

    await page.locator('button[type="submit"]').click();

    // Wait for response
    const spinner = page.locator('button[type="submit"] svg.animate-spin');
    await spinner.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    await spinner.waitFor({ state: "hidden", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3_000);

    await screenshotMilestone(page, testInfo, "response-stat-grid");

    // Screenshot canvas if visible
    const canvas = page.locator("[data-card-id]").first();
    if (await canvas.isVisible().catch(() => false)) {
      await screenshotMilestone(page, testInfo, "canvas-stat-grid");
    }
  });

  test("deployment chat — send chart prompt", async ({ page }, testInfo) => {
    const config = getTestConfig();
    test.skip(!config.deploymentId, "No deploymentId configured");

    await page.goto(`/d/${config.deploymentId}`);
    await page.waitForTimeout(5_000);

    const textarea = page.locator("textarea");
    test.skip(!(await textarea.isVisible().catch(() => false)), "No chat input");

    await textarea.fill("Show me a bar chart of the top 5 programming languages by popularity");
    await page.locator('button[type="submit"]').click();

    const spinner = page.locator('button[type="submit"] svg.animate-spin');
    await spinner.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    await spinner.waitFor({ state: "hidden", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3_000);

    await screenshotMilestone(page, testInfo, "response-chart");
  });

  test("deployment chat — send data_table prompt", async ({ page }, testInfo) => {
    const config = getTestConfig();
    test.skip(!config.deploymentId, "No deploymentId configured");

    await page.goto(`/d/${config.deploymentId}`);
    await page.waitForTimeout(5_000);

    const textarea = page.locator("textarea");
    test.skip(!(await textarea.isVisible().catch(() => false)), "No chat input");

    await textarea.fill("Create a data table showing 5 fictional employees with name, role, department, and salary");
    await page.locator('button[type="submit"]').click();

    const spinner = page.locator('button[type="submit"] svg.animate-spin');
    await spinner.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {});
    await spinner.waitFor({ state: "hidden", timeout: 60_000 }).catch(() => {});
    await page.waitForTimeout(3_000);

    await screenshotMilestone(page, testInfo, "response-data-table");
  });

  test("marketplace — browse components", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await screenshotMilestone(page, testInfo, "marketplace-browse");
  });

  test("pricing — full page scroll", async ({ page }, testInfo) => {
    await page.goto("/pricing");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);
    await screenshotMilestone(page, testInfo, "pricing-top");
    await page.evaluate(() => window.scrollBy(0, 800));
    await page.waitForTimeout(500);
    await screenshotMilestone(page, testInfo, "pricing-bottom");
  });
});
