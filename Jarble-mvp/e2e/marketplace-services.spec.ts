import { test, expect } from "@playwright/test";
import { attachAllLoggers, screenshotMilestone } from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";
import { switchToTab } from "./helpers/marketplace";

test.describe("Marketplace — Services tab", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  // ── Tab switching ──────────────────────────────────────────────────────

  test("switching to Services tab changes selected tab", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    await switchToTab(page, "Services");

    const servicesTab = page.getByRole("tab", { name: "Services" });
    await expect(servicesTab).toHaveAttribute("aria-selected", "true");

    // Components tab should no longer be selected
    const componentsTab = page.getByRole("tab", { name: "Components" });
    await expect(componentsTab).toHaveAttribute("aria-selected", "false");

    await screenshotMilestone(page, testInfo, "services-tab-selected");
  });

  // ── Search ──────────────────────────────────────────────────────────────

  test("service search input has correct placeholder", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Services");

    const searchInput = page.getByPlaceholder("Search services...");
    await expect(searchInput).toBeVisible();
  });

  test("search clear button works", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Services");

    const searchInput = page.getByPlaceholder("Search services...");
    await searchInput.fill("analytics");

    // Clear (X) button inside the search wrapper
    const clearBtn = page.locator("button").filter({ has: page.locator('svg.lucide-x') }).first();
    await expect(clearBtn).toBeVisible();

    await clearBtn.click();
    await expect(searchInput).toHaveValue("");
  });

  // ── Filter dropdowns ───────────────────────────────────────────────────

  test("hosting model filter opens and shows options", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Services");

    const hostingTrigger = page.getByRole("combobox").filter({ hasText: "All Hosting" });
    await hostingTrigger.click();

    await expect(page.getByRole("option", { name: "All Hosting" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Self-hosted" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Cloud" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Hybrid" })).toBeVisible();
  });

  test("pricing filter opens and shows options", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Services");

    const pricingTrigger = page.getByRole("combobox").filter({ hasText: "All Prices" });
    await pricingTrigger.click();

    await expect(page.getByRole("option", { name: "All Prices" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Free", exact: true })).toBeVisible();
    await expect(page.getByRole("option", { name: "Paid" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Freemium" })).toBeVisible();
  });

  // ── Clear filters ──────────────────────────────────────────────────────

  test("clear filters button works", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Services");

    // No Clear button initially
    await expect(page.getByRole("button", { name: "Clear" })).not.toBeVisible();

    // Select a hosting filter
    const hostingTrigger = page.getByRole("combobox").filter({ hasText: "All Hosting" });
    await hostingTrigger.click();
    await page.getByRole("option", { name: "Self-hosted" }).click();

    // Clear button should now appear
    const clearBtn = page.getByRole("button", { name: "Clear" });
    await expect(clearBtn).toBeVisible();

    await clearBtn.click();

    // Hosting should revert to "All Hosting"
    await expect(page.getByRole("combobox").filter({ hasText: "All Hosting" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear" })).not.toBeVisible();
  });

  // ── Real API data rendering ─────────────────────────────────────────

  test("service cards render with real data", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Services");

    // Services should load from real API — check for card links
    const serviceLinks = page.locator("a[href^='/marketplace/services/']");
    const count = await serviceLinks.count();

    if (count > 0) {
      // At least one service card should be visible
      await expect(serviceLinks.first()).toBeVisible();
    } else {
      // No services published yet — empty state message should show
      await expect(page.getByText(/no services|coming soon/i).first()).toBeVisible();
    }

    await screenshotMilestone(page, testInfo, "services-card-rendered");
  });
});
