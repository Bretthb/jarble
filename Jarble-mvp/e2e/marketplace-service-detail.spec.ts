import { test, expect } from "@playwright/test";
import { attachAllLoggers, screenshotMilestone } from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";
import {
  mockServiceDetail,
  MOCK_SERVICE,
  MOCK_REMOTE_SERVICE,
} from "./helpers/marketplace";

test.describe("Marketplace — Service Detail", () => {
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

  test("page loads with Back to Marketplace link", async ({ page }, testInfo) => {
    await mockServiceDetail(page, MOCK_SERVICE);
    await page.goto("/marketplace/services/pkg-test-001");
    await page.waitForTimeout(3_000);

    const backLink = page.getByRole("link", { name: "Back to Marketplace" });
    await expect(backLink).toBeVisible();

    await screenshotMilestone(page, testInfo, "service-detail-back-link");
  });

  test("not-found state renders when no API data", async ({ page }, testInfo) => {
    // No mock — tRPC query will fail or return null
    await page.goto("/marketplace/services/pkg-nonexistent");
    await page.waitForTimeout(3_000);

    await expect(page.getByText("Service not found")).toBeVisible();
    await expect(
      page.getByText("This service may have been removed or does not exist.")
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Browse Marketplace" })).toBeVisible();

    await screenshotMilestone(page, testInfo, "service-detail-not-found");
  });

  // ── Mock data rendering ─────────────────────────────────────────────────

  test("service detail renders with mock data", async ({ page }, testInfo) => {
    await mockServiceDetail(page, MOCK_SERVICE);
    await page.goto("/marketplace/services/pkg-test-001");
    await page.waitForTimeout(3_000);

    // Heading
    await expect(
      page.getByRole("heading", { name: MOCK_SERVICE.displayName })
    ).toBeVisible();

    // Service badge
    await expect(page.getByText("Service", { exact: true }).first()).toBeVisible();

    // Hosting badge
    await expect(page.getByText("Self-hosted")).toBeVisible();

    // Stats
    await expect(page.getByText("87 installs")).toBeVisible();
    await expect(page.getByText("2 components")).toBeVisible();
    await expect(page.getByText("1 skill")).toBeVisible();

    await screenshotMilestone(page, testInfo, "service-detail-header");
  });

  test("included components section renders", async ({ page }) => {
    await mockServiceDetail(page, MOCK_SERVICE);
    await page.goto("/marketplace/services/pkg-test-001");
    await page.waitForTimeout(3_000);

    await expect(page.getByText("Included Components (2)")).toBeVisible();
    await expect(page.getByText("Test Chart")).toBeVisible();
    await expect(page.getByText("Test Table")).toBeVisible();
  });

  test("included skills section renders", async ({ page }) => {
    await mockServiceDetail(page, MOCK_SERVICE);
    await page.goto("/marketplace/services/pkg-test-001");
    await page.waitForTimeout(3_000);

    await expect(page.getByText("Included Skills (1)")).toBeVisible();
    await expect(page.getByText("Web Search")).toBeVisible();
  });

  test("bot instructions section renders", async ({ page }) => {
    await mockServiceDetail(page, MOCK_SERVICE);
    await page.goto("/marketplace/services/pkg-test-001");
    await page.waitForTimeout(3_000);

    await expect(page.getByText("Bot Instructions")).toBeVisible();
    await expect(
      page.getByText(MOCK_SERVICE.instructionSnippet)
    ).toBeVisible();
  });

  test("install button disabled without deployment selected", async ({ page }) => {
    await mockServiceDetail(page, MOCK_SERVICE);
    await page.goto("/marketplace/services/pkg-test-001");
    await page.waitForTimeout(3_000);

    const installBtn = page.getByRole("button", { name: "Install Service" });
    await expect(installBtn).toBeVisible();
    await expect(installBtn).toBeDisabled();
  });

  test("details sidebar shows hosting, component count, skill count", async ({ page }, testInfo) => {
    await mockServiceDetail(page, MOCK_SERVICE);
    await page.goto("/marketplace/services/pkg-test-001");
    await page.waitForTimeout(3_000);

    // Details card heading
    await expect(page.getByText("Details")).toBeVisible();

    // Hosting row
    await expect(page.getByText("Hosting")).toBeVisible();

    // Component and skill counts in the details card (font-mono dd elements)
    const detailsCard = page.locator("dl");
    await expect(detailsCard.getByText("Components")).toBeVisible();
    await expect(detailsCard.getByText("Skills")).toBeVisible();

    await screenshotMilestone(page, testInfo, "service-detail-sidebar");
  });

  test("remote service shows API Health in details", async ({ page }, testInfo) => {
    await mockServiceDetail(page, MOCK_REMOTE_SERVICE);
    await page.goto("/marketplace/services/pkg-test-002");
    await page.waitForTimeout(3_000);

    // API Health row should be visible for remote services
    await expect(page.getByText("API Health")).toBeVisible();
    await expect(page.getByText("Healthy")).toBeVisible();

    // Hosting badge should say "Cloud" for remote model
    await expect(page.getByText("Cloud").first()).toBeVisible();

    await screenshotMilestone(page, testInfo, "service-detail-remote-health");
  });
});
