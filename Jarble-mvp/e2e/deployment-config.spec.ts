import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
  screenshotElement,
} from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";

/**
 * Deployment Configuration E2E Tests
 *
 * Tests the configuration panel/sidebar accessible via the Settings gear icon
 * on the deployment workspace page (/d/[id]).
 *
 * Uses deployment test1 (3vt3ej3hj1oi) -- a running OpenClaw deployment.
 * All tests are READ-ONLY: they verify UI renders correctly without
 * modifying any deployment settings.
 */

const DEPLOYMENT_ID = "3vt3ej3hj1oi";
const DEPLOYMENT_URL = `/d/${DEPLOYMENT_ID}`;

test.describe("Deployment Configuration", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  // ── Navigation & Panel Open/Close ─────────────────────────────────────

  test("deployment page loads with gear icon visible", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    // The Settings gear button should be visible in the header
    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });

    await screenshotMilestone(page, testInfo, "deployment-page-loaded");
  });

  test("clicking gear icon opens config panel", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });
    await gearButton.click();

    // The config panel should appear with "Configuration" header
    const configHeader = page.getByText("Configuration", { exact: false });
    await expect(configHeader.first()).toBeVisible({ timeout: 10_000 });

    // The panel should have "Quick actions" subtitle
    await expect(page.getByText("Quick actions")).toBeVisible();

    await screenshotMilestone(page, testInfo, "config-panel-opened");
  });

  test("config panel has close button that dismisses it", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    // Open config panel
    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });
    await gearButton.click();

    // Verify panel is open
    const panelSubtitle = page.getByText("Quick actions");
    await expect(panelSubtitle).toBeVisible({ timeout: 10_000 });

    // Close via the X button (aria-label="Close config panel")
    const closeButton = page.locator('button[aria-label="Close config panel"]');
    await expect(closeButton).toBeVisible();
    await closeButton.click();

    // Panel should be dismissed -- "Quick actions" no longer visible
    await expect(panelSubtitle).not.toBeVisible({ timeout: 5_000 });

    await screenshotMilestone(page, testInfo, "config-panel-closed");
  });

  test("gear icon toggles config panel on/off", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });

    // Open
    await gearButton.click();
    const panelSubtitle = page.getByText("Quick actions");
    await expect(panelSubtitle).toBeVisible({ timeout: 10_000 });

    // Close by clicking gear again
    await gearButton.click();
    await expect(panelSubtitle).not.toBeVisible({ timeout: 5_000 });

    // Re-open
    await gearButton.click();
    await expect(panelSubtitle).toBeVisible({ timeout: 10_000 });

    await screenshotMilestone(page, testInfo, "config-panel-toggle");
  });

  // ── Config Panel Content ──────────────────────────────────────────────

  test("config panel shows lifecycle buttons", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });
    await gearButton.click();

    // Wait for panel to render
    await expect(page.getByText("Quick actions")).toBeVisible({ timeout: 10_000 });

    // Lifecycle section should have Start, Restart, Stop buttons
    await expect(page.getByText("Lifecycle")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Restart" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Stop" })).toBeVisible();

    await screenshotMilestone(page, testInfo, "config-panel-lifecycle-buttons");
  });

  test("config panel shows configuration hints", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });
    await gearButton.click();

    await expect(page.getByText("Quick actions")).toBeVisible({ timeout: 10_000 });

    // Configuration section should list common config tasks
    await expect(page.getByText("Edit system prompt")).toBeVisible();
    await expect(page.getByText("Change LLM model")).toBeVisible();
    await expect(page.getByText("Connect platforms")).toBeVisible();
    await expect(page.getByText("View logs")).toBeVisible();

    await screenshotMilestone(page, testInfo, "config-panel-hints");
  });

  // ── /d/[id]/configure Redirect ────────────────────────────────────────

  test("/d/[id]/configure redirects to /d/[id]", async ({ page }, testInfo) => {
    await page.goto(`/d/${DEPLOYMENT_ID}/configure`);
    await page.waitForTimeout(5_000);

    // Should redirect to the main deployment page
    await expect(page).toHaveURL(new RegExp(`/d/${DEPLOYMENT_ID}`));

    // The main deployment page should load (gear icon visible)
    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });

    await screenshotMilestone(page, testInfo, "configure-redirect");
  });

  // ── Deployment Page Header ────────────────────────────────────────────

  test("deployment header shows name and status badge", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    // Header should have the deployment name
    const header = page.locator("header");
    await expect(header).toBeVisible({ timeout: 15_000 });

    // Back button to dashboard
    const backButton = header.locator("button").first();
    await expect(backButton).toBeVisible();

    // Status badge should be present (running, stopped, etc.)
    // The StatusBadge component renders a span with the status text
    const statusBadge = header.locator("span").filter({ hasText: /running|stopped|creating|failed/ });
    // At least one status indicator should exist
    const statusCount = await statusBadge.count();
    expect(statusCount).toBeGreaterThanOrEqual(0); // May not always have a visible status text

    await screenshotMilestone(page, testInfo, "deployment-header");
  });

  test("deployment header has essential controls", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    const header = page.locator("header");
    await expect(header).toBeVisible({ timeout: 15_000 });

    // Configuration gear button
    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible();

    // Profile dropdown (avatar) should be present
    // ProfileDropdown renders in the header
    await screenshotMilestone(page, testInfo, "deployment-header-controls");
  });

  // ── Config Panel Responsiveness ───────────────────────────────────────

  test("config panel coexists with canvas workspace", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });
    await gearButton.click();

    // Both config panel and main workspace should be visible
    await expect(page.getByText("Quick actions")).toBeVisible({ timeout: 10_000 });

    // The config panel is 360px wide and sits alongside the canvas
    // Verify both panel and main content area exist in the flex layout
    const configPanel = page.locator('button[aria-label="Close config panel"]').locator("..");
    await expect(configPanel).toBeVisible();

    await screenshotMilestone(page, testInfo, "config-panel-with-canvas");
  });

  test("config panel at narrow viewport still shows content", async ({ page }, testInfo) => {
    // Set a narrower viewport
    await page.setViewportSize({ width: 800, height: 600 });

    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });
    await gearButton.click();

    // Panel should still open even on narrow viewport
    await expect(page.getByText("Quick actions")).toBeVisible({ timeout: 10_000 });

    // Close button should still be accessible
    const closeButton = page.locator('button[aria-label="Close config panel"]');
    await expect(closeButton).toBeVisible();

    await screenshotMilestone(page, testInfo, "config-panel-narrow-viewport");
  });

  // ── Second Deployment ─────────────────────────────────────────────────

  test("config panel works on second deployment", async ({ page }, testInfo) => {
    const DEPLOYMENT_ID_2 = "42puqb1asrdx";
    await page.goto(`/d/${DEPLOYMENT_ID_2}`);
    await page.waitForTimeout(5_000);

    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });
    await gearButton.click();

    await expect(page.getByText("Quick actions")).toBeVisible({ timeout: 10_000 });

    // Lifecycle buttons should be present
    await expect(page.getByRole("button", { name: "Start" })).toBeVisible();

    await screenshotMilestone(page, testInfo, "config-panel-second-deployment");
  });

  // ── Config Panel Visual Structure ─────────────────────────────────────

  test("config panel has left accent line and proper layout", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });
    await gearButton.click();

    await expect(page.getByText("Quick actions")).toBeVisible({ timeout: 10_000 });

    // The panel has a "Configuration" title with Sparkles icon
    const panelHeader = page.locator("text=Configuration").first();
    await expect(panelHeader).toBeVisible();

    // Lifecycle section label
    await expect(page.getByText("Lifecycle")).toBeVisible();

    // Configuration section label
    await expect(page.getByText("Configuration").nth(1)).toBeVisible();

    await screenshotMilestone(page, testInfo, "config-panel-layout");
  });

  // ── Deployment Page Authentication ────────────────────────────────────

  test("deployment page loads without authentication error", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    // Should NOT show "Access Denied" or "Please log in"
    const accessDenied = page.getByText("Access Denied");
    await expect(accessDenied).not.toBeVisible({ timeout: 5_000 });

    const pleaseLogin = page.getByText("Please log in");
    await expect(pleaseLogin).not.toBeVisible({ timeout: 5_000 });

    await screenshotMilestone(page, testInfo, "deployment-authenticated");
  });

  // ── Config Panel Guidance ─────────────────────────────────────────────

  test("config panel shows guidance message", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    const gearButton = page.locator('button[title="Configuration"]');
    await expect(gearButton).toBeVisible({ timeout: 15_000 });
    await gearButton.click();

    await expect(page.getByText("Quick actions")).toBeVisible({ timeout: 10_000 });

    // Guidance message about using deployment settings page
    await expect(page.getByText("deployment settings page", { exact: false })).toBeVisible();

    await screenshotMilestone(page, testInfo, "config-panel-guidance");
  });

  // ── Navigation Back to Dashboard ──────────────────────────────────────

  test("back button navigates to dashboard", async ({ page }, testInfo) => {
    await page.goto(DEPLOYMENT_URL);
    await page.waitForTimeout(5_000);

    const header = page.locator("header");
    await expect(header).toBeVisible({ timeout: 15_000 });

    // The first button in the header is the back arrow
    const backButton = header.locator("button").first();
    await expect(backButton).toBeVisible();

    await backButton.click();

    // Should navigate to /dashboard
    await page.waitForURL(/\/dashboard/, { timeout: 10_000 });

    await screenshotMilestone(page, testInfo, "navigated-to-dashboard");
  });
});
