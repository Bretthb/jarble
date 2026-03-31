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
  fillCanvasFormField,
  submitCanvasForm,
  clearCanvasState,
} from "./helpers/canvas";
import { FORM_INTERACTION_PROMPTS } from "./helpers/prompts";

test.describe("Canvas form interactions", () => {
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
      logTestFailure(testInfo, { group: "interaction-forms", scenario: testInfo.title });
    }
  });

  // ── interact-form-01: simple form with fill + submit ──────────────────
  test(`${FORM_INTERACTION_PROMPTS[0].id}: ${FORM_INTERACTION_PROMPTS[0].description} (with interaction)`, async ({ page }, testInfo) => {
    const entry = FORM_INTERACTION_PROMPTS[0];
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);

    // Verify form elements rendered
    const formFound = await waitForComponentType(page, "form", 10_000);
    expect.soft(formFound, "Expected form component to render").toBe(true);

    // Fill fields
    await fillCanvasFormField(page, "Full Name", "E2E Test User");
    await fillCanvasFormField(page, "Email", "test@e2e.com");
    await screenshotMilestone(page, testInfo, `${entry.id}-filled`);

    // Submit
    await submitCanvasForm(page);
    await waitForBotResponse(page, 60_000);
    await screenshotMilestone(page, testInfo, `${entry.id}-submitted`);

    // Verify bot acknowledged the data (soft assertion - LLM response is non-deterministic)
    const pageText = await page.textContent("body");
    const mentionsData =
      pageText?.includes("E2E Test User") ||
      pageText?.includes("test@e2e.com") ||
      pageText?.includes("submitted") ||
      pageText?.includes("received");
    expect.soft(mentionsData, "Bot should acknowledge the submitted form data").toBe(true);
  });

  // ── interact-form-02: textarea + select form with fill + submit ───────
  test(`${FORM_INTERACTION_PROMPTS[1].id}: ${FORM_INTERACTION_PROMPTS[1].description} (with interaction)`, async ({ page }, testInfo) => {
    const entry = FORM_INTERACTION_PROMPTS[1];
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);

    const formFound = await waitForComponentType(page, "form", 10_000);
    expect.soft(formFound, "Expected form component to render").toBe(true);

    // Fill the Message textarea
    await fillCanvasFormField(page, "Message", "This is an automated E2E test message for form interaction validation.");
    await screenshotMilestone(page, testInfo, `${entry.id}-filled`);

    // Submit
    await submitCanvasForm(page);
    await waitForBotResponse(page, 60_000);
    await screenshotMilestone(page, testInfo, `${entry.id}-submitted`);
  });

  // ── interact-form-03: contact form with all 4 fields + submit ─────────
  test(`${FORM_INTERACTION_PROMPTS[2].id}: ${FORM_INTERACTION_PROMPTS[2].description} (with interaction)`, async ({ page }, testInfo) => {
    const entry = FORM_INTERACTION_PROMPTS[2];
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);

    const formFound = await waitForComponentType(page, "form", 10_000);
    expect.soft(formFound, "Expected form component to render").toBe(true);

    // Fill all 4 fields
    await fillCanvasFormField(page, "Name", "E2E Tester");
    await fillCanvasFormField(page, "Email", "tester@e2e.jarble.ai");
    await fillCanvasFormField(page, "Subject", "Automated Test Submission");
    await fillCanvasFormField(page, "Message", "This contact form was filled and submitted by the Playwright E2E test suite.");
    await screenshotMilestone(page, testInfo, `${entry.id}-filled`);

    // Submit
    await submitCanvasForm(page);
    await waitForBotResponse(page, 60_000);
    await screenshotMilestone(page, testInfo, `${entry.id}-submitted`);
  });

  // ── interact-form-04 through interact-form-10: render-only verification ─
  for (let i = 3; i < FORM_INTERACTION_PROMPTS.length; i++) {
    const entry = FORM_INTERACTION_PROMPTS[i];

    test(`${entry.id}: ${entry.description} (render only)`, async ({ page }, testInfo) => {
      await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
      await assertNoErrorCards(page);

      // Verify form elements rendered
      const formFound = await waitForComponentType(page, "form", 10_000);
      expect.soft(formFound, `Expected form component for ${entry.id}`).toBe(true);

      // Verify at least some form elements exist (input, select, textarea, button)
      const card = page.locator("[data-card-id]").first();
      const hasInput = await card.locator("input").count() > 0;
      const hasTextarea = await card.locator("textarea").count() > 0;
      const hasSelect = await card.locator("select").count() > 0;
      const hasButton = await card.locator('button:not([type="submit"]), button[type="submit"]').count() > 0;
      const hasFormElements = hasInput || hasTextarea || hasSelect || hasButton;
      expect.soft(hasFormElements, `Expected at least one form element for ${entry.id}`).toBe(true);

      await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);
    });
  }
});
