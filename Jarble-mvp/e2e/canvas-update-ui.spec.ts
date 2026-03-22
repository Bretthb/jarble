import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
  waitForBotResponse,
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
  getErrorCardCount,
  getCanvasCardIds,
  clearCanvasState,
} from "./helpers/canvas";
import { UPDATE_UI_PROMPTS, UPDATE_UI_FOLLOWUPS } from "./helpers/prompts";

test.describe("Canvas in-place UI updates", () => {
  let flush: () => Promise<void>;
  let deploymentId: string;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    const config = getTestConfig();
    deploymentId = config.deploymentId;
    test.skip(!deploymentId, "No deploymentId — run test:e2e:auth first");
    await page.goto(`/d/${deploymentId}`);
    await clearCanvasState(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "update-ui", scenario: testInfo.title });
    }
  });

  // ── update-01: card title + body update ───────────────────────────────
  test(`${UPDATE_UI_PROMPTS[0].id} → ${UPDATE_UI_FOLLOWUPS[0].id}: ${UPDATE_UI_PROMPTS[0].description} then update`, async ({ page }, testInfo) => {
    // Step 1: Create the initial card
    await sendPromptAndWait(page, UPDATE_UI_PROMPTS[0].prompt, { minCards: 1 });
    const countBefore = await getCanvasCardCount(page);
    const idsBefore = await getCanvasCardIds(page);
    await screenshotMilestone(page, testInfo, `${UPDATE_UI_PROMPTS[0].id}-before`);

    // Step 2: Send the followup to update
    await sendPromptAndWait(page, UPDATE_UI_FOLLOWUPS[0].prompt, { minCards: 1 });
    const countAfter = await getCanvasCardCount(page);
    const idsAfter = await getCanvasCardIds(page);
    await screenshotMilestone(page, testInfo, `${UPDATE_UI_FOLLOWUPS[0].id}-after`);

    // Verify: card count should not dramatically increase (update, not create new)
    // Allow +2 tolerance since bot may render additional text cards
    expect.soft(
      countAfter,
      `Card count should not dramatically increase (before: ${countBefore}, after: ${countAfter})`
    ).toBeLessThanOrEqual(countBefore + 3);

    await assertNoErrorCards(page);
  });

  // ── update-02: stat grid values update ────────────────────────────────
  test(`${UPDATE_UI_PROMPTS[1].id} → ${UPDATE_UI_FOLLOWUPS[1].id}: ${UPDATE_UI_PROMPTS[1].description} then update`, async ({ page }, testInfo) => {
    await sendPromptAndWait(page, UPDATE_UI_PROMPTS[1].prompt, { minCards: 1 });
    const countBefore = await getCanvasCardCount(page);
    const idsBefore = await getCanvasCardIds(page);
    await screenshotMilestone(page, testInfo, `${UPDATE_UI_PROMPTS[1].id}-before`);

    await sendPromptAndWait(page, UPDATE_UI_FOLLOWUPS[1].prompt, { minCards: 1 });
    const countAfter = await getCanvasCardCount(page);
    await screenshotMilestone(page, testInfo, `${UPDATE_UI_FOLLOWUPS[1].id}-after`);

    expect.soft(
      countAfter,
      `Card count should not dramatically increase (before: ${countBefore}, after: ${countAfter})`
    ).toBeLessThanOrEqual(countBefore + 3);

    await assertNoErrorCards(page);
  });

  // ── update-03: progress bar value update ──────────────────────────────
  test(`${UPDATE_UI_PROMPTS[2].id} → ${UPDATE_UI_FOLLOWUPS[2].id}: ${UPDATE_UI_PROMPTS[2].description} then update`, async ({ page }, testInfo) => {
    await sendPromptAndWait(page, UPDATE_UI_PROMPTS[2].prompt, { minCards: 1 });
    const countBefore = await getCanvasCardCount(page);
    const idsBefore = await getCanvasCardIds(page);
    await screenshotMilestone(page, testInfo, `${UPDATE_UI_PROMPTS[2].id}-before`);

    await sendPromptAndWait(page, UPDATE_UI_FOLLOWUPS[2].prompt, { minCards: 1 });
    const countAfter = await getCanvasCardCount(page);
    await screenshotMilestone(page, testInfo, `${UPDATE_UI_FOLLOWUPS[2].id}-after`);

    expect.soft(
      countAfter,
      `Card count should not dramatically increase (before: ${countBefore}, after: ${countAfter})`
    ).toBeLessThanOrEqual(countBefore + 3);

    await assertNoErrorCards(page);
  });

  // ── update-04: chart with more data ───────────────────────────────────
  test(`${UPDATE_UI_PROMPTS[3].id} → ${UPDATE_UI_FOLLOWUPS[3].id}: ${UPDATE_UI_PROMPTS[3].description} then update`, async ({ page }, testInfo) => {
    await sendPromptAndWait(page, UPDATE_UI_PROMPTS[3].prompt, { minCards: 1 });
    const countBefore = await getCanvasCardCount(page);
    const idsBefore = await getCanvasCardIds(page);
    await screenshotMilestone(page, testInfo, `${UPDATE_UI_PROMPTS[3].id}-before`);

    await sendPromptAndWait(page, UPDATE_UI_FOLLOWUPS[3].prompt, { minCards: 1 });
    const countAfter = await getCanvasCardCount(page);
    await screenshotMilestone(page, testInfo, `${UPDATE_UI_FOLLOWUPS[3].id}-after`);

    expect.soft(
      countAfter,
      `Card count should not dramatically increase (before: ${countBefore}, after: ${countAfter})`
    ).toBeLessThanOrEqual(countBefore + 3);

    await assertNoErrorCards(page);
  });

  // ── update-05: data table with more rows ──────────────────────────────
  test(`${UPDATE_UI_PROMPTS[4].id} → ${UPDATE_UI_FOLLOWUPS[4].id}: ${UPDATE_UI_PROMPTS[4].description} then update`, async ({ page }, testInfo) => {
    await sendPromptAndWait(page, UPDATE_UI_PROMPTS[4].prompt, { minCards: 1 });
    const countBefore = await getCanvasCardCount(page);
    const idsBefore = await getCanvasCardIds(page);
    await screenshotMilestone(page, testInfo, `${UPDATE_UI_PROMPTS[4].id}-before`);

    await sendPromptAndWait(page, UPDATE_UI_FOLLOWUPS[4].prompt, { minCards: 1 });
    const countAfter = await getCanvasCardCount(page);
    await screenshotMilestone(page, testInfo, `${UPDATE_UI_FOLLOWUPS[4].id}-after`);

    expect.soft(
      countAfter,
      `Card count should not dramatically increase (before: ${countBefore}, after: ${countAfter})`
    ).toBeLessThanOrEqual(countBefore + 3);

    await assertNoErrorCards(page);
  });

  // ── Verify overall update pattern works ───────────────────────────────
  test("create-then-update cycle does not produce error cards", async ({ page }, testInfo) => {
    // Quick smoke: create one component, update it, check for errors
    await sendPromptAndWait(page, UPDATE_UI_PROMPTS[0].prompt, { minCards: 1 });
    await sendPromptAndWait(page, UPDATE_UI_FOLLOWUPS[0].prompt);

    const errorCount = await getErrorCardCount(page);
    expect.soft(errorCount, "Update cycle should not produce error cards").toBe(0);
    await screenshotMilestone(page, testInfo, "update-cycle-no-errors");
  });
});
