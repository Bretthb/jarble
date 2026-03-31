import { test, expect } from "@playwright/test";
import { attachAllLoggers, screenshotMilestone } from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";
import {
  MOCK_COMPONENT,
  mockComponentDetail,
  mockComponentReviews,
} from "./helpers/marketplace";

test.describe("Marketplace - Component detail page", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  test("page loads with back to marketplace link", async ({ page }, testInfo) => {
    await mockComponentDetail(page);
    await mockComponentReviews(page);
    await page.goto("/marketplace/comp-test-001");
    await page.waitForTimeout(3_000);

    const backLink = page.getByRole("link", { name: "Back to Marketplace" });
    await expect(backLink).toBeVisible();

    await screenshotMilestone(page, testInfo, "detail-page-loaded");
  });

  test("not-found state renders when no API data", async ({ page }, testInfo) => {
    // Mock getById to return null/undefined (no data)
    await page.route("**/trpc/marketplace.getById*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ result: { data: undefined } }),
      });
    });
    await mockComponentReviews(page);
    await page.goto("/marketplace/nonexistent-id");
    await page.waitForTimeout(3_000);

    await expect(page.getByText("Component not found")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Browse Marketplace" }),
    ).toBeVisible();

    await screenshotMilestone(page, testInfo, "detail-not-found");
  });

  test("component detail renders with mock data", async ({ page }, testInfo) => {
    await mockComponentDetail(page);
    await mockComponentReviews(page);
    await page.goto("/marketplace/comp-test-001");
    await page.waitForTimeout(3_000);

    // Heading with display name
    await expect(
      page.getByRole("heading", { name: MOCK_COMPONENT.displayName }),
    ).toBeVisible();

    // Tier badge
    await expect(page.getByText("template", { exact: false })).toBeVisible();

    // Install count
    await expect(page.getByText("142 installs")).toBeVisible();

    await screenshotMilestone(page, testInfo, "detail-with-data");
  });

  test("description section shows component description", async ({ page }) => {
    await mockComponentDetail(page);
    await mockComponentReviews(page);
    await page.goto("/marketplace/comp-test-001");
    await page.waitForTimeout(3_000);

    await expect(
      page.getByText(MOCK_COMPONENT.description),
    ).toBeVisible();
  });

  test("reviews section shows no reviews message when empty", async ({
    page,
  }) => {
    await mockComponentDetail(page);
    await mockComponentReviews(page, []);
    await page.goto("/marketplace/comp-test-001");
    await page.waitForTimeout(3_000);

    await expect(
      page.getByText("No reviews yet", { exact: false }),
    ).toBeVisible();
  });

  test("install button is disabled without deployment selected", async ({
    page,
  }) => {
    await mockComponentDetail(page);
    await mockComponentReviews(page);
    await page.goto("/marketplace/comp-test-001");
    await page.waitForTimeout(3_000);

    const installBtn = page.getByRole("button", { name: "Install" });
    await expect(installBtn).toBeVisible();
    await expect(installBtn).toBeDisabled();
  });

  test("details sidebar shows version, category, and updated date", async ({
    page,
  }, testInfo) => {
    await mockComponentDetail(page);
    await mockComponentReviews(page);
    await page.goto("/marketplace/comp-test-001");
    await page.waitForTimeout(3_000);

    // Version
    await expect(page.getByText("Version")).toBeVisible();
    await expect(page.getByText("1.2.0")).toBeVisible();

    // Category
    await expect(page.getByText("Category")).toBeVisible();

    // Updated
    await expect(page.getByText("Updated")).toBeVisible();

    await screenshotMilestone(page, testInfo, "detail-sidebar");
  });

  test("back link navigates to marketplace", async ({ page }) => {
    await mockComponentDetail(page);
    await mockComponentReviews(page);
    await page.goto("/marketplace/comp-test-001");
    await page.waitForTimeout(3_000);

    const backLink = page.getByRole("link", { name: "Back to Marketplace" });
    await expect(backLink).toHaveAttribute("href", "/marketplace");
  });
});
