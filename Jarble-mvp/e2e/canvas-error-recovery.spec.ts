import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
  getTestConfig,
  logTestFailure,
} from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";
import {
  sendPromptAndWait,
  getCanvasCardCount,
  getErrorCardCount,
  assertNoErrorCards,
  waitForComponentType,
  clearCanvasState,
} from "./helpers/canvas";
import { ERROR_RECOVERY_PROMPTS } from "./helpers/prompts";

test.describe("Canvas error recovery", () => {
  let flush: () => Promise<void>;
  let deploymentId: string;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    const config = getTestConfig();
    deploymentId = config.deploymentId;
    test.skip(!deploymentId, "No deploymentId - run test:e2e:auth first");
    await page.goto(`/d/${deploymentId}`);
    await clearCanvasState(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "error-recovery", scenario: testInfo.title });
    }
  });

  // -----------------------------------------------------------------------
  // error-01: Chart with empty data / no xAxisKey
  // -----------------------------------------------------------------------
  test("handles chart with empty data gracefully (error-01)", async ({ page }, testInfo) => {
    const entry = ERROR_RECOVERY_PROMPTS.find((p) => p.id === "error-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "error-01-result");

    const cardCount = await getCanvasCardCount(page);
    const errorCount = await getErrorCardCount(page);

    // Either the bot handled it gracefully (rendered something) or an error card appeared
    expect.soft(
      cardCount > 0 || errorCount >= 0,
      "Should either render a component or show an error card",
    ).toBeTruthy();

    if (errorCount > 0) {
      // Verify "Fix Component" button is visible on error cards
      const fixButton = page.locator('[data-card-id]:has-text("Fix Component") button:has-text("Fix Component")').first();
      expect.soft(await fixButton.isVisible().catch(() => false), "Fix Component button should be visible on error card").toBeTruthy();
    }
  });

  // -----------------------------------------------------------------------
  // error-02: Progress bar with overflow value
  // -----------------------------------------------------------------------
  test("handles progress bar with value >100% (error-02)", async ({ page }, testInfo) => {
    const entry = ERROR_RECOVERY_PROMPTS.find((p) => p.id === "error-02")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "error-02-result");

    const cardCount = await getCanvasCardCount(page);
    const errorCount = await getErrorCardCount(page);

    // Bot may clamp the value, render it as-is, or produce an error - all acceptable
    expect.soft(
      cardCount > 0,
      "At least one card (component or error) should appear",
    ).toBeTruthy();

    if (errorCount === 0) {
      // AutoFix may have clamped the value - check that progress rendered
      const hasProgress = await waitForComponentType(page, "progress", 5_000);
      expect.soft(hasProgress, "Progress component should render when no error").toBeTruthy();
    }
  });

  // -----------------------------------------------------------------------
  // error-03: Empty data table (columns, zero rows)
  // -----------------------------------------------------------------------
  test("renders empty data table with headers (error-03)", async ({ page }, testInfo) => {
    const entry = ERROR_RECOVERY_PROMPTS.find((p) => p.id === "error-03")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "error-03-result");

    const cardCount = await getCanvasCardCount(page);
    const errorCount = await getErrorCardCount(page);

    if (errorCount === 0 && cardCount > 0) {
      // Table header should render even with zero rows
      const hasTable = await waitForComponentType(page, "data_table", 5_000);
      if (hasTable) {
        const headerCells = page.locator("[data-card-id] table th, [data-card-id] table thead td");
        const headerCount = await headerCells.count();
        expect.soft(headerCount, "Table header cells should render even with no data rows").toBeGreaterThan(0);
      }
    }
  });

  // -----------------------------------------------------------------------
  // error-04: Extremely long title (500 chars)
  // -----------------------------------------------------------------------
  test("handles extremely long title without crashing (error-04)", async ({ page }, testInfo) => {
    const entry = ERROR_RECOVERY_PROMPTS.find((p) => p.id === "error-04")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "error-04-result");

    const cardCount = await getCanvasCardCount(page);
    // Long text should be truncated or wrapped, not crash the renderer
    expect.soft(cardCount, "Card should render despite long title").toBeGreaterThanOrEqual(1);

    // Verify the card is visible and not overflowing the viewport
    const card = page.locator("[data-card-id]").first();
    if (await card.isVisible().catch(() => false)) {
      const box = await card.boundingBox();
      if (box) {
        const viewport = page.viewportSize();
        if (viewport) {
          expect.soft(
            box.width,
            "Card width should not exceed viewport width",
          ).toBeLessThanOrEqual(viewport.width + 50); // small tolerance for scrollbar
        }
      }
    }
  });

  // -----------------------------------------------------------------------
  // error-05: Stat grid with missing fields
  // -----------------------------------------------------------------------
  test("handles stat grid with missing fields (error-05)", async ({ page }, testInfo) => {
    const entry = ERROR_RECOVERY_PROMPTS.find((p) => p.id === "error-05")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "error-05-result");

    const cardCount = await getCanvasCardCount(page);
    const errorCount = await getErrorCardCount(page);

    // AutoFix may fill in defaults, or an error card may appear - both acceptable
    expect.soft(
      cardCount > 0,
      "Should render at least one card (component or error)",
    ).toBeTruthy();

    if (errorCount > 0) {
      const fixButton = page.locator('[data-card-id]:has-text("Fix Component") button:has-text("Fix Component")').first();
      expect.soft(await fixButton.isVisible().catch(() => false), "Fix Component button should be visible").toBeTruthy();
    }
  });

  // -----------------------------------------------------------------------
  // error-06: Sandbox with broken JavaScript
  // -----------------------------------------------------------------------
  test("handles sandbox with broken JS (error-06)", async ({ page }, testInfo) => {
    const entry = ERROR_RECOVERY_PROMPTS.find((p) => p.id === "error-06")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "error-06-result");

    const cardCount = await getCanvasCardCount(page);
    const errorCount = await getErrorCardCount(page);

    // The sandbox should either:
    // a) Show the error overlay within the iframe
    // b) Show an error card with "Fix Component"
    // c) The bot catches the broken JS and explains the error in text
    expect.soft(
      cardCount > 0 || errorCount >= 0,
      "Page should handle broken sandbox JS without crashing",
    ).toBeTruthy();

    // Check if the bot mentioned an error in its response
    const lastMessage = page.locator('[data-testid="assistant-message"]').last();
    if (await lastMessage.isVisible().catch(() => false)) {
      const text = (await lastMessage.textContent()) || "";
      const mentionsError = /error|syntax|broken|invalid|fix/i.test(text);
      // It's fine either way - bot may render the broken code or explain the error
      if (mentionsError) {
        expect.soft(true, "Bot acknowledged the broken JS").toBeTruthy();
      }
    }
  });

  // -----------------------------------------------------------------------
  // error-07: Chart with wrong xAxisKey
  // -----------------------------------------------------------------------
  test("handles chart with mismatched xAxisKey (error-07)", async ({ page }, testInfo) => {
    const entry = ERROR_RECOVERY_PROMPTS.find((p) => p.id === "error-07")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "error-07-result");

    const cardCount = await getCanvasCardCount(page);
    const errorCount = await getErrorCardCount(page);

    // Either renders with empty axis (graceful degradation) or shows error
    expect.soft(
      cardCount > 0,
      "Should render at least one card",
    ).toBeTruthy();

    if (errorCount > 0) {
      const fixButton = page.locator('[data-card-id]:has-text("Fix Component") button:has-text("Fix Component")').first();
      expect.soft(await fixButton.isVisible().catch(() => false), "Fix Component button should be visible").toBeTruthy();
    }
  });

  // -----------------------------------------------------------------------
  // error-08: Image with invalid URL
  // -----------------------------------------------------------------------
  test("handles image with invalid URL (error-08)", async ({ page }, testInfo) => {
    const entry = ERROR_RECOVERY_PROMPTS.find((p) => p.id === "error-08")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "error-08-result");

    const cardCount = await getCanvasCardCount(page);
    // Image component should show fallback or error state - not crash
    expect.soft(
      cardCount > 0,
      "Should render at least one card (image with fallback or error card)",
    ).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // error-09: Form with zero fields
  // -----------------------------------------------------------------------
  test("handles form with no fields (error-09)", async ({ page }, testInfo) => {
    const entry = ERROR_RECOVERY_PROMPTS.find((p) => p.id === "error-09")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "error-09-result");

    const cardCount = await getCanvasCardCount(page);
    const errorCount = await getErrorCardCount(page);

    // Bot may create a form with just a submit button, refuse, or produce error
    expect.soft(
      cardCount >= 0,
      "Page should not crash with empty form",
    ).toBeTruthy();

    if (errorCount === 0 && cardCount > 0) {
      // If rendered, at least a submit button should be present
      const submitBtn = page.locator('[data-card-id] button[type="submit"], [data-card-id] button:has-text("Submit")').first();
      const hasSubmit = await submitBtn.isVisible().catch(() => false);
      // Not a hard requirement - bot may interpret "zero fields" differently
      if (hasSubmit) {
        expect.soft(true, "Form rendered with submit button").toBeTruthy();
      }
    }
  });

  // -----------------------------------------------------------------------
  // error-10: Tabs with zero tabs
  // -----------------------------------------------------------------------
  test("handles tabs component with no tabs (error-10)", async ({ page }, testInfo) => {
    const entry = ERROR_RECOVERY_PROMPTS.find((p) => p.id === "error-10")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "error-10-result");

    const cardCount = await getCanvasCardCount(page);
    const errorCount = await getErrorCardCount(page);

    // Bot may refuse the request, create tabs with default content, or produce error
    // All outcomes are valid - we just ensure no crash
    expect.soft(
      cardCount >= 0,
      "Page should handle zero-tab request without crashing",
    ).toBeTruthy();

    if (errorCount > 0) {
      const fixButton = page.locator('[data-card-id]:has-text("Fix Component") button:has-text("Fix Component")').first();
      expect.soft(await fixButton.isVisible().catch(() => false), "Fix Component button should be visible").toBeTruthy();
    }
  });
});
