import { test, expect } from "@playwright/test";
import { attachAllLoggers, screenshotMilestone } from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";
import { switchToTab } from "./helpers/marketplace";

test.describe("Marketplace - Components tab", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  // ── Page structure ──────────────────────────────────────────────────────

  test("page loads with correct heading and subtitle", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    await expect(page.getByRole("heading", { name: "Marketplace" })).toBeVisible();
    await expect(
      page.getByText("Discover and install community-built components and services for your bots.")
    ).toBeVisible();

    await screenshotMilestone(page, testInfo, "marketplace-heading");
  });

  test("Components tab is selected by default", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const componentsTab = page.getByRole("tab", { name: "Components" });
    await expect(componentsTab).toHaveAttribute("aria-selected", "true");
  });

  // ── Search ──────────────────────────────────────────────────────────────

  test("search input is present with correct placeholder", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const searchInput = page.getByPlaceholder("Search components...");
    await expect(searchInput).toBeVisible();
  });

  test("search clear button appears when text entered, clears on click", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const searchInput = page.getByPlaceholder("Search components...");
    await searchInput.fill("chart");

    // Clear (X) button should appear - it's a <button> inside the search wrapper
    const clearBtn = page.locator("button").filter({ has: page.locator('svg.lucide-x') }).first();
    await expect(clearBtn).toBeVisible();

    await clearBtn.click();
    await expect(searchInput).toHaveValue("");
  });

  // ── Filter dropdowns ───────────────────────────────────────────────────

  test("category filter dropdown opens and shows options", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    // Click the Category combobox trigger
    const categoryTrigger = page.getByRole("combobox").filter({ hasText: "All Categories" });
    await categoryTrigger.click();

    // Verify key options appear
    await expect(page.getByRole("option", { name: "All Categories" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Chart" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Form" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Media" })).toBeVisible();
  });

  test("tier filter dropdown opens and shows options", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const tierTrigger = page.getByRole("combobox").filter({ hasText: "All Tiers" });
    await tierTrigger.click();

    await expect(page.getByRole("option", { name: "All Tiers" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Template" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Sandbox" })).toBeVisible();
  });

  test("pricing filter dropdown opens and shows options", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const pricingTrigger = page.getByRole("combobox").filter({ hasText: "All Prices" });
    await pricingTrigger.click();

    await expect(page.getByRole("option", { name: "All Prices" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Free" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Paid" })).toBeVisible();
  });

  test("sort filter dropdown opens and shows options", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const sortTrigger = page.getByRole("combobox").filter({ hasText: "Most Popular" });
    await sortTrigger.click();

    await expect(page.getByRole("option", { name: "Most Popular" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Newest" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Highest Rated" })).toBeVisible();
    await expect(page.getByRole("option", { name: "Trending" })).toBeVisible();
  });

  // ── Clear filters ──────────────────────────────────────────────────────

  test("clear button appears when filter active, clears filters on click", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    // No Clear button initially
    await expect(page.getByRole("button", { name: "Clear" })).not.toBeVisible();

    // Select a non-default tier filter
    const tierTrigger = page.getByRole("combobox").filter({ hasText: "All Tiers" });
    await tierTrigger.click();
    await page.getByRole("option", { name: "Template" }).click();

    // Clear button should now appear
    const clearBtn = page.getByRole("button", { name: "Clear" });
    await expect(clearBtn).toBeVisible();

    // Click Clear
    await clearBtn.click();

    // Tier should revert to "All Tiers" and Clear button should disappear
    await expect(page.getByRole("combobox").filter({ hasText: "All Tiers" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear" })).not.toBeVisible();
  });

  // ── Real API component rendering ─────────────────────────────────────

  test("component cards render with real data and link correctly", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    // At least one component card should be visible (real API has seeded data)
    const cards = page.locator("a[href^='/marketplace/']");
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);

    // First card should have a link to a component detail page
    const firstCard = cards.first();
    await expect(firstCard).toBeVisible();

    await screenshotMilestone(page, testInfo, "marketplace-component-cards");
  });
});
