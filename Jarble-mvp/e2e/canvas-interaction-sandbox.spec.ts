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
  clearCanvasState,
} from "./helpers/canvas";
import { SANDBOX_PROMPTS } from "./helpers/prompts";

test.describe("Canvas sandbox interactions", () => {
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
      logTestFailure(testInfo, { group: "sandbox", scenario: testInfo.title });
    }
  });

  // ── sandbox-01: basic HTML sandbox ────────────────────────────────────
  test(`${SANDBOX_PROMPTS[0].id}: ${SANDBOX_PROMPTS[0].description}`, async ({ page }, testInfo) => {
    const entry = SANDBOX_PROMPTS[0];
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    // Verify iframe exists
    const iframe = page.locator("[data-card-id] iframe");
    await expect(iframe.first()).toBeVisible({ timeout: 15_000 });

    // Verify iframe has sandbox attribute (security check)
    const sandboxAttr = await iframe.first().getAttribute("sandbox");
    expect.soft(sandboxAttr, "Sandbox iframe should have sandbox attribute").toBeTruthy();

    // Verify sandbox does NOT allow same-origin (security)
    expect.soft(
      sandboxAttr?.includes("allow-same-origin"),
      "Sandbox iframe must not have allow-same-origin"
    ).toBeFalsy();

    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);
  });

  // ── sandbox-02: interactive counter ───────────────────────────────────
  test(`${SANDBOX_PROMPTS[1].id}: ${SANDBOX_PROMPTS[1].description}`, async ({ page }, testInfo) => {
    const entry = SANDBOX_PROMPTS[1];
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const iframe = page.locator("[data-card-id] iframe");
    await expect(iframe.first()).toBeVisible({ timeout: 15_000 });

    // Verify sandbox attribute
    const sandboxAttr = await iframe.first().getAttribute("sandbox");
    expect.soft(sandboxAttr, "Sandbox iframe should have sandbox attribute").toBeTruthy();

    // Wait 3 seconds for counter to initialize inside iframe
    await page.waitForTimeout(3_000);

    // Check if the counter is visible — we can see if the iframe loaded by checking its size
    const iframeBox = await iframe.first().boundingBox();
    expect.soft(iframeBox, "Iframe should have non-zero dimensions").toBeTruthy();
    if (iframeBox) {
      expect.soft(iframeBox.width, "Iframe width should be positive").toBeGreaterThan(0);
      expect.soft(iframeBox.height, "Iframe height should be positive").toBeGreaterThan(0);
    }

    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);
  });

  // ── sandbox-03: Three.js 3D sandbox ───────────────────────────────────
  test(`${SANDBOX_PROMPTS[2].id}: ${SANDBOX_PROMPTS[2].description}`, async ({ page }, testInfo) => {
    const entry = SANDBOX_PROMPTS[2];
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const iframe = page.locator("[data-card-id] iframe");
    await expect(iframe.first()).toBeVisible({ timeout: 15_000 });

    // Just verify iframe loaded — don't try to check canvas content inside sandboxed iframe
    const sandboxAttr = await iframe.first().getAttribute("sandbox");
    expect.soft(sandboxAttr, "Sandbox iframe should have sandbox attribute").toBeTruthy();
    expect.soft(
      sandboxAttr?.includes("allow-same-origin"),
      "Three.js sandbox must not have allow-same-origin"
    ).toBeFalsy();

    // Verify iframe has reasonable dimensions (Three.js loaded)
    const iframeBox = await iframe.first().boundingBox();
    expect.soft(iframeBox, "Three.js iframe should have dimensions").toBeTruthy();

    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);
  });

  // ── sandbox-04: CSS animation ─────────────────────────────────────────
  test(`${SANDBOX_PROMPTS[3].id}: ${SANDBOX_PROMPTS[3].description}`, async ({ page }, testInfo) => {
    const entry = SANDBOX_PROMPTS[3];
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const iframe = page.locator("[data-card-id] iframe");
    await expect(iframe.first()).toBeVisible({ timeout: 15_000 });

    const sandboxAttr = await iframe.first().getAttribute("sandbox");
    expect.soft(sandboxAttr, "Sandbox iframe should have sandbox attribute").toBeTruthy();
    expect.soft(
      sandboxAttr?.includes("allow-same-origin"),
      "Sandbox must not have allow-same-origin"
    ).toBeFalsy();

    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);
  });

  // ── sandbox-05: live clock ────────────────────────────────────────────
  test(`${SANDBOX_PROMPTS[4].id}: ${SANDBOX_PROMPTS[4].description}`, async ({ page }, testInfo) => {
    const entry = SANDBOX_PROMPTS[4];
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const iframe = page.locator("[data-card-id] iframe");
    await expect(iframe.first()).toBeVisible({ timeout: 15_000 });

    const sandboxAttr = await iframe.first().getAttribute("sandbox");
    expect.soft(sandboxAttr, "Sandbox iframe should have sandbox attribute").toBeTruthy();

    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);
  });

  // ── sandbox-06: drawing canvas ────────────────────────────────────────
  test(`${SANDBOX_PROMPTS[5].id}: ${SANDBOX_PROMPTS[5].description}`, async ({ page }, testInfo) => {
    const entry = SANDBOX_PROMPTS[5];
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const iframe = page.locator("[data-card-id] iframe");
    await expect(iframe.first()).toBeVisible({ timeout: 15_000 });

    const sandboxAttr = await iframe.first().getAttribute("sandbox");
    expect.soft(sandboxAttr, "Sandbox iframe should have sandbox attribute").toBeTruthy();
    expect.soft(
      sandboxAttr?.includes("allow-same-origin"),
      "Sandbox must not have allow-same-origin"
    ).toBeFalsy();

    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);
  });

  // ── sandbox-07: color picker ──────────────────────────────────────────
  test(`${SANDBOX_PROMPTS[6].id}: ${SANDBOX_PROMPTS[6].description}`, async ({ page }, testInfo) => {
    const entry = SANDBOX_PROMPTS[6];
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const iframe = page.locator("[data-card-id] iframe");
    await expect(iframe.first()).toBeVisible({ timeout: 15_000 });

    const sandboxAttr = await iframe.first().getAttribute("sandbox");
    expect.soft(sandboxAttr, "Sandbox iframe should have sandbox attribute").toBeTruthy();

    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);
  });

  // ── sandbox-08: calculator ────────────────────────────────────────────
  test(`${SANDBOX_PROMPTS[7].id}: ${SANDBOX_PROMPTS[7].description}`, async ({ page }, testInfo) => {
    const entry = SANDBOX_PROMPTS[7];
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const iframe = page.locator("[data-card-id] iframe");
    await expect(iframe.first()).toBeVisible({ timeout: 15_000 });

    const sandboxAttr = await iframe.first().getAttribute("sandbox");
    expect.soft(sandboxAttr, "Sandbox iframe should have sandbox attribute").toBeTruthy();
    expect.soft(
      sandboxAttr?.includes("allow-same-origin"),
      "Calculator sandbox must not have allow-same-origin"
    ).toBeFalsy();

    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, `${entry.id}-rendered`);
  });

  // ── Cross-cutting security check ──────────────────────────────────────
  test("all sandbox iframes enforce sandbox attribute without allow-same-origin", async ({ page }, testInfo) => {
    // Send a prompt that generates a sandbox
    await sendPromptAndWait(page, SANDBOX_PROMPTS[0].prompt, { minCards: 1 });

    const iframes = page.locator("[data-card-id] iframe");
    const count = await iframes.count();

    for (let i = 0; i < count; i++) {
      const sandboxAttr = await iframes.nth(i).getAttribute("sandbox");
      expect.soft(sandboxAttr, `Iframe ${i} should have sandbox attribute`).toBeTruthy();
      expect.soft(
        sandboxAttr?.includes("allow-same-origin"),
        `Iframe ${i} must not have allow-same-origin`
      ).toBeFalsy();
    }

    await screenshotMilestone(page, testInfo, "security-check");
  });
});
