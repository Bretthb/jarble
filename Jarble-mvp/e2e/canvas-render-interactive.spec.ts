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
} from "./helpers/canvas";
import { INTERACTIVE_RENDER_PROMPTS } from "./helpers/prompts";

test.describe("Canvas render — Interactive Components", () => {
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
        group: "interactive-render",
        scenario: testInfo.title,
      });
    }
  });

  for (const entry of INTERACTIVE_RENDER_PROMPTS) {
    test(`${entry.id}: ${entry.description}`, async ({ page }, testInfo) => {
      // Send prompt and wait for at least 1 canvas card
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

      // Soft-assert no error cards rendered
      await assertNoErrorCards(page);

      // Heuristic check that the expected component type rendered
      const found = await waitForComponentType(
        page,
        entry.expectedComponents[0],
        10_000,
      );
      expect
        .soft(found, `Expected ${entry.expectedComponents[0]} to render`)
        .toBe(true);

      // Component-specific DOM assertions — find card by component type
      const componentType = entry.expectedComponents[0];
      const typedCard = page.locator(`[data-component="${componentType}"]`).first();
      const card = (await typedCard.isVisible().catch(() => false))
        ? typedCard
        : page.locator("[data-card-id]").last();

      if (componentType === "form") {
        // Forms should contain input, select, or textarea elements
        const hasInput = await card
          .locator("input, select, textarea")
          .first()
          .isVisible()
          .catch(() => false);
        expect
          .soft(
            hasInput,
            `Form card should contain input, select, or textarea elements`,
          )
          .toBe(true);
      }

      if (componentType === "tabs") {
        // Tabs should contain a tablist role
        const hasTablist = await card
          .locator("[role='tablist']")
          .first()
          .isVisible()
          .catch(() => false);
        expect
          .soft(hasTablist, `Tabs card should contain [role='tablist']`)
          .toBe(true);
      }

      if (componentType === "accordion") {
        // Accordion should contain collapsible sections with data-state
        const hasAccordion = await card
          .locator("[data-state='open'], [data-state='closed']")
          .first()
          .isVisible()
          .catch(() => false);
        expect
          .soft(
            hasAccordion,
            `Accordion card should contain collapsible sections`,
          )
          .toBe(true);
      }

      if (componentType === "sandbox") {
        // Sandbox should contain an iframe
        const hasIframe = await card
          .locator("iframe")
          .first()
          .isVisible()
          .catch(() => false);
        expect
          .soft(hasIframe, `Sandbox card should contain an iframe`)
          .toBe(true);
      }

      if (componentType === "code_editor") {
        // Code editor should contain the Monaco editor
        const hasMonaco = await card
          .locator(".monaco-editor")
          .first()
          .isVisible()
          .catch(() => false);
        expect
          .soft(hasMonaco, `Code editor card should contain .monaco-editor`)
          .toBe(true);
      }

      // Capture milestone screenshot
      await screenshotMilestone(page, testInfo, entry.id);
    });
  }
});
