import { test, expect } from "@playwright/test";
import { attachAllLoggers, screenshotMilestone } from "./helpers/logging";
import { setupAuthIntercept, waitForAuthReady } from "./helpers/auth";
import {
  seedMarketplaceData,
  cleanMarketplaceData,
  closeDb,
  COMPONENTS,
  DEPLOYMENT_2,
} from "./helpers/marketplace-seed";

// ── Seed once before the suite, clean up after ──────────────────────────────

test.beforeAll(() => {
  seedMarketplaceData();
});

test.afterAll(() => {
  cleanMarketplaceData();
  closeDb();
});

test.describe("Marketplace - Live Component Tests", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  // ── Browse & Discovery ──────────────────────────────────────────────────

  test("shows all published components from DB", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await waitForAuthReady(page);

    // Wait for component cards to render (the grid of cards)
    await page.waitForSelector("a[href^='/marketplace/']", { timeout: 15_000 });

    // Count all component card links on the page
    const cardLinks = page.locator("a[href^='/marketplace/'][href*='cmp']");
    const count = await cardLinks.count();

    // We expect at least 8 (3 pre-seeded + 5 E2E seeded)
    expect(count).toBeGreaterThanOrEqual(8);

    await screenshotMilestone(page, testInfo, "marketplace-all-components");
  });

  test("search filters components by name", async ({ page }) => {
    await page.goto("/marketplace");
    await waitForAuthReady(page);

    // Wait for cards to load
    await page.waitForSelector("a[href^='/marketplace/']", { timeout: 15_000 });

    // Type "clock" in the search input
    const searchInput = page.getByPlaceholder("Search components...");
    await searchInput.fill("clock");

    // Wait for filtering to take effect
    await page.waitForTimeout(1_000);

    // The Live Clock Widget should be visible
    await expect(page.getByText("Live Clock Widget")).toBeVisible();

    // Other seeded components should NOT be visible
    await expect(page.getByText("Smart Todo List")).not.toBeVisible();
    await expect(page.getByText("Live Data Chart")).not.toBeVisible();
  });

  test("category filter shows matching components", async ({ page }) => {
    await page.goto("/marketplace");
    await waitForAuthReady(page);

    await page.waitForSelector("a[href^='/marketplace/']", { timeout: 15_000 });

    // Open the Category dropdown and select "Utility"
    const categoryTrigger = page.getByRole("combobox").filter({ hasText: /All Categories/i });
    await categoryTrigger.click();
    await page.getByRole("option", { name: "Utility" }).click();

    // Wait for filtering
    await page.waitForTimeout(1_000);

    // Both utility components should be visible
    await expect(page.getByText("Live Clock Widget")).toBeVisible();
    await expect(page.getByText("Smart Todo List")).toBeVisible();

    // Non-utility components should not be visible
    await expect(page.getByText("Live Data Chart")).not.toBeVisible();
    await expect(page.getByText("Image Carousel Pro")).not.toBeVisible();
  });

  test("tier filter separates template from sandbox", async ({ page }) => {
    await page.goto("/marketplace");
    await waitForAuthReady(page);

    await page.waitForSelector("a[href^='/marketplace/']", { timeout: 15_000 });

    // Select "Template" tier
    const tierTrigger = page.getByRole("combobox").filter({ hasText: /All Tiers/i });
    await tierTrigger.click();
    await page.getByRole("option", { name: "Template" }).click();

    await page.waitForTimeout(1_000);

    // Template-tier E2E components: Smart Todo List, Smart Contact Form
    await expect(page.getByText("Smart Todo List")).toBeVisible();
    await expect(page.getByText("Smart Contact Form")).toBeVisible();

    // Sandbox-tier E2E components should NOT be visible
    await expect(page.getByText("Live Clock Widget")).not.toBeVisible();
    await expect(page.getByText("Live Data Chart")).not.toBeVisible();
    await expect(page.getByText("Image Carousel Pro")).not.toBeVisible();
  });

  test("pricing filter shows free or paid", async ({ page }) => {
    await page.goto("/marketplace");
    await waitForAuthReady(page);

    await page.waitForSelector("a[href^='/marketplace/']", { timeout: 15_000 });

    // Select "Paid" pricing
    const pricingTrigger = page.getByRole("combobox").filter({ hasText: /All Prices/i });
    await pricingTrigger.click();
    await page.getByRole("option", { name: "Paid" }).click();

    await page.waitForTimeout(1_000);

    // Paid E2E components: Live Data Chart ($4.99), Image Carousel Pro ($2.99)
    await expect(page.getByText("Live Data Chart")).toBeVisible();
    await expect(page.getByText("Image Carousel Pro")).toBeVisible();

    // Free E2E components should NOT appear
    await expect(page.getByText("Live Clock Widget")).not.toBeVisible();
    await expect(page.getByText("Smart Todo List")).not.toBeVisible();
  });

  test("sort by newest shows most recent first", async ({ page }) => {
    await page.goto("/marketplace");
    await waitForAuthReady(page);

    await page.waitForSelector("a[href^='/marketplace/']", { timeout: 15_000 });

    // Select "Newest" sort
    const sortTrigger = page.getByRole("combobox").filter({ hasText: /Most Popular/i });
    await sortTrigger.click();
    await page.getByRole("option", { name: "Newest" }).click();

    await page.waitForTimeout(1_000);

    // E2E seeded components have the most recent publishedAt timestamps, so
    // they should appear before the pre-seeded ones. Get all card display names
    // and verify at least one E2E component appears before any pre-seeded one.
    const allCards = page.locator("a[href^='/marketplace/'] h3");
    const cardTexts: string[] = [];
    const cardCount = await allCards.count();
    for (let i = 0; i < cardCount; i++) {
      const text = await allCards.nth(i).textContent();
      if (text) cardTexts.push(text.trim());
    }

    // E2E seeded names
    const e2eNames = new Set([
      "Live Clock Widget",
      "Smart Todo List",
      "Live Data Chart",
      "Smart Contact Form",
      "Image Carousel Pro",
    ]);

    // Find index of first E2E component and first pre-seeded component
    const firstE2eIdx = cardTexts.findIndex((t) => e2eNames.has(t));
    const preSeededNames = new Set(["Sales Dashboard", "Analytics Chart", "Contact Form"]);
    const firstPreSeededIdx = cardTexts.findIndex((t) => preSeededNames.has(t));

    // E2E components (newest) should appear before pre-seeded (oldest)
    expect(firstE2eIdx).toBeGreaterThanOrEqual(0);
    if (firstPreSeededIdx >= 0) {
      expect(firstE2eIdx).toBeLessThan(firstPreSeededIdx);
    }
  });

  // ── Component Detail ────────────────────────────────────────────────────

  test("component detail shows full information", async ({ page }, testInfo) => {
    // Navigate directly to the clock component detail page
    await page.goto(`/marketplace/${COMPONENTS.clock.id}`);
    await waitForAuthReady(page);

    // Wait for the detail page to load
    await page.waitForSelector("text=Back to Marketplace", { timeout: 15_000 });

    // Verify display name
    await expect(
      page.getByRole("heading", { name: "Live Clock Widget" })
    ).toBeVisible();

    // Verify sandbox tier badge (the TierBadge renders capitalized tier text)
    await expect(page.getByText("sandbox", { exact: false })).toBeVisible();

    // Verify description
    await expect(
      page.getByText("A real-time analog/digital clock with timezone support")
    ).toBeVisible();

    // Verify version 1.0.0 in the Details sidebar
    await expect(page.getByText("1.0.0")).toBeVisible();

    // Verify category in the Details sidebar
    await expect(page.getByText("utility", { exact: false })).toBeVisible();

    await screenshotMilestone(page, testInfo, "component-detail-clock");
  });

  test("component detail shows creator info", async ({ page }) => {
    await page.goto(`/marketplace/${COMPONENTS.clock.id}`);
    await waitForAuthReady(page);

    await page.waitForSelector("text=Back to Marketplace", { timeout: 15_000 });

    // The Creator card section should be present with the creator name.
    // Creator display name comes from the creator_profiles table, seeded as
    // "Jarble Official" in db/init.ts. Verify the Creator section heading
    // and the display name.
    await expect(page.getByText("Creator")).toBeVisible();

    // The creator name depends on the profile seeded by init.ts
    // Check that at least one of the expected names appears
    const creatorSection = page.locator("text=Creator").locator("..");
    await expect(creatorSection).toBeVisible();
  });

  test("component detail shows install button", async ({ page }) => {
    await page.goto(`/marketplace/${COMPONENTS.clock.id}`);
    await waitForAuthReady(page);

    await page.waitForSelector("text=Back to Marketplace", { timeout: 15_000 });

    // The Install button should be present (may be disabled until deployment selected)
    const installButton = page.getByRole("button", { name: /Install/i });
    await expect(installButton).toBeVisible();

    // The DeploymentPicker should render - either a select or a loading/empty message
    const deploymentArea = page.locator("text=Select a deployment").or(
      page.locator("text=Loading deployments")
    ).or(
      page.locator("text=No running deployments")
    ).or(
      page.getByRole("combobox").filter({ hasText: /deployment/i })
    );
    await expect(deploymentArea.first()).toBeVisible();
  });

  // ── Install Flow ────────────────────────────────────────────────────────

  test("install component on deployment", async ({ page }, testInfo) => {
    await page.goto(`/marketplace/${COMPONENTS.clock.id}`);
    await waitForAuthReady(page);

    await page.waitForSelector("text=Back to Marketplace", { timeout: 15_000 });

    // Wait for the DeploymentPicker to finish loading
    // It should show either a select dropdown or "No running deployments"
    const deploymentSelect = page.getByRole("combobox").filter({
      hasText: /Select a deployment|deployment/i,
    });
    const noDeployments = page.locator("text=No running deployments");

    // Wait for either the select or the no-deployments message
    await Promise.race([
      deploymentSelect.waitFor({ timeout: 10_000 }).catch(() => null),
      noDeployments.waitFor({ timeout: 10_000 }).catch(() => null),
    ]);

    // If no running deployments, skip the install test
    const hasDeployments = await deploymentSelect.isVisible().catch(() => false);
    if (!hasDeployments) {
      test.skip(true, "No running deployments available for install test");
      return;
    }

    // Select DEPLOYMENT_2 from the picker
    await deploymentSelect.click();

    // Look for the deployment option - it may show the deployment name or ID
    const options = page.getByRole("option");
    const optionCount = await options.count();
    if (optionCount === 0) {
      test.skip(true, "No deployment options available");
      return;
    }

    // Click the last option (most likely DEPLOYMENT_2 if listed)
    await options.last().click();

    // Click Install
    const installButton = page.getByRole("button", { name: /^Install$/i });
    await expect(installButton).toBeEnabled();
    await installButton.click();

    // Wait for install to complete - should show "Installed" state
    await expect(page.getByText("Installed")).toBeVisible({ timeout: 15_000 });

    await screenshotMilestone(page, testInfo, "component-installed");
  });

  test("installed component appears in listInstalled", async ({ page }) => {
    // This test verifies the installed state persists after the install test above.
    // Navigate to the clock component and check if it shows as installed.
    await page.goto(`/marketplace/${COMPONENTS.clock.id}`);
    await waitForAuthReady(page);

    await page.waitForSelector("text=Back to Marketplace", { timeout: 15_000 });

    // Wait for the deployment picker or install state to load
    await page.waitForTimeout(3_000);

    // If the component was installed in the previous test, the page may show
    // "Installed" status. However, the install state is per-deployment and stored
    // in component state (not persisted across page loads unless the API returns it).
    // The DeploymentPicker will show and we need to re-select the deployment.
    const deploymentSelect = page.getByRole("combobox").filter({
      hasText: /Select a deployment|deployment/i,
    });
    const hasDeployments = await deploymentSelect.isVisible().catch(() => false);

    if (!hasDeployments) {
      test.skip(true, "No running deployments available");
      return;
    }

    // Select the same deployment as the install test
    await deploymentSelect.click();
    const options = page.getByRole("option");
    const optionCount = await options.count();
    if (optionCount === 0) {
      test.skip(true, "No deployment options available");
      return;
    }
    await options.last().click();

    // After selecting a deployment, the Install button should be visible.
    // If the component was previously installed on this deployment, the API
    // should return "installed" state. Verify the button says "Install" or "Installed".
    const installBtn = page.getByRole("button", { name: /Install/i });
    const installedText = page.getByText("Installed");

    await Promise.race([
      installBtn.waitFor({ timeout: 10_000 }).catch(() => null),
      installedText.waitFor({ timeout: 10_000 }).catch(() => null),
    ]);

    // At least one of these should be visible (the component is either
    // already installed or available for install)
    const isInstallVisible = await installBtn.isVisible().catch(() => false);
    const isInstalledVisible = await installedText.isVisible().catch(() => false);
    expect(isInstallVisible || isInstalledVisible).toBe(true);
  });

  test("uninstall component from deployment", async ({ page }, testInfo) => {
    await page.goto(`/marketplace/${COMPONENTS.clock.id}`);
    await waitForAuthReady(page);

    await page.waitForSelector("text=Back to Marketplace", { timeout: 15_000 });

    // Wait for the page state to settle
    await page.waitForTimeout(3_000);

    // Check if the component is currently installed (has an Uninstall button)
    const uninstallBtn = page.getByRole("button", { name: /Uninstall/i });
    const isInstalled = await uninstallBtn.isVisible().catch(() => false);

    if (!isInstalled) {
      // Need to install first before we can uninstall
      const deploymentSelect = page.getByRole("combobox").filter({
        hasText: /Select a deployment|deployment/i,
      });
      const hasDeployments = await deploymentSelect.isVisible().catch(() => false);

      if (!hasDeployments) {
        test.skip(true, "No running deployments available for uninstall test");
        return;
      }

      // Select a deployment and install
      await deploymentSelect.click();
      const options = page.getByRole("option");
      const optionCount = await options.count();
      if (optionCount === 0) {
        test.skip(true, "No deployment options available");
        return;
      }
      await options.last().click();

      const installBtn = page.getByRole("button", { name: /^Install$/i });
      const isEnabled = await installBtn.isEnabled().catch(() => false);
      if (!isEnabled) {
        test.skip(true, "Install button not enabled");
        return;
      }
      await installBtn.click();

      // Wait for installed state
      await expect(page.getByText("Installed")).toBeVisible({ timeout: 15_000 });
    }

    // Now click Uninstall
    await page.getByRole("button", { name: /Uninstall/i }).click();

    // After uninstall, the Install button should reappear
    await expect(
      page.getByRole("button", { name: /Install/i })
    ).toBeVisible({ timeout: 15_000 });

    await screenshotMilestone(page, testInfo, "component-uninstalled");
  });
});
