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
  clickCanvasButton,
  clearCanvasState,
} from "./helpers/canvas";
import { BUTTON_INTERACTION_PROMPTS } from "./helpers/prompts";

// IDs of chart-only prompts that should skip button click interaction
const CHART_ONLY_IDS = new Set(["interact-btn-06", "interact-btn-07"]);

test.describe("Canvas interaction — Button Clicks", () => {
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
      logTestFailure(testInfo, {
        group: "interaction-buttons",
        scenario: testInfo.title,
      });
    }
  });

  for (const entry of BUTTON_INTERACTION_PROMPTS) {
    test(`${entry.id}: ${entry.description}`, async ({ page }, testInfo) => {
      // Send prompt and wait for at least 1 canvas card
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

      // Soft-assert no error cards rendered
      await assertNoErrorCards(page);

      // Verify the expected component type rendered
      const found = await waitForComponentType(
        page,
        entry.expectedComponents[0],
        10_000,
      );
      expect
        .soft(found, `Expected ${entry.expectedComponents[0]} to render`)
        .toBe(true);

      // Screenshot after initial render
      await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);

      // -----------------------------------------------------------------
      // Chart-only prompts: just verify chart renders, skip click
      // -----------------------------------------------------------------
      if (CHART_ONLY_IDS.has(entry.id)) {
        const card = page.locator("[data-card-id]").first();
        const hasChart = await card
          .locator(".recharts-wrapper, svg.recharts-surface, svg")
          .first()
          .isVisible()
          .catch(() => false);
        expect
          .soft(hasChart, `Chart card should contain chart SVG elements`)
          .toBe(true);
        return; // Done for chart-only tests
      }

      // -----------------------------------------------------------------
      // Button interaction: click the target button and verify followup
      // -----------------------------------------------------------------
      if (entry.interactive && entry.interactive.action === "click") {
        // Click the specified button inside a canvas card
        await clickCanvasButton(page, entry.interactive.target, {
          timeout: 10_000,
        });

        // Wait for the bot to respond to the button click
        await waitForBotResponse(page, 60_000);

        // Allow rendering to settle
        await page.waitForTimeout(2_000);

        // Screenshot after interaction
        await screenshotMilestone(page, testInfo, `${entry.id}-clicked`);

        // Verify the bot acknowledged the click in its response.
        // Look for the button label text (or a reasonable variation) in the
        // most recent assistant message. We check the entire page text
        // because the exact container class may vary.
        if (entry.expectBotFollowup) {
          const pageText = await page.innerText("body");
          const target = entry.interactive.target.toLowerCase();

          // The bot response should reference the clicked option somewhere
          // on the page. This is a soft assertion because bot text is
          // non-deterministic.
          expect
            .soft(
              pageText.toLowerCase().includes(target),
              `Bot response should reference the clicked button "${entry.interactive.target}"`,
            )
            .toBe(true);
        }
      }
    });
  }
});
