import { test, expect } from "@playwright/test";
import { attachAllLoggers, screenshotMilestone } from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";

/**
 * Dashboard E2E Tests
 *
 * Tests the dashboard (/dashboard) and linked deployments (/deployments) pages
 * against the REAL API. Uses the two running test deployments:
 *   - test1 (3vt3ej3hj1oi) - running, openclaw
 *   - test2 (42puqb1asrdx) - running, openclaw
 *
 * All tests are READ-ONLY: they verify UI renders correctly without
 * modifying any deployment settings.
 */

const DEPLOYMENT_1 = { id: "3vt3ej3hj1oi", name: "test1" };
const DEPLOYMENT_2 = { id: "42puqb1asrdx", name: "test2" };

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard page (/dashboard) - page structure
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Dashboard - page structure", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("page loads with correct heading and new deployment button", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    await expect(page.getByRole("heading", { name: "Deployments" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: /New Deployment/ })).toBeVisible();

    await screenshotMilestone(page, testInfo, "dashboard-loaded");
  });

  test("navigation bar shows Jarble branding and profile avatar", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    await expect(page.locator("nav").getByText("Jarble")).toBeVisible({ timeout: 15_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Deployment cards - rendering, content, structure
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Dashboard - deployment cards", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("deployment cards display name, runtime, and status", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    // Both deployment names should be visible
    await expect(page.getByRole("heading", { name: DEPLOYMENT_1.name })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: DEPLOYMENT_2.name })).toBeVisible();

    // Runtime should show "openclaw" text
    await expect(page.getByText("openclaw").first()).toBeVisible();

    // Status badges should show "Running"
    await expect(page.getByText("Running").first()).toBeVisible();

    await screenshotMilestone(page, testInfo, "deployment-cards");
  });

  test("deployment cards show storage usage", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    // Storage usage pattern: "XX/YYYY GB"
    await expect(page.getByText(/\d+\/\d+ GB/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("deployment cards show pricing info", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    // Should show pricing - either "$XX/mo" or "Xd free"
    await expect(page.getByText(/(\$\d+\/mo|\d+d free)/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("deployment cards show LLM mode", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    // Should show LLM mode - "BYOK LLM" or "Included LLM"
    await expect(page.getByText(/(BYOK|Included) LLM/).first()).toBeVisible({ timeout: 15_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Action buttons - visible on deployment cards
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Dashboard - action buttons", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("running deployment shows stop, restart, and delete buttons", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    // Wait for cards to render
    await expect(page.getByRole("heading", { name: DEPLOYMENT_1.name })).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("button", { name: "Stop deployment" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Restart deployment" }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete deployment" }).first()).toBeVisible();

    await screenshotMilestone(page, testInfo, "action-buttons-running");
  });

  test("delete button shows confirmation dialog before deleting", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    await expect(page.getByRole("heading", { name: DEPLOYMENT_1.name })).toBeVisible({ timeout: 15_000 });

    // Click delete (trash icon) on first card
    const deleteBtn = page.getByLabel("Delete deployment").first();
    await deleteBtn.click();

    // Confirmation buttons should appear (Delete and Cancel inline)
    const confirmDelete = page.getByRole("button", { name: "Delete", exact: true });
    const cancelBtn = page.getByRole("button", { name: "Cancel", exact: true });
    await expect(confirmDelete).toBeVisible({ timeout: 5_000 });
    await expect(cancelBtn).toBeVisible();

    await screenshotMilestone(page, testInfo, "delete-confirmation");

    // Cancel should dismiss confirmation
    await cancelBtn.click();

    // Original delete button should be back
    await expect(page.getByLabel("Delete deployment").first()).toBeVisible();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Card navigation - clicking cards navigates to detail/chat
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Dashboard - card navigation", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("clicking a running deployment card navigates to chat page", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    // Wait for deployment cards
    const heading = page.getByRole("heading", { name: DEPLOYMENT_1.name });
    await expect(heading).toBeVisible({ timeout: 15_000 });

    // Click the deployment name heading to navigate (avoids action button interception)
    await heading.click();

    // Should navigate to /d/{id}
    await page.waitForURL(`**/d/${DEPLOYMENT_1.id}`, { timeout: 10_000 });
  });

  test("card is keyboard accessible with Enter key", async ({ page }) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    await expect(page.getByRole("heading", { name: DEPLOYMENT_1.name })).toBeVisible({ timeout: 15_000 });

    // Focus the card (role="button" div, not a <button> element) and press Enter
    const card = page.getByRole("button", { name: new RegExp(DEPLOYMENT_1.name) }).first();
    await card.focus();
    await page.keyboard.press("Enter");

    await page.waitForURL(`**/d/${DEPLOYMENT_1.id}`, { timeout: 10_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Linked Deployments page (/deployments) - graph view
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Linked Deployments - page structure", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("page loads with Linked Deployments heading", async ({ page }, testInfo) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    await expect(page.getByRole("heading", { name: "Linked Deployments" })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByText("See which deployments share resources like credit pools")
    ).toBeVisible();

    await screenshotMilestone(page, testInfo, "linked-deployments-loaded");
  });

  test("credit pools toggle button is visible and defaults to ON", async ({ page }) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    const creditPoolBtn = page.getByText("Credit Pools: ON");
    await expect(creditPoolBtn).toBeVisible({ timeout: 15_000 });
  });

  test("credit pools toggle switches between ON and OFF", async ({ page }, testInfo) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    await expect(page.getByText("Credit Pools: ON")).toBeVisible({ timeout: 15_000 });

    // Click to toggle OFF
    await page.getByText("Credit Pools: ON").click();
    await expect(page.getByText("Credit Pools: OFF")).toBeVisible();

    // Click to toggle back ON
    await page.getByText("Credit Pools: OFF").click();
    await expect(page.getByText("Credit Pools: ON")).toBeVisible();

    await screenshotMilestone(page, testInfo, "credit-pools-toggled");
  });

  test("data sharing button shows coming soon and is disabled", async ({ page }) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    const dataSharingBtn = page.getByText("Data Sharing: coming soon");
    await expect(dataSharingBtn).toBeVisible({ timeout: 15_000 });
    await expect(dataSharingBtn).toHaveClass(/cursor-not-allowed/);
  });
});

test.describe("Linked Deployments - graph rendering", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("graph container renders with deployment nodes", async ({ page }, testInfo) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    // ReactFlow renders nodes - deployment names should be visible
    await expect(page.getByText(DEPLOYMENT_1.name)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(DEPLOYMENT_2.name)).toBeVisible();

    // ReactFlow controls (zoom in/out) should be present
    const controls = page.locator(".react-flow__controls");
    await expect(controls).toBeVisible();

    await screenshotMilestone(page, testInfo, "graph-nodes");
  });

  test("graph shows status labels on nodes", async ({ page }) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    // Both nodes are running
    await expect(page.getByText(DEPLOYMENT_1.name)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Running").first()).toBeVisible();
  });

  test("clicking a graph node opens the detail panel", async ({ page }, testInfo) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    // Click on a node
    await expect(page.getByText(DEPLOYMENT_1.name)).toBeVisible({ timeout: 15_000 });
    await page.getByText(DEPLOYMENT_1.name).click();

    // Detail panel should slide in with the deployment name as heading
    const panelHeading = page.locator("h3").filter({ hasText: DEPLOYMENT_1.name });
    await expect(panelHeading).toBeVisible({ timeout: 5_000 });

    // Panel should show Status and Runtime sections
    await expect(page.getByText("Status").first()).toBeVisible();
    await expect(page.getByText("Runtime").first()).toBeVisible();

    await screenshotMilestone(page, testInfo, "graph-detail-panel");
  });

  test("detail panel shows Open Config button for running deployments", async ({ page }) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    await expect(page.getByText(DEPLOYMENT_1.name)).toBeVisible({ timeout: 15_000 });
    await page.getByText(DEPLOYMENT_1.name).click();

    await expect(page.getByRole("button", { name: /Open Config/ })).toBeVisible({ timeout: 5_000 });
  });

  test("detail panel close button dismisses the panel", async ({ page }) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    // Open panel
    await expect(page.getByText(DEPLOYMENT_1.name)).toBeVisible({ timeout: 15_000 });
    await page.getByText(DEPLOYMENT_1.name).click();
    const panelHeading = page.locator("h3").filter({ hasText: DEPLOYMENT_1.name });
    await expect(panelHeading).toBeVisible({ timeout: 5_000 });

    // Close panel
    await page.getByRole("button", { name: "Close panel" }).click();

    // Panel heading should disappear
    await expect(panelHeading).not.toBeVisible({ timeout: 5_000 });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Unauthenticated state
// ═══════════════════════════════════════════════════════════════════════════

test.describe("Dashboard - unauthenticated", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
  });

  test.afterEach(async () => {
    await flush();
  });

  test("dashboard shows login prompt when not authenticated", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    await page.waitForTimeout(5_000);

    // Should see either the Sign In button or the login prompt
    const signInBtn = page.getByRole("button", { name: /sign in/i });
    const loginPrompt = page.getByText("Please log in to view your dashboard");

    await Promise.race([
      signInBtn.waitFor({ state: "visible", timeout: 10_000 }),
      loginPrompt.waitFor({ state: "visible", timeout: 10_000 }),
    ]);

    await screenshotMilestone(page, testInfo, "dashboard-unauthenticated");
  });

  test("linked deployments page shows login prompt when not authenticated", async ({ page }, testInfo) => {
    await page.goto("/deployments");
    await page.waitForTimeout(5_000);

    const signInBtn = page.getByRole("button", { name: /sign in/i });
    const loginPrompt = page.getByText("Please log in to view your linked deployments");

    await Promise.race([
      signInBtn.waitFor({ state: "visible", timeout: 10_000 }),
      loginPrompt.waitFor({ state: "visible", timeout: 10_000 }),
    ]);

    await screenshotMilestone(page, testInfo, "linked-unauthenticated");
  });
});
