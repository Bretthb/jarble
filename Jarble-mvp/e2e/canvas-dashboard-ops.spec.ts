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
  waitForCanvasCards,
  getCanvasCardCount,
  assertNoErrorCards,
  waitForComponentType,
  splitCard,
  closeCard,
  switchToFreeformMode,
  switchToDashboardMode,
  getCanvasCardIds,
  clearCanvasState,
} from "./helpers/canvas";
import { DASHBOARD_OPS_PROMPTS } from "./helpers/prompts";

test.describe("Canvas dashboard operations", () => {
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
      logTestFailure(testInfo, { group: "dashboard-ops", scenario: testInfo.title });
    }
  });

  // -----------------------------------------------------------------------
  // 1. Split stat_grid
  // -----------------------------------------------------------------------
  test("split stat_grid into individual cards (dashops-split-01)", async ({ page }, testInfo) => {
    const entry = DASHBOARD_OPS_PROMPTS.find((p) => p.id === "dashops-split-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const found = await waitForComponentType(page, "stat_grid", 15_000);
    if (!found) {
      // Bot may have already rendered individual metric_card/statistic components
      // instead of a single stat_grid - verify we have multiple cards
      const count = await getCanvasCardCount(page);
      expect.soft(count, "Bot rendered individual cards instead of stat_grid - count should be >= 2").toBeGreaterThanOrEqual(2);
      await screenshotMilestone(page, testInfo, "already-split");
      return;
    }

    const beforeCount = await getCanvasCardCount(page);
    await screenshotMilestone(page, testInfo, "before-split");

    await splitCard(page, 0);
    await page.waitForTimeout(2_000);

    const afterCount = await getCanvasCardCount(page);
    expect.soft(afterCount, "Card count should increase after split").toBeGreaterThan(beforeCount);
    await screenshotMilestone(page, testInfo, "after-split");
  });

  // -----------------------------------------------------------------------
  // 2. Close card
  // -----------------------------------------------------------------------
  test("close card removes it from canvas (dashops-close-01)", async ({ page }, testInfo) => {
    const entry = DASHBOARD_OPS_PROMPTS.find((p) => p.id === "dashops-close-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const beforeCount = await getCanvasCardCount(page);
    expect.soft(beforeCount, "At least one card should be present").toBeGreaterThanOrEqual(1);

    await closeCard(page, 0);
    await page.waitForTimeout(1_000);

    const afterCount = await getCanvasCardCount(page);
    expect.soft(afterCount, "Card count should decrease after close").toBeLessThan(beforeCount);
    await screenshotMilestone(page, testInfo, "after-close");
  });

  // -----------------------------------------------------------------------
  // 3. Dashboard <-> Freeform toggle
  // -----------------------------------------------------------------------
  test("dashboard and freeform toggle preserves cards", async ({ page }, testInfo) => {
    const entry = DASHBOARD_OPS_PROMPTS.find((p) => p.id === "dashops-split-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const countBefore = await getCanvasCardCount(page);
    await screenshotMilestone(page, testInfo, "dashboard-mode");

    await switchToFreeformMode(page);
    await screenshotMilestone(page, testInfo, "freeform-mode");

    // Cards should still be visible in freeform mode
    const countFreeform = await getCanvasCardCount(page);
    expect.soft(countFreeform, "Cards should persist in freeform mode").toBe(countBefore);

    const firstCard = page.locator("[data-card-id]").first();
    if (countFreeform > 0) {
      await expect.soft(firstCard).toBeVisible();
    }

    await switchToDashboardMode(page);
    await screenshotMilestone(page, testInfo, "dashboard-restored");

    const countRestored = await getCanvasCardCount(page);
    expect.soft(countRestored, "Cards should persist after switching back").toBe(countBefore);
  });

  // -----------------------------------------------------------------------
  // 4. Card selection click
  // -----------------------------------------------------------------------
  test("clicking Select button selects card with ring-2 class", async ({ page }, testInfo) => {
    const entry = DASHBOARD_OPS_PROMPTS.find((p) => p.id === "dashops-close-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const card = page.locator("[data-card-id]").first();
    // Hover to reveal the toolbar, then click the "Select" button
    await card.hover();
    await page.waitForTimeout(500);
    const selectBtn = card.locator('button[title="Select"], button[title="Deselect"]').first();
    if (await selectBtn.isVisible().catch(() => false)) {
      await selectBtn.click();
    } else {
      // Fallback: click the card body directly
      await card.click();
    }
    await page.waitForTimeout(500);

    // Check for ring-2 selection indicator on the card
    const hasRing = await card.evaluate((el) => {
      let node: Element | null = el;
      while (node) {
        if (node.classList.contains("ring-2")) return true;
        node = node.parentElement;
      }
      return false;
    });
    expect.soft(hasRing, "Card should have ring-2 class when selected").toBeTruthy();
    await screenshotMilestone(page, testInfo, "card-selected");
  });

  // -----------------------------------------------------------------------
  // 5. Escape deselects card
  // -----------------------------------------------------------------------
  test("pressing Escape deselects a selected card", async ({ page }, testInfo) => {
    const entry = DASHBOARD_OPS_PROMPTS.find((p) => p.id === "dashops-close-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const card = page.locator("[data-card-id]").first();
    // Hover to reveal toolbar, then click Select button
    await card.hover();
    await page.waitForTimeout(500);
    const selectBtn = card.locator('button[title="Select"], button[title="Deselect"]').first();
    if (await selectBtn.isVisible().catch(() => false)) {
      await selectBtn.click();
    } else {
      await card.click();
    }
    await page.waitForTimeout(500);

    // Verify selected
    const hasRingBefore = await card.evaluate((el) => {
      let node: Element | null = el;
      while (node) {
        if (node.classList.contains("ring-2")) return true;
        node = node.parentElement;
      }
      return false;
    });
    expect.soft(hasRingBefore, "Card should be selected after click").toBeTruthy();

    // Press Escape
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);

    // Verify deselected
    const hasRingAfter = await card.evaluate((el) => {
      let node: Element | null = el;
      while (node) {
        if (node.classList.contains("ring-2")) return true;
        node = node.parentElement;
      }
      return false;
    });
    expect.soft(hasRingAfter, "Card should not have ring-2 after Escape").toBeFalsy();
    await screenshotMilestone(page, testInfo, "card-deselected");
  });

  // -----------------------------------------------------------------------
  // 6. Cards accumulate across multiple prompts
  // -----------------------------------------------------------------------
  test("cards accumulate across 3 sequential prompts", async ({ page }, testInfo) => {
    const multiPrompts = DASHBOARD_OPS_PROMPTS.filter((p) =>
      ["dashops-multi-01", "dashops-multi-02", "dashops-multi-03"].includes(p.id),
    );

    const counts: number[] = [];

    for (const entry of multiPrompts) {
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
      const count = await getCanvasCardCount(page);
      counts.push(count);
      await screenshotMilestone(page, testInfo, `accumulate-${entry.id}`);
    }

    // Card count should never decrease
    for (let i = 1; i < counts.length; i++) {
      expect
        .soft(
          counts[i],
          `Count after prompt ${i + 1} (${counts[i]}) should be >= prompt ${i} (${counts[i - 1]})`,
        )
        .toBeGreaterThanOrEqual(counts[i - 1]);
    }
  });

  // -----------------------------------------------------------------------
  // 7. Canvas empty state
  // -----------------------------------------------------------------------
  test("canvas shows empty state before any prompt", async ({ page }, testInfo) => {
    // Do not send any prompt - just check the initial state
    await page.waitForTimeout(2_000);

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "No cards should be visible before any prompt").toBe(0);

    // Check for empty-state text or the canvas panel not being visible
    const canvasPanel = page.locator(".min-w-\\[300px\\]");
    const panelVisible = await canvasPanel.isVisible().catch(() => false);

    // Either no panel shown or panel has no cards - both are valid empty states
    if (panelVisible) {
      await screenshotMilestone(page, testInfo, "empty-canvas-panel");
    } else {
      await screenshotMilestone(page, testInfo, "no-canvas-panel");
    }
  });

  // -----------------------------------------------------------------------
  // 8. Multiple cards visible simultaneously
  // -----------------------------------------------------------------------
  test("multiple cards are simultaneously visible after accumulation", async ({ page }, testInfo) => {
    const multiPrompts = DASHBOARD_OPS_PROMPTS.filter((p) =>
      ["dashops-multi-01", "dashops-multi-02"].includes(p.id),
    );

    for (const entry of multiPrompts) {
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    }

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "At least 2 cards should be visible").toBeGreaterThanOrEqual(2);

    // Verify each card is individually visible
    const cards = page.locator("[data-card-id]");
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      await expect.soft(cards.nth(i), `Card ${i} should be visible`).toBeVisible();
    }

    await screenshotMilestone(page, testInfo, "multiple-cards-visible");
  });

  // -----------------------------------------------------------------------
  // 9. Card order stability
  // -----------------------------------------------------------------------
  test("card order is stable across renders", async ({ page }, testInfo) => {
    // Send two prompts to create multiple cards
    const multiPrompts = DASHBOARD_OPS_PROMPTS.filter((p) =>
      ["dashops-multi-01", "dashops-multi-02"].includes(p.id),
    );

    for (const entry of multiPrompts) {
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    }

    const idsBefore = await getCanvasCardIds(page);
    expect.soft(idsBefore.length, "Should have at least 2 cards").toBeGreaterThanOrEqual(2);

    // Wait a moment and re-read IDs - order should be identical
    await page.waitForTimeout(2_000);
    const idsAfter = await getCanvasCardIds(page);

    expect.soft(idsAfter, "Card IDs and order should remain stable").toEqual(idsBefore);
    await screenshotMilestone(page, testInfo, "card-order-stable");
  });

  // -----------------------------------------------------------------------
  // 10. View mode preserves card count
  // -----------------------------------------------------------------------
  test("switching view modes preserves card count", async ({ page }, testInfo) => {
    const entry = DASHBOARD_OPS_PROMPTS.find((p) => p.id === "dashops-split-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const countBefore = await getCanvasCardCount(page);
    expect.soft(countBefore, "Should have at least 1 card").toBeGreaterThanOrEqual(1);

    await switchToFreeformMode(page);
    const countFreeform = await getCanvasCardCount(page);
    expect.soft(countFreeform, "Freeform count should match dashboard count").toBe(countBefore);

    await switchToDashboardMode(page);
    const countDashboard = await getCanvasCardCount(page);
    expect.soft(countDashboard, "Dashboard count should match after round-trip").toBe(countBefore);

    await screenshotMilestone(page, testInfo, "view-mode-preserved");
  });

  // -----------------------------------------------------------------------
  // 11. Split produces individual metric cards
  // -----------------------------------------------------------------------
  test("splitting stat_grid produces individual statistic cards", async ({ page }, testInfo) => {
    const entry = DASHBOARD_OPS_PROMPTS.find((p) => p.id === "dashops-split-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const found = await waitForComponentType(page, "stat_grid", 15_000);
    if (!found) {
      test.skip(true, "stat_grid did not render - cannot test split");
      return;
    }

    const beforeCount = await getCanvasCardCount(page);

    await splitCard(page, 0);
    await page.waitForTimeout(2_000);

    const afterCount = await getCanvasCardCount(page);
    // Splitting a 4-metric stat_grid should yield at least 4 individual cards
    // (minus the original, plus the individual ones)
    expect.soft(afterCount, "Split should produce multiple individual cards").toBeGreaterThan(beforeCount);

    // Verify the individual cards are visible
    const cards = page.locator("[data-card-id]");
    const count = await cards.count();
    for (let i = 0; i < Math.min(count, 4); i++) {
      await expect.soft(cards.nth(i), `Split card ${i} should be visible`).toBeVisible();
    }

    await screenshotMilestone(page, testInfo, "split-individual-cards");
  });

  // -----------------------------------------------------------------------
  // 12. Close then send new prompt
  // -----------------------------------------------------------------------
  test("closing a card then sending a new prompt renders new card", async ({ page }, testInfo) => {
    const closeEntry = DASHBOARD_OPS_PROMPTS.find((p) => p.id === "dashops-close-01")!;
    await sendPromptAndWait(page, closeEntry.prompt, { minCards: 1 });

    const countAfterFirst = await getCanvasCardCount(page);
    expect.soft(countAfterFirst, "At least one card after first prompt").toBeGreaterThanOrEqual(1);

    // Close the first card
    await closeCard(page, 0);
    await page.waitForTimeout(1_000);

    const countAfterClose = await getCanvasCardCount(page);
    expect.soft(countAfterClose, "Count should decrease after close").toBeLessThan(countAfterFirst);
    await screenshotMilestone(page, testInfo, "after-close");

    // Send a new prompt
    const newEntry = DASHBOARD_OPS_PROMPTS.find((p) => p.id === "dashops-multi-01")!;
    await sendPromptAndWait(page, newEntry.prompt, { minCards: 1 });

    const countAfterNew = await getCanvasCardCount(page);
    expect.soft(countAfterNew, "New card should appear after second prompt").toBeGreaterThanOrEqual(1);
    await screenshotMilestone(page, testInfo, "after-new-prompt");
  });
});
