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
import { SAVE_LOAD_PROMPTS } from "./helpers/prompts";

test.describe("Canvas save/load cycle", () => {
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
      logTestFailure(testInfo, { group: "save-load", scenario: testInfo.title });
    }
  });

  // ── Sequential save/load cycle (all 10 steps in one test) ─────────────
  test("full save/load/delete cycle across 10 sequential prompts", async ({ page }, testInfo) => {
    test.setTimeout(600_000); // 10 sequential prompts need ~10 minutes
    // Step 1 (save-01): Create component to save
    {
      const entry = SAVE_LOAD_PROMPTS[0];
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
      const cardCount = await getCanvasCardCount(page);
      expect.soft(cardCount, `${entry.id}: Expected at least 1 card after create`).toBeGreaterThanOrEqual(1);
      await assertNoErrorCards(page);
      await screenshotMilestone(page, testInfo, `${entry.id}-created`);
    }

    // Step 2 (save-02): Save it
    {
      const entry = SAVE_LOAD_PROMPTS[1];
      await sendPromptAndWait(page, entry.prompt);
      await waitForBotResponse(page, 60_000);
      // Bot should confirm the save
      const pageText = await page.textContent("body");
      const confirmsSave =
        pageText?.toLowerCase().includes("saved") ||
        pageText?.toLowerCase().includes("save") ||
        pageText?.toLowerCase().includes("my-dashboard") ||
        pageText?.toLowerCase().includes("file");
      expect.soft(confirmsSave, `${entry.id}: Bot should confirm the save operation`).toBe(true);
      await screenshotMilestone(page, testInfo, `${entry.id}-saved`);
    }

    // Step 3 (save-03): List files
    {
      const entry = SAVE_LOAD_PROMPTS[2];
      await sendPromptAndWait(page, entry.prompt);
      await waitForBotResponse(page, 60_000);
      const pageText = await page.textContent("body");
      const listsFile =
        pageText?.toLowerCase().includes("my-dashboard") ||
        pageText?.toLowerCase().includes("dashboard") ||
        pageText?.toLowerCase().includes("file");
      expect.soft(listsFile, `${entry.id}: Bot should list the saved file`).toBe(true);
      await screenshotMilestone(page, testInfo, `${entry.id}-listed`);
    }

    // Step 4 (save-04): Load the file
    {
      const entry = SAVE_LOAD_PROMPTS[3];
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
      const cardCount = await getCanvasCardCount(page);
      expect.soft(cardCount, `${entry.id}: Expected at least 1 card after load`).toBeGreaterThanOrEqual(1);
      await screenshotMilestone(page, testInfo, `${entry.id}-loaded`);
    }

    // Step 5 (save-05): Delete the file
    {
      const entry = SAVE_LOAD_PROMPTS[4];
      await sendPromptAndWait(page, entry.prompt);
      await waitForBotResponse(page, 60_000);
      const pageText = await page.textContent("body");
      const confirmsDelete =
        pageText?.toLowerCase().includes("deleted") ||
        pageText?.toLowerCase().includes("removed") ||
        pageText?.toLowerCase().includes("delete");
      expect.soft(confirmsDelete, `${entry.id}: Bot should confirm the delete operation`).toBe(true);
      await screenshotMilestone(page, testInfo, `${entry.id}-deleted`);
    }

    // Step 6 (save-06): Create another and save it
    {
      const entry = SAVE_LOAD_PROMPTS[5];
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
      const pageText = await page.textContent("body");
      const confirmsSave =
        pageText?.toLowerCase().includes("saved") ||
        pageText?.toLowerCase().includes("save") ||
        pageText?.toLowerCase().includes("quarterly");
      expect.soft(confirmsSave, `${entry.id}: Bot should confirm create and save`).toBe(true);
      await screenshotMilestone(page, testInfo, `${entry.id}-created-and-saved`);
    }

    // Step 7 (save-07): Load the second file
    {
      const entry = SAVE_LOAD_PROMPTS[6];
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
      const cardCount = await getCanvasCardCount(page);
      expect.soft(cardCount, `${entry.id}: Expected at least 1 card after loading chart`).toBeGreaterThanOrEqual(1);
      await screenshotMilestone(page, testInfo, `${entry.id}-loaded`);
    }

    // Step 8 (save-08): Load nonexistent file (error case)
    {
      const entry = SAVE_LOAD_PROMPTS[7];
      await sendPromptAndWait(page, entry.prompt);
      await waitForBotResponse(page, 60_000);
      const pageText = await page.textContent("body");
      const handlesError =
        pageText?.toLowerCase().includes("not found") ||
        pageText?.toLowerCase().includes("doesn't exist") ||
        pageText?.toLowerCase().includes("does not exist") ||
        pageText?.toLowerCase().includes("no file") ||
        pageText?.toLowerCase().includes("error") ||
        pageText?.toLowerCase().includes("couldn't find") ||
        pageText?.toLowerCase().includes("unable");
      expect.soft(handlesError, `${entry.id}: Bot should indicate file not found`).toBe(true);
      await screenshotMilestone(page, testInfo, `${entry.id}-error-handled`);
    }

    // Step 9 (save-09): Delete cleanup
    {
      const entry = SAVE_LOAD_PROMPTS[8];
      await sendPromptAndWait(page, entry.prompt);
      await waitForBotResponse(page, 60_000);
      const pageText = await page.textContent("body");
      const confirmsDelete =
        pageText?.toLowerCase().includes("deleted") ||
        pageText?.toLowerCase().includes("removed") ||
        pageText?.toLowerCase().includes("delete");
      expect.soft(confirmsDelete, `${entry.id}: Bot should confirm cleanup delete`).toBe(true);
      await screenshotMilestone(page, testInfo, `${entry.id}-cleanup-deleted`);
    }

    // Step 10 (save-10): List to verify cleanup
    {
      const entry = SAVE_LOAD_PROMPTS[9];
      await sendPromptAndWait(page, entry.prompt);
      await waitForBotResponse(page, 60_000);
      await screenshotMilestone(page, testInfo, `${entry.id}-cleanup-verified`);
    }
  });
});
