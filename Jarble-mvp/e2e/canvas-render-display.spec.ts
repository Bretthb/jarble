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
  clearCanvasState,
  logTestFailure as canvasLogFailure,
} from "./helpers/canvas";
import { DISPLAY_PROMPTS_1 } from "./helpers/prompts";

test.describe("Canvas render — Display Components Part 1", () => {
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
      logTestFailure(testInfo, { group: "display-1", scenario: testInfo.title });
    }
  });

  for (const entry of DISPLAY_PROMPTS_1) {
    test(`${entry.id}: ${entry.description}`, async ({ page }, testInfo) => {
      // Send prompt and wait for at least 1 canvas card
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

      // Soft-assert no error cards rendered
      await assertNoErrorCards(page);

      // Heuristic check that the expected component type actually rendered
      const found = await waitForComponentType(
        page,
        entry.expectedComponents[0],
        10_000,
      );
      expect
        .soft(found, `Expected ${entry.expectedComponents[0]} to render`)
        .toBe(true);

      // Capture milestone screenshot
      await screenshotMilestone(page, testInfo, entry.id);
    });
  }
});
