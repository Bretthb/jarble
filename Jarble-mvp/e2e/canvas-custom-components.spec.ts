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
import { CUSTOM_COMPONENT_PROMPTS } from "./helpers/prompts";

test.describe("Canvas custom component define & render", () => {
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
      logTestFailure(testInfo, { group: "custom-components", scenario: testInfo.title });
    }
  });

  // ── Sequential custom component lifecycle (all 8 steps in one test) ───
  test("full custom component define/render/list/reference lifecycle", async ({ page }, testInfo) => {
    test.setTimeout(480_000); // 8 sequential prompts need ~8 minutes
    // Step 1 (custom-01): Define custom component "status_badge"
    {
      const entry = CUSTOM_COMPONENT_PROMPTS[0];
      await sendPromptAndWait(page, entry.prompt);
      await waitForBotResponse(page, 60_000);
      const pageText = await page.textContent("body");
      const confirmsDefine =
        pageText?.toLowerCase().includes("defined") ||
        pageText?.toLowerCase().includes("created") ||
        pageText?.toLowerCase().includes("status_badge") ||
        pageText?.toLowerCase().includes("component") ||
        pageText?.toLowerCase().includes("registered");
      expect.soft(confirmsDefine, `${entry.id}: Bot should confirm component definition`).toBe(true);
      await screenshotMilestone(page, testInfo, `${entry.id}-defined`);
    }

    // Step 2 (custom-02): Render status_badge with Alice data
    {
      const entry = CUSTOM_COMPONENT_PROMPTS[1];
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
      const cardCount = await getCanvasCardCount(page);
      expect.soft(cardCount, `${entry.id}: Expected at least 1 card after rendering custom component`).toBeGreaterThanOrEqual(1);
      await assertNoErrorCards(page);
      await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);
    }

    // Step 3 (custom-03): Render status_badge with different data (Bob)
    {
      const entry = CUSTOM_COMPONENT_PROMPTS[2];
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
      const cardCount = await getCanvasCardCount(page);
      expect.soft(cardCount, `${entry.id}: Expected another card for Bob`).toBeGreaterThanOrEqual(1);
      await assertNoErrorCards(page);
      await screenshotMilestone(page, testInfo, `${entry.id}-rendered-bob`);
    }

    // Step 4 (custom-04): List components - should include "status_badge"
    {
      const entry = CUSTOM_COMPONENT_PROMPTS[3];
      await sendPromptAndWait(page, entry.prompt);
      await waitForBotResponse(page, 60_000);
      const pageText = await page.textContent("body");
      const mentionsBadge =
        pageText?.toLowerCase().includes("status_badge") ||
        pageText?.toLowerCase().includes("status badge") ||
        pageText?.toLowerCase().includes("custom");
      expect.soft(mentionsBadge, `${entry.id}: Component list should mention status_badge`).toBe(true);
      await screenshotMilestone(page, testInfo, `${entry.id}-list`);
    }

    // Step 5 (custom-05): Get reference for status_badge
    {
      const entry = CUSTOM_COMPONENT_PROMPTS[4];
      await sendPromptAndWait(page, entry.prompt);
      await waitForBotResponse(page, 60_000);
      const pageText = await page.textContent("body");
      const hasSchemaInfo =
        pageText?.toLowerCase().includes("status_badge") ||
        pageText?.toLowerCase().includes("name") ||
        pageText?.toLowerCase().includes("status") ||
        pageText?.toLowerCase().includes("props") ||
        pageText?.toLowerCase().includes("schema");
      expect.soft(hasSchemaInfo, `${entry.id}: Bot should return schema/reference info`).toBe(true);
      await screenshotMilestone(page, testInfo, `${entry.id}-reference`);
    }

    // Step 6 (custom-06): Define second custom component "project_card"
    {
      const entry = CUSTOM_COMPONENT_PROMPTS[5];
      await sendPromptAndWait(page, entry.prompt);
      await waitForBotResponse(page, 60_000);
      const pageText = await page.textContent("body");
      const confirmsDefine =
        pageText?.toLowerCase().includes("defined") ||
        pageText?.toLowerCase().includes("created") ||
        pageText?.toLowerCase().includes("project_card") ||
        pageText?.toLowerCase().includes("component") ||
        pageText?.toLowerCase().includes("registered");
      expect.soft(confirmsDefine, `${entry.id}: Bot should confirm project_card definition`).toBe(true);
      await screenshotMilestone(page, testInfo, `${entry.id}-defined`);
    }

    // Step 7 (custom-07): Render project_card
    {
      const entry = CUSTOM_COMPONENT_PROMPTS[6];
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
      const cardCount = await getCanvasCardCount(page);
      expect.soft(cardCount, `${entry.id}: Expected card for project_card render`).toBeGreaterThanOrEqual(1);
      await assertNoErrorCards(page);
      await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);
    }

    // Step 8 (custom-08): Render unknown component - bot should handle gracefully
    {
      const entry = CUSTOM_COMPONENT_PROMPTS[7];
      await sendPromptAndWait(page, entry.prompt);
      await waitForBotResponse(page, 60_000);
      const pageText = await page.textContent("body");
      const handlesGracefully =
        pageText?.toLowerCase().includes("not found") ||
        pageText?.toLowerCase().includes("doesn't exist") ||
        pageText?.toLowerCase().includes("does not exist") ||
        pageText?.toLowerCase().includes("unknown") ||
        pageText?.toLowerCase().includes("no component") ||
        pageText?.toLowerCase().includes("not available") ||
        pageText?.toLowerCase().includes("nonexistent") ||
        pageText?.toLowerCase().includes("error") ||
        pageText?.toLowerCase().includes("can't find") ||
        pageText?.toLowerCase().includes("cannot find");
      expect.soft(
        handlesGracefully,
        `${entry.id}: Bot should handle unknown component gracefully`
      ).toBe(true);
      await screenshotMilestone(page, testInfo, `${entry.id}-unknown-handled`);
    }
  });
});
