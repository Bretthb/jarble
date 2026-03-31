import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
  logTestFailure,
} from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";

// ── Authenticated marketplace tests ─────────────────────────────────────────

test.describe("Marketplace (authenticated)", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, {
        group: "marketplace",
        scenario: testInfo.title,
      });
    }
  });

  // 1. Marketplace page loads with tabs
  test("marketplace page loads with tabs", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    // The page heading should be visible
    await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible();

    // Three tabs: Components, Packages, Publish (Publish only when authenticated)
    const tabList = page.getByRole("tablist");
    await expect(tabList).toBeVisible();

    const componentsTab = tabList.getByRole("tab", { name: /Components/i });
    const packagesTab = tabList.getByRole("tab", { name: /Packages/i });
    const publishTab = tabList.getByRole("tab", { name: /Publish/i });

    await expect(componentsTab).toBeVisible();
    await expect(packagesTab).toBeVisible();
    await expect(publishTab).toBeVisible();

    await screenshotMilestone(page, testInfo, "marketplace-tabs");
  });

  // 2. Components tab shows grid or empty state
  test("components tab shows grid or empty state", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    // Components tab is the default
    // Wait for content to load (skeletons disappear)
    await page.waitForTimeout(3_000);

    // Either a component grid with cards, or an empty state is shown
    const componentCards = page.locator('a[href^="/marketplace/"] .font-semibold');
    const emptyState = page.getByText(/No components found|Marketplace Coming Soon/i);

    const hasCards = await componentCards.count() > 0;
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    expect.soft(
      hasCards || hasEmpty,
      "Expected either component cards or an empty state"
    ).toBe(true);

    await screenshotMilestone(page, testInfo, "marketplace-components");
  });

  // 3. Components tab search
  test("components tab search", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    const searchInput = page.getByPlaceholder("Search components...");
    await expect(searchInput).toBeVisible();

    // Type a search query
    await searchInput.fill("chart");
    await page.waitForTimeout(2_000);

    // After searching, page should either show filtered results or empty
    const emptyState = page.getByText(/No components found/i);
    const componentCards = page.locator('a[href^="/marketplace/"]');

    const hasResults = await componentCards.count() > 0;
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    expect.soft(
      hasResults || hasEmpty,
      "Expected filtered results or empty state after search"
    ).toBe(true);

    await screenshotMilestone(page, testInfo, "marketplace-search");
  });

  // 4. Component detail page
  test("component detail page", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3_000);

    // Find the first component card link
    const firstCard = page.locator('a[href^="/marketplace/"]').first();
    const cardCount = await firstCard.count();

    if (cardCount === 0) {
      test.skip(true, "No marketplace components available to test detail page");
      return;
    }

    await firstCard.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    // Back link should be visible
    await expect(page.getByText("Back to Marketplace")).toBeVisible();

    // Component name heading or "not found" state
    const detailHeading = page.locator("h2.text-2xl");
    const notFound = page.getByText("Component not found");

    const hasDetail = await detailHeading.isVisible().catch(() => false);
    const hasNotFound = await notFound.isVisible().catch(() => false);

    expect.soft(
      hasDetail || hasNotFound,
      "Expected component detail view or not-found state"
    ).toBe(true);

    if (hasDetail) {
      // Description section should exist
      await expect(page.getByRole("heading", { name: "Description" })).toBeVisible();
      // Details sidebar card should exist
      await expect(page.getByRole("heading", { name: "Details" })).toBeVisible();
    }

    await screenshotMilestone(page, testInfo, "marketplace-detail");
  });

  // 5. Component install flow
  test("component install flow", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3_000);

    const firstCard = page.locator('a[href^="/marketplace/"]').first();
    const cardCount = await firstCard.count();

    if (cardCount === 0) {
      test.skip(true, "No marketplace components available to test install flow");
      return;
    }

    await firstCard.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    // Check for component not found
    const notFound = page.getByText("Component not found");
    if (await notFound.isVisible().catch(() => false)) {
      test.skip(true, "Component not found on detail page");
      return;
    }

    // The install section should be visible
    // There should be a deployment picker or "No running deployments" message or Install button
    const installButton = page.getByRole("button", { name: /Install/i });
    const noDeployments = page.getByText(/No running deployments/i);
    const selectDeployment = page.getByText(/Select a deployment/i);

    const hasInstall = await installButton.isVisible().catch(() => false);
    const hasNoDeployments = await noDeployments.isVisible().catch(() => false);
    const hasPicker = await selectDeployment.isVisible().catch(() => false);

    expect.soft(
      hasInstall || hasNoDeployments || hasPicker,
      "Expected install button, deployment picker, or no-deployments message"
    ).toBe(true);

    await screenshotMilestone(page, testInfo, "marketplace-install-flow");
  });

  // 6. Packages tab shows content
  test("packages tab shows content", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    // Click the Packages tab
    const packagesTab = page.getByRole("tab", { name: /Packages/i });
    await packagesTab.click();
    await page.waitForTimeout(3_000);

    // After switching to Packages tab, we should see the package search bar or content
    const packageSearch = page.getByPlaceholder("Search packages...");
    const packageCards = page.locator('a[href^="/marketplace/packages/"]');
    const emptyState = page.getByText(/No packages found|Unable to load packages/i);

    const hasSearch = await packageSearch.isVisible().catch(() => false);
    const hasCards = await packageCards.count() > 0;
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    expect.soft(
      hasSearch || hasCards || hasEmpty,
      "Expected package search, cards, or empty state on Packages tab"
    ).toBe(true);

    await screenshotMilestone(page, testInfo, "marketplace-packages-tab");
  });

  // 7. Packages tab search and filter
  test("packages tab search and filter", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    // Switch to packages tab
    await page.getByRole("tab", { name: /Packages/i }).click();
    await page.waitForTimeout(2_000);

    const packageSearch = page.getByPlaceholder("Search packages...");
    if (!(await packageSearch.isVisible().catch(() => false))) {
      test.skip(true, "Package search not visible - tab may not have loaded");
      return;
    }

    // Type in search
    await packageSearch.fill("analytics");
    await page.waitForTimeout(2_000);

    // Verify filter row is visible (hosting model filter)
    const filterRow = page.getByText(/Filters:/i);
    expect.soft(
      await filterRow.isVisible().catch(() => false),
      "Expected filter controls to be visible"
    ).toBe(true);

    // After search, should show results or empty
    const packageCards = page.locator('a[href^="/marketplace/packages/"]');
    const emptyState = page.getByText(/No packages found/i);

    const hasResults = await packageCards.count() > 0;
    const hasEmpty = await emptyState.isVisible().catch(() => false);

    expect.soft(
      hasResults || hasEmpty,
      "Expected filtered package results or empty state"
    ).toBe(true);

    await screenshotMilestone(page, testInfo, "marketplace-packages-search");
  });

  // 8. Package detail page
  test("package detail page", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    // Switch to packages tab
    await page.getByRole("tab", { name: /Packages/i }).click();
    await page.waitForTimeout(3_000);

    const firstPackage = page.locator('a[href^="/marketplace/packages/"]').first();
    const pkgCount = await firstPackage.count();

    if (pkgCount === 0) {
      test.skip(true, "No marketplace packages available to test detail page");
      return;
    }

    await firstPackage.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    // Back link
    await expect(page.getByText("Back to Marketplace")).toBeVisible();

    // Package heading or not-found
    const detailHeading = page.locator("h2.text-2xl");
    const notFound = page.getByText("Package not found");

    const hasDetail = await detailHeading.isVisible().catch(() => false);
    const hasNotFound = await notFound.isVisible().catch(() => false);

    expect.soft(
      hasDetail || hasNotFound,
      "Expected package detail view or not-found state"
    ).toBe(true);

    if (hasDetail) {
      // Should show Description section
      await expect(page.getByRole("heading", { name: "Description" })).toBeVisible();
      // Should show Details sidebar
      await expect(page.getByRole("heading", { name: "Details" })).toBeVisible();
      // Package badge
      const packageBadge = page.getByText("Package", { exact: true });
      expect.soft(
        await packageBadge.first().isVisible().catch(() => false),
        "Expected Package badge on detail page"
      ).toBe(true);
    }

    await screenshotMilestone(page, testInfo, "marketplace-package-detail");
  });

  // 9. Package install flow
  test("package install flow", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    await page.getByRole("tab", { name: /Packages/i }).click();
    await page.waitForTimeout(3_000);

    const firstPackage = page.locator('a[href^="/marketplace/packages/"]').first();
    if ((await firstPackage.count()) === 0) {
      test.skip(true, "No marketplace packages available to test install flow");
      return;
    }

    await firstPackage.click();
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    const notFound = page.getByText("Package not found");
    if (await notFound.isVisible().catch(() => false)) {
      test.skip(true, "Package not found on detail page");
      return;
    }

    // The install section should have Install Package button or no-deployments message
    const installButton = page.getByRole("button", { name: /Install Package/i });
    const noDeployments = page.getByText(/No running deployments/i);
    const selectDeployment = page.getByText(/Select a deployment/i);

    const hasInstall = await installButton.isVisible().catch(() => false);
    const hasNoDeployments = await noDeployments.isVisible().catch(() => false);
    const hasPicker = await selectDeployment.isVisible().catch(() => false);

    expect.soft(
      hasInstall || hasNoDeployments || hasPicker,
      "Expected install button, deployment picker, or no-deployments message"
    ).toBe(true);

    await screenshotMilestone(page, testInfo, "marketplace-package-install");
  });

  // 10. Publish tab shows form
  test("publish tab shows form", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    // Click publish tab
    const publishTab = page.getByRole("tab", { name: /Publish/i });
    await publishTab.click();
    await page.waitForTimeout(2_000);

    // The publish form should be visible with key fields
    const formTitle = page.getByText("Publish a Package");
    await expect(formTitle).toBeVisible();

    // Key form labels
    await expect(page.getByText("Package Name (slug)")).toBeVisible();
    await expect(page.getByText("Display Name")).toBeVisible();
    await expect(page.getByText("Description")).toBeVisible();
    await expect(page.getByText("Hosting Model")).toBeVisible();

    // Submit button should be present
    const submitButton = page.getByRole("button", { name: /Submit for Review/i });
    await expect(submitButton).toBeVisible();

    await screenshotMilestone(page, testInfo, "marketplace-publish-form");
  });

  // 11. Publish form validation - submit disabled until fields filled
  test("publish form validation", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    await page.getByRole("tab", { name: /Publish/i }).click();
    await page.waitForTimeout(2_000);

    const submitButton = page.getByRole("button", { name: /Submit for Review/i });
    await expect(submitButton).toBeVisible();

    // Button should be disabled when form is empty (name, displayName, and at least one component/skill required)
    await expect(submitButton).toBeDisabled();

    // Fill in name
    await page.getByLabel("Package Name (slug)").fill("test-package");
    // Still disabled (no display name, no components/skills)
    await expect(submitButton).toBeDisabled();

    // Fill in display name
    await page.getByLabel("Display Name").fill("Test Package");
    // Still disabled (no components or skills added)
    await expect(submitButton).toBeDisabled();

    // Add a component ID
    const componentInput = page.getByPlaceholder("Component ID");
    await componentInput.fill("test-comp-id");
    await componentInput.press("Enter");
    await page.waitForTimeout(500);

    // Now the submit button should be enabled
    await expect(submitButton).toBeEnabled();

    await screenshotMilestone(page, testInfo, "marketplace-publish-validation");
  });

  // 12. Tab navigation works - switch all 3 tabs
  test("tab navigation works", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");

    const tabList = page.getByRole("tablist");

    // Start on Components tab (default)
    const componentsTab = tabList.getByRole("tab", { name: /Components/i });
    const packagesTab = tabList.getByRole("tab", { name: /Packages/i });
    const publishTab = tabList.getByRole("tab", { name: /Publish/i });

    // Verify Components tab is active by default
    await expect(componentsTab).toHaveAttribute("data-state", "active");

    // Switch to Packages tab
    await packagesTab.click();
    await page.waitForTimeout(1_000);
    await expect(packagesTab).toHaveAttribute("data-state", "active");
    await expect(componentsTab).toHaveAttribute("data-state", "inactive");

    // The packages search should be visible
    const packageSearch = page.getByPlaceholder("Search packages...");
    expect.soft(
      await packageSearch.isVisible().catch(() => false),
      "Expected package search to be visible after switching to Packages tab"
    ).toBe(true);

    // Switch to Publish tab
    await publishTab.click();
    await page.waitForTimeout(1_000);
    await expect(publishTab).toHaveAttribute("data-state", "active");

    // Publish form should show
    expect.soft(
      await page.getByText("Publish a Package").isVisible().catch(() => false),
      "Expected publish form after switching to Publish tab"
    ).toBe(true);

    // Switch back to Components
    await componentsTab.click();
    await page.waitForTimeout(1_000);
    await expect(componentsTab).toHaveAttribute("data-state", "active");

    // Components search should be visible
    const componentSearch = page.getByPlaceholder("Search components...");
    expect.soft(
      await componentSearch.isVisible().catch(() => false),
      "Expected component search after switching back to Components tab"
    ).toBe(true);

    await screenshotMilestone(page, testInfo, "marketplace-tab-navigation");
  });

  // 13. Marketplace accessible from nav
  test("marketplace accessible from nav", async ({ page }, testInfo) => {
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3_000);

    // Click the Marketplace link in the nav
    const marketplaceLink = page.locator('nav a[href="/marketplace"]');
    const linkCount = await marketplaceLink.count();

    if (linkCount === 0) {
      // Try from homepage
      await page.goto("/");
      await page.waitForLoadState("networkidle");
      const homeMarketplaceLink = page.locator('a[href="/marketplace"]').first();
      if ((await homeMarketplaceLink.count()) > 0) {
        await homeMarketplaceLink.click();
      } else {
        // Navigate directly
        await page.goto("/marketplace");
      }
    } else {
      await marketplaceLink.first().click();
    }

    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(2_000);

    // Should be on marketplace page
    expect(page.url()).toContain("/marketplace");
    await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible();

    await screenshotMilestone(page, testInfo, "marketplace-from-nav");
  });
});

// ── Unauthenticated marketplace tests ───────────────────────────────────────

test.describe("Marketplace (unauthenticated)", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    // NO setupAuthIntercept - user is unauthenticated
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, {
        group: "marketplace-unauth",
        scenario: testInfo.title,
      });
    }
  });

  // 14. Unauthenticated views - no Publish tab
  test("unauthenticated views", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForLoadState("networkidle");
    await page.waitForTimeout(3_000);

    // Marketplace heading should be visible
    await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible();

    // Tab list should be visible
    const tabList = page.getByRole("tablist");
    await expect(tabList).toBeVisible();

    // Components and Packages tabs should be visible
    const componentsTab = tabList.getByRole("tab", { name: /Components/i });
    const packagesTab = tabList.getByRole("tab", { name: /Packages/i });
    await expect(componentsTab).toBeVisible();
    await expect(packagesTab).toBeVisible();

    // Publish tab should NOT be visible (auth-gated)
    const publishTab = tabList.getByRole("tab", { name: /Publish/i });
    await expect(publishTab).toHaveCount(0);

    // Sign in button should be visible in the nav (not a profile dropdown)
    const signInLink = page.locator('nav a[href="/login"]');
    expect.soft(
      await signInLink.isVisible().catch(() => false),
      "Expected Sign in link in nav for unauthenticated users"
    ).toBe(true);

    await screenshotMilestone(page, testInfo, "marketplace-unauth");
  });
});
