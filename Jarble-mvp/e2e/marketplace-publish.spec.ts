import { test, expect } from "@playwright/test";
import { attachAllLoggers, screenshotMilestone } from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";
import { switchToTab } from "./helpers/marketplace";

test.describe("Marketplace - Publish tab", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("publish tab is visible when authenticated", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(3);
    await expect(page.getByRole("tab", { name: "Components" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Services" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Publish" })).toBeVisible();

    await screenshotMilestone(page, testInfo, "publish-tab-visible");
  });

  test("publish form renders with title", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Publish");

    await expect(page.getByText("Publish a Service")).toBeVisible();
    await expect(
      page.getByText("Bundle components and skills together"),
    ).toBeVisible();

    await screenshotMilestone(page, testInfo, "publish-form-rendered");
  });

  test("submit button disabled when form incomplete", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Publish");

    const submitBtn = page.getByRole("button", { name: "Submit for Review" });
    await expect(submitBtn).toBeVisible();
    await expect(submitBtn).toBeDisabled();
  });

  test("service name slug validation converts to lowercase with hyphens", async ({
    page,
  }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Publish");

    const nameInput = page.locator("#pkg-name");
    await nameInput.fill("My Test Service!");
    // The onChange handler converts to lowercase and replaces invalid chars with hyphens
    await expect(nameInput).toHaveValue("my-test-service-");
  });

  test("hosting model toggle shows/hides remote endpoint field", async ({
    page,
  }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Publish");

    // Default is Self-hosted - remote endpoint should not be visible
    await expect(page.locator("#pkg-endpoint")).not.toBeVisible();

    // Switch to Cloud
    const hostingTrigger = page
      .getByRole("combobox")
      .first();
    await hostingTrigger.click();
    await page.getByRole("option", { name: /Cloud/i }).click();

    // Remote API Endpoint input should appear
    await expect(page.locator("#pkg-endpoint")).toBeVisible();

    // Switch back to Self-hosted
    await hostingTrigger.click();
    await page.getByRole("option", { name: /Self-hosted/i }).click();

    await expect(page.locator("#pkg-endpoint")).not.toBeVisible();

    await screenshotMilestone(page, testInfo, "hosting-model-toggle");
  });

  test("add and remove component IDs", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Publish");

    const componentInput = page.getByPlaceholder("Component ID");
    await componentInput.fill("comp-abc-123");

    // Click the Plus button next to Component ID input
    const addComponentBtn = page.locator("button:has(svg.lucide-plus)").first();
    await addComponentBtn.click();

    // Badge with component ID should appear
    await expect(page.getByText("comp-abc-123")).toBeVisible();

    // Remove by clicking the X button on the badge
    const removeBtns = page.locator("button:has(svg.lucide-x)");
    await removeBtns.first().click();

    // Badge should disappear
    await expect(page.getByText("comp-abc-123")).not.toBeVisible();

    await screenshotMilestone(page, testInfo, "component-ids-add-remove");
  });

  test("add and remove skill IDs", async ({ page }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Publish");

    const skillInput = page.getByPlaceholder("Skill ID");
    await skillInput.fill("skill-web-search");

    // Click the Plus button next to Skill ID input (second plus button)
    const addSkillBtn = page.locator("button:has(svg.lucide-plus)").nth(1);
    await addSkillBtn.click();

    // Badge with skill ID should appear
    await expect(page.getByText("skill-web-search")).toBeVisible();

    // Remove it
    const removeBtns = page.locator("button:has(svg.lucide-x)");
    await removeBtns.first().click();

    await expect(page.getByText("skill-web-search")).not.toBeVisible();

    await screenshotMilestone(page, testInfo, "skill-ids-add-remove");
  });

  test("pricing model toggle shows/hides price input", async ({ page }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Publish");

    // Default is Free - price input should not be visible
    await expect(page.locator("#pkg-price")).not.toBeVisible();

    // Find the Pricing Model combobox by its label
    const pricingSection = page.getByText("Pricing Model").locator("..");
    const pricingTrigger = pricingSection.getByRole("combobox");
    await pricingTrigger.click();
    await page.getByRole("option", { name: "Paid" }).click();

    // Price input should appear
    await expect(page.locator("#pkg-price")).toBeVisible();

    // Switch back to Free
    await pricingTrigger.click();
    await page.getByRole("option", { name: "Free", exact: true }).click();

    await expect(page.locator("#pkg-price")).not.toBeVisible();
  });

  test("submit button enables when required fields filled", async ({
    page,
  }) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Publish");

    const submitBtn = page.getByRole("button", { name: "Submit for Review" });
    await expect(submitBtn).toBeDisabled();

    // Fill required fields
    await page.locator("#pkg-name").fill("test-pkg");
    await page.locator("#pkg-display-name").fill("Test Service");

    // Still disabled - need at least one component or skill ID
    await expect(submitBtn).toBeDisabled();

    // Add a component ID
    const componentInput = page.getByPlaceholder("Component ID");
    await componentInput.fill("comp-001");
    await page.locator("button:has(svg.lucide-plus)").first().click();

    // Now should be enabled
    await expect(submitBtn).toBeEnabled();
  });

  test("filled form enables submit button (read-only, no actual submission)", async ({
    page,
  }, testInfo) => {
    await page.goto("/marketplace");
    await page.waitForTimeout(3_000);
    await switchToTab(page, "Publish");

    // Fill the form
    await page.locator("#pkg-name").fill("my-new-service");
    await page.locator("#pkg-display-name").fill("My New Service");
    await page.locator("#pkg-description").fill("A great service.");

    // Add a component ID
    const componentInput = page.getByPlaceholder("Component ID");
    await componentInput.fill("comp-test-001");
    await page.locator("button:has(svg.lucide-plus)").first().click();

    // Submit button should be enabled (but we don't click it - read-only test)
    const submitBtn = page.getByRole("button", { name: "Submit for Review" });
    await expect(submitBtn).toBeEnabled();

    await screenshotMilestone(page, testInfo, "publish-form-filled");
  });
});
