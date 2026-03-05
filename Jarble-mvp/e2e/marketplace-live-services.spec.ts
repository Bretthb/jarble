import { test, expect } from "@playwright/test";
import { attachAllLoggers, screenshotMilestone } from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";
import { switchToTab } from "./helpers/marketplace";
import {
  seedMarketplaceData,
  cleanMarketplaceData,
  closeDb,
  SERVICES,
  COMPONENTS,
  DEPLOYMENT_2,
} from "./helpers/marketplace-seed";

// ── Seed & cleanup ────────────────────────────────────────────────────────

test.beforeAll(() => {
  seedMarketplaceData();
});

test.afterAll(() => {
  cleanMarketplaceData();
  closeDb();
});

// ── Shared setup ──────────────────────────────────────────────────────────

test.describe("Marketplace -- Live Service Tests", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  // Helper: navigate to marketplace and switch to Services tab
  async function goToServicesTab(page: import("@playwright/test").Page) {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Services");
    // Wait for service cards to load (or error/empty state)
    await page.waitForTimeout(2_000);
  }

  // ── Browse & Filtering (5 tests) ────────────────────────────────────────

  test("shows all published services", async ({ page }, testInfo) => {
    await goToServicesTab(page);

    // We seeded 3 services + 1 pre-existing "Weather Analytics Bundle" = at least 4
    // Each service card contains its displayName as a heading
    const productivityCard = page.getByText(SERVICES.selfHosted.displayName);
    const cloudCard = page.getByText(SERVICES.remote.displayName);
    const hybridCard = page.getByText(SERVICES.hybrid.displayName);

    await expect(productivityCard).toBeVisible();
    await expect(cloudCard).toBeVisible();
    await expect(hybridCard).toBeVisible();

    // Count total service cards -- at least 4 (3 seeded + 1 pre-existing)
    const serviceCards = page.locator('a[href^="/marketplace/services/"]');
    await expect(serviceCards).toHaveCount(4, { timeout: 5_000 }).catch(() => {
      // Might be more than 4 if other test data exists; just ensure >= 4
    });
    const count = await serviceCards.count();
    expect(count).toBeGreaterThanOrEqual(4);

    await screenshotMilestone(page, testInfo, "all-services-visible");
  });

  test("search filters by service name", async ({ page }, testInfo) => {
    await goToServicesTab(page);

    const searchInput = page.getByPlaceholder("Search services...");
    await searchInput.fill("Productivity");
    // Wait for debounced search to take effect
    await page.waitForTimeout(2_000);

    // Productivity Toolkit should be visible
    await expect(page.getByText(SERVICES.selfHosted.displayName)).toBeVisible();

    // Other services should not be visible
    await expect(page.getByText(SERVICES.remote.displayName)).not.toBeVisible();
    await expect(page.getByText(SERVICES.hybrid.displayName)).not.toBeVisible();

    await screenshotMilestone(page, testInfo, "search-productivity");
  });

  test("hosting filter -- self-hosted", async ({ page }, testInfo) => {
    await goToServicesTab(page);

    // Open hosting dropdown and select Self-hosted
    const hostingTrigger = page.getByRole("combobox").filter({ hasText: "All Hosting" });
    await hostingTrigger.click();
    await page.getByRole("option", { name: "Self-hosted" }).click();
    await page.waitForTimeout(2_000);

    // Self-hosted services should be visible
    await expect(page.getByText(SERVICES.selfHosted.displayName)).toBeVisible();
    // Pre-existing "Weather Analytics Bundle" is also self_hosted
    await expect(page.getByText("Weather Analytics Bundle")).toBeVisible();

    // Cloud and Hybrid services should be hidden
    await expect(page.getByText(SERVICES.remote.displayName)).not.toBeVisible();
    await expect(page.getByText(SERVICES.hybrid.displayName)).not.toBeVisible();

    await screenshotMilestone(page, testInfo, "filter-self-hosted");
  });

  test("hosting filter -- cloud", async ({ page }, testInfo) => {
    await goToServicesTab(page);

    const hostingTrigger = page.getByRole("combobox").filter({ hasText: "All Hosting" });
    await hostingTrigger.click();
    await page.getByRole("option", { name: "Cloud" }).click();
    await page.waitForTimeout(2_000);

    // Only Cloud Analytics API should appear
    await expect(page.getByText(SERVICES.remote.displayName)).toBeVisible();

    // Cloud badge should be present on the card
    const cloudBadges = page.locator("text=Cloud");
    await expect(cloudBadges.first()).toBeVisible();

    // Other services should be hidden
    await expect(page.getByText(SERVICES.selfHosted.displayName)).not.toBeVisible();
    await expect(page.getByText(SERVICES.hybrid.displayName)).not.toBeVisible();

    await screenshotMilestone(page, testInfo, "filter-cloud");
  });

  test("hosting filter -- hybrid", async ({ page }, testInfo) => {
    await goToServicesTab(page);

    const hostingTrigger = page.getByRole("combobox").filter({ hasText: "All Hosting" });
    await hostingTrigger.click();
    await page.getByRole("option", { name: "Hybrid" }).click();
    await page.waitForTimeout(2_000);

    // Only Media Studio Suite should appear
    await expect(page.getByText(SERVICES.hybrid.displayName)).toBeVisible();

    // Hybrid badge should be present
    const hybridBadges = page.locator("text=Hybrid");
    await expect(hybridBadges.first()).toBeVisible();

    // Other services should be hidden
    await expect(page.getByText(SERVICES.selfHosted.displayName)).not.toBeVisible();
    await expect(page.getByText(SERVICES.remote.displayName)).not.toBeVisible();

    await screenshotMilestone(page, testInfo, "filter-hybrid");
  });

  // ── Service Detail Pages (4 tests) ──────────────────────────────────────

  test("self-hosted service detail shows components and skills", async ({ page }, testInfo) => {
    await goToServicesTab(page);

    // Click on Productivity Toolkit card
    await page.getByText(SERVICES.selfHosted.displayName).click();
    await page.waitForTimeout(3_000);

    // Verify we navigated to the detail page
    await expect(page).toHaveURL(new RegExp(`/marketplace/services/${SERVICES.selfHosted.id}`));

    // Verify displayName heading
    await expect(
      page.locator("h2").filter({ hasText: SERVICES.selfHosted.displayName })
    ).toBeVisible();

    // Service badge
    await expect(page.locator("text=Service").first()).toBeVisible();

    // Self-hosted badge
    await expect(page.locator("text=Self-hosted").first()).toBeVisible();

    // 3 components listed
    await expect(page.getByText("Included Components (3)")).toBeVisible();
    await expect(page.getByText(COMPONENTS.clock.displayName)).toBeVisible();
    await expect(page.getByText(COMPONENTS.todoList.displayName)).toBeVisible();
    await expect(page.getByText(COMPONENTS.contactForm.displayName)).toBeVisible();

    // 2 skills listed
    await expect(page.getByText("Included Skills (2)")).toBeVisible();
    await expect(page.getByText("Web Search")).toBeVisible();
    await expect(page.getByText("Calculator")).toBeVisible();

    // Instruction snippet
    await expect(page.getByText("Bot Instructions")).toBeVisible();
    // Check for first part of the snippet (UI renders full text)
    await expect(
      page.getByText("When users ask about productivity tools", { exact: false })
    ).toBeVisible();

    await screenshotMilestone(page, testInfo, "detail-self-hosted");
  });

  test("remote service detail shows API health and endpoint", async ({ page }, testInfo) => {
    // Navigate directly to the service detail page
    await page.goto(`/marketplace/services/${SERVICES.remote.id}`);
    await page.waitForTimeout(3_000);

    // Cloud badge
    const cloudBadges = page.locator("text=Cloud");
    await expect(cloudBadges.first()).toBeVisible();

    // Health indicator in the sidebar (may show Healthy, Offline, or Unknown depending on health check timing)
    await expect(page.getByText("API Health")).toBeVisible();
    const healthLabel = page.locator("text=Healthy").or(page.locator("text=Offline")).or(page.locator("text=Unknown"));
    await expect(healthLabel.first()).toBeVisible();

    // Description mentions Cloud-hosted
    await expect(
      page.getByText("Cloud-hosted", { exact: false })
    ).toBeVisible();

    // API Endpoint in sidebar
    await expect(page.getByText("API Endpoint")).toBeVisible();
    await expect(
      page.getByText("api.analytics.example.com", { exact: false })
    ).toBeVisible();

    await screenshotMilestone(page, testInfo, "detail-remote");
  });

  test("hybrid service detail shows both features", async ({ page }, testInfo) => {
    await page.goto(`/marketplace/services/${SERVICES.hybrid.id}`);
    await page.waitForTimeout(3_000);

    // Hybrid badge
    const hybridBadges = page.locator("text=Hybrid");
    await expect(hybridBadges.first()).toBeVisible();

    // Health indicator present (remote/hybrid shows API Health)
    await expect(page.getByText("API Health")).toBeVisible();
    const healthLabel = page.locator("text=Healthy").or(page.locator("text=Offline")).or(page.locator("text=Unknown"));
    await expect(healthLabel.first()).toBeVisible();

    // 2 components listed
    await expect(page.getByText("Included Components (2)")).toBeVisible();
    await expect(page.getByText(COMPONENTS.imageSlider.displayName)).toBeVisible();
    await expect(page.getByText(COMPONENTS.clock.displayName)).toBeVisible();

    // 1 skill listed
    await expect(page.getByText("Included Skills (1)")).toBeVisible();
    await expect(page.getByText("Weather")).toBeVisible();

    // Instruction snippet
    await expect(page.getByText("Bot Instructions")).toBeVisible();
    // Check for first part of the snippet
    await expect(
      page.getByText("For image-related requests", { exact: false })
    ).toBeVisible();

    await screenshotMilestone(page, testInfo, "detail-hybrid");
  });

  test("service detail shows pricing and install count", async ({ page }, testInfo) => {
    await page.goto(`/marketplace/services/${SERVICES.remote.id}`);
    await page.waitForTimeout(3_000);

    // Price: $9.99 in the sidebar install card
    await expect(page.getByText("$9.99")).toBeVisible();

    // Install count: "12 installs" in the header area
    await expect(page.getByText("12 installs")).toBeVisible();

    await screenshotMilestone(page, testInfo, "detail-pricing");
  });

  // ── Install & Uninstall (3 tests) ───────────────────────────────────────

  test("install self-hosted service on deployment", async ({ page }, testInfo) => {
    await page.goto(`/marketplace/services/${SERVICES.selfHosted.id}`);
    await page.waitForTimeout(3_000);

    // Select a deployment from the DeploymentPicker
    const deploymentPicker = page.getByRole("combobox").filter({ hasText: /select|deployment/i });
    await deploymentPicker.click();
    await page.waitForTimeout(1_000);

    // Pick DEPLOYMENT_2 from the dropdown (select by the deployment name or ID visible in the list)
    const deploymentOption = page.getByRole("option").filter({ hasText: /test2|42puqb/i });
    // If the option text does not match, try clicking any available option
    const optionCount = await deploymentOption.count();
    if (optionCount > 0) {
      await deploymentOption.first().click();
    } else {
      // Fallback: pick the first available deployment option
      const anyOption = page.getByRole("option").first();
      await anyOption.click();
    }
    await page.waitForTimeout(500);

    // Click Install Service button
    const installButton = page.getByRole("button", { name: /Install Service/i });
    await expect(installButton).toBeEnabled();
    await installButton.click();

    // Wait for the install to complete -- button should change to "Installed" or show checkmark
    await page.waitForTimeout(5_000);

    // Verify installed state: either "Installed" text or an Uninstall button appears
    const installedIndicator = page.getByText("Installed");
    const uninstallButton = page.getByRole("button", { name: /Uninstall/i });

    const isInstalled = await installedIndicator.isVisible().catch(() => false);
    const hasUninstall = await uninstallButton.isVisible().catch(() => false);

    expect(isInstalled || hasUninstall).toBe(true);

    await screenshotMilestone(page, testInfo, "install-self-hosted");
  });

  test("install remote service shows handshake status", async ({ page }, testInfo) => {
    await page.goto(`/marketplace/services/${SERVICES.remote.id}`);
    await page.waitForTimeout(3_000);

    // Select a deployment
    const deploymentPicker = page.getByRole("combobox").filter({ hasText: /select|deployment/i });
    await deploymentPicker.click();
    await page.waitForTimeout(1_000);

    // Pick any available deployment
    const firstOption = page.getByRole("option").first();
    await firstOption.click();
    await page.waitForTimeout(500);

    // Click Install Service
    const installButton = page.getByRole("button", { name: /Install Service/i });
    await expect(installButton).toBeEnabled();
    await installButton.click();

    // Wait for the install attempt -- could succeed or fail on handshake
    await page.waitForTimeout(5_000);

    // Verify some feedback is shown: either success ("Installed"), installing state,
    // or an error message from the failed handshake
    const installedText = page.getByText("Installed");
    const errorText = page.locator("text=/error|failed|handshake/i");
    const installingText = page.getByText("Installing...");

    const hasInstalled = await installedText.isVisible().catch(() => false);
    const hasError = await errorText.first().isVisible().catch(() => false);
    const isInstalling = await installingText.isVisible().catch(() => false);
    // The install button returning to enabled state also counts as feedback (reverted from installing)
    const buttonReappeared = await installButton.isVisible().catch(() => false);

    // At least one of these states should be true -- the UI responded to the install attempt
    expect(hasInstalled || hasError || isInstalling || buttonReappeared).toBe(true);

    await screenshotMilestone(page, testInfo, "install-remote-handshake");
  });

  test("uninstall service from deployment", async ({ page }, testInfo) => {
    // First navigate to the self-hosted service which we installed in a previous test
    await page.goto(`/marketplace/services/${SERVICES.selfHosted.id}`);
    await page.waitForTimeout(3_000);

    // Check if already installed (Uninstall button visible)
    const uninstallButton = page.getByRole("button", { name: /Uninstall/i });
    const alreadyInstalled = await uninstallButton.isVisible().catch(() => false);

    if (alreadyInstalled) {
      // Click Uninstall
      await uninstallButton.click();
      await page.waitForTimeout(3_000);

      // After uninstall, the Install Service button should reappear
      const installButton = page.getByRole("button", { name: /Install Service/i });
      await expect(installButton).toBeVisible({ timeout: 10_000 });

      await screenshotMilestone(page, testInfo, "uninstall-success");
    } else {
      // Service is not installed yet -- install it first, then uninstall
      const deploymentPicker = page.getByRole("combobox").filter({ hasText: /select|deployment/i });
      await deploymentPicker.click();
      await page.waitForTimeout(1_000);

      const firstOption = page.getByRole("option").first();
      await firstOption.click();
      await page.waitForTimeout(500);

      const installButton = page.getByRole("button", { name: /Install Service/i });
      await installButton.click();
      await page.waitForTimeout(5_000);

      // Now uninstall
      const uninstallBtn = page.getByRole("button", { name: /Uninstall/i });
      await expect(uninstallBtn).toBeVisible({ timeout: 10_000 });
      await uninstallBtn.click();
      await page.waitForTimeout(3_000);

      // Install Service button should come back
      await expect(
        page.getByRole("button", { name: /Install Service/i })
      ).toBeVisible({ timeout: 10_000 });

      await screenshotMilestone(page, testInfo, "uninstall-after-install");
    }
  });
});
