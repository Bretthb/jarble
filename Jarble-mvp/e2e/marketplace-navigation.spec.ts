import { test, expect } from "@playwright/test";
import { attachAllLoggers, screenshotMilestone } from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";
import {
  mockComponentBrowse,
  mockServicesList,
  switchToTab,
  MOCK_COMPONENT_BROWSE_ITEM,
  MOCK_SERVICE_LIST_ITEM,
} from "./helpers/marketplace";

test.describe("Marketplace — Navigation", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  // ── Tab navigation ──────────────────────────────────────────────────────

  test("tab switching preserves URL", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    // Switch to Services tab
    await switchToTab(page, "Services");
    await expect(page).toHaveURL(/\/marketplace$/);

    // Switch to Publish tab
    await switchToTab(page, "Publish");
    await expect(page).toHaveURL(/\/marketplace$/);

    // Switch back to Components tab
    await switchToTab(page, "Components");
    await expect(page).toHaveURL(/\/marketplace$/);

    await screenshotMilestone(page, testInfo, "marketplace-tab-switching");
  });

  // ── Nav bar ─────────────────────────────────────────────────────────────

  test("Marketplace nav link has active styling", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    // The Marketplace link in the nav bar should have text-primary class (active)
    const marketplaceLink = page.locator("nav").getByRole("link", { name: "Marketplace" });
    await expect(marketplaceLink).toBeVisible();
    await expect(marketplaceLink).toHaveClass(/text-primary/);
  });

  test("clicking Jarble logo navigates home", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    // Click the Jarble logo/heading link — the h1 is inside a Link to "/"
    const logoLink = page.getByRole("link", { name: "Jarble", exact: true });
    await logoLink.click();

    await expect(page).toHaveURL("/");
  });

  // ── Back links ──────────────────────────────────────────────────────────

  test("component detail back link returns to marketplace", async ({ page }) => {
    await page.goto("/marketplace/comp-test-001");
    await page.waitForTimeout(3_000);

    const backLink = page.getByRole("link", { name: "Back to Marketplace" });
    await expect(backLink).toBeVisible();

    await backLink.click();
    await expect(page).toHaveURL(/\/marketplace$/);
  });

  test("service detail back link returns to marketplace", async ({ page }, testInfo) => {
    await page.goto("/marketplace/services/pkg-test-001");
    await page.waitForTimeout(3_000);

    const backLink = page.getByRole("link", { name: "Back to Marketplace" });
    await expect(backLink).toBeVisible();

    await backLink.click();
    await expect(page).toHaveURL(/\/marketplace$/);

    await screenshotMilestone(page, testInfo, "marketplace-back-navigation");
  });
});
