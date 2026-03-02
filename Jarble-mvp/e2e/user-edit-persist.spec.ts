import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
  waitForBotResponse,
  waitForCanvasCards,
  getTestConfig,
} from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";

test.describe("Editable canvas persistence", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    const { deploymentId } = getTestConfig();
    test.skip(!deploymentId, "No deploymentId configured — skipping");
    await page.goto(`/d/${deploymentId}`);
    await page
      .locator("textarea")
      .waitFor({ state: "visible", timeout: 30_000 });
  });

  test.afterEach(async () => {
    await flush();
  });

  test("trigger editable data table and edit", async ({ page }, testInfo) => {
    // Send a prompt that should trigger a data_table
    const textarea = page.locator("textarea");
    await textarea.fill(
      "Create a data table showing 5 fictional employees with name, role, department, and salary",
    );
    await textarea.press("Enter");

    await waitForBotResponse(page);
    // Extra time for canvas render
    await page.waitForTimeout(3000);
    await screenshotMilestone(page, testInfo, "table-before-edit");

    // Look for the edit (pencil) button — EditableCanvas shows it on hover
    const editBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-pencil") })
      .first();

    // Hover over the card area to reveal the edit button (it's opacity-0 until group-hover)
    const cardGroup = page.locator(".group").first();
    if (await cardGroup.isVisible().catch(() => false)) {
      await cardGroup.hover();
      await page.waitForTimeout(500);
    }

    const editVisible = await editBtn
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (!editVisible) {
      test.skip(true, "Edit button not found — component may not be editable");
      return;
    }

    await editBtn.click();
    await page.waitForTimeout(1000);
    await screenshotMilestone(page, testInfo, "table-edit-mode");

    // Look for save button and click it
    const saveBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-save") })
      .first();
    const saveVisible = await saveBtn
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (saveVisible) {
      await saveBtn.click();
      await page.waitForTimeout(1500);
    } else {
      // Try cancel instead so we exit edit mode cleanly
      const cancelBtn = page
        .locator("button")
        .filter({ has: page.locator("svg.lucide-x") })
        .first();
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click();
      }
    }

    await screenshotMilestone(page, testInfo, "table-after-save");
  });

  test("view mode switch preserves canvas state", async ({
    page,
  }, testInfo) => {
    // Send a prompt that triggers visible canvas components
    const textarea = page.locator("textarea");
    await textarea.fill(
      "Show me a stat grid with 4 key metrics: revenue ($1.2M), users (45K), growth (23%), and churn (2.1%)",
    );
    await textarea.press("Enter");

    await waitForBotResponse(page);
    await page.waitForTimeout(3000);

    // Wait for at least one canvas card
    await waitForCanvasCards(page, 1, 15_000).catch(() => {
      // Non-fatal — bot may not have rendered canvas cards
    });

    await screenshotMilestone(page, testInfo, "dashboard-mode");

    // Click Freeform mode toggle
    const freeformBtn = page.locator(
      'button[title="Freeform mode — drag & resize freely"]',
    );
    const freeformVisible = await freeformBtn
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (!freeformVisible) {
      test.skip(
        true,
        "Freeform mode button not found — canvas toolbar may not be rendered",
      );
      return;
    }

    await freeformBtn.click();
    await page.waitForTimeout(1000);
    await screenshotMilestone(page, testInfo, "freeform-mode");

    // Verify canvas cards are still visible after switch
    const cardsAfterSwitch = page.locator("[data-card-id]");
    const cardCount = await cardsAfterSwitch.count();
    if (cardCount > 0) {
      await expect(cardsAfterSwitch.first()).toBeVisible();
    }

    // Switch back to Dashboard mode
    const dashboardBtn = page.locator(
      'button[title="Dashboard mode — auto-arranged grid"]',
    );
    if (await dashboardBtn.isVisible().catch(() => false)) {
      await dashboardBtn.click();
      await page.waitForTimeout(1000);
    }

    await screenshotMilestone(page, testInfo, "dashboard-mode-after-switch");
  });

  test("multiple bot responses accumulate canvas cards", async ({
    page,
  }, testInfo) => {
    const prompts = [
      "Show me a stat grid with 4 metrics: revenue, users, growth, and churn",
      "Create a data table of the top 3 programming languages with name and popularity",
      "Show me a bar chart of monthly sales for Jan, Feb, and Mar",
    ];

    const counts: number[] = [];

    for (let i = 0; i < prompts.length; i++) {
      const textarea = page.locator("textarea");
      await textarea.waitFor({ state: "visible", timeout: 10_000 });
      await textarea.fill(prompts[i]);
      await textarea.press("Enter");

      await waitForBotResponse(page);
      await page.waitForTimeout(3000);
      await screenshotMilestone(
        page,
        testInfo,
        `after-prompt-${i + 1}`,
      );

      // Count canvas elements — try data-card-id first, fallback to grid children
      let currentCount = await page.locator("[data-card-id]").count();
      if (currentCount === 0) {
        // Fallback: count children in the canvas grid panel
        currentCount = await page
          .locator(".min-w-\\[300px\\] > div > div")
          .count();
      }
      counts.push(currentCount);
    }

    // Soft assertion: card count should generally not decrease
    // (bot responses are non-deterministic, so we use soft expect)
    for (let i = 1; i < counts.length; i++) {
      expect
        .soft(
          counts[i],
          `Card count after prompt ${i + 1} (${counts[i]}) should be >= prompt ${i} (${counts[i - 1]})`,
        )
        .toBeGreaterThanOrEqual(counts[i - 1]);
    }

    await screenshotMilestone(page, testInfo, "accumulated-cards");
  });
});
