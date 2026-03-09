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
  getCanvasCardIds,
  clearCanvasState,
} from "./helpers/canvas";

test.describe("Artifact workspace", () => {
  let flush: () => Promise<void>;
  let deploymentId: string;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    const config = getTestConfig();
    deploymentId = config.deploymentId;
    test.skip(!deploymentId, "No deploymentId — run test:e2e:auth first");
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, {
        group: "artifact-workspace",
        scenario: testInfo.title,
      });
    }
  });

  // ── Test 1: artifact round-trip — create component, verify sync fires ──
  test("artifact round-trip — create component, verify sync fires", async ({
    page,
  }, testInfo) => {
    test.slow();
    await page.goto(`/d/${deploymentId}`);
    await clearCanvasState(page);

    // Listen for /artifact/sync calls
    let syncCalled = false;
    page.on("response", (response) => {
      if (response.url().includes("/artifact/sync")) {
        syncCalled = true;
      }
    });

    await sendPromptAndWait(
      page,
      "Create a spreadsheet with columns Name, Email, Age and 3 sample rows",
      { minCards: 1 },
    );

    const cardCount = await getCanvasCardCount(page);
    expect
      .soft(cardCount, "Expected at least 1 card after create")
      .toBeGreaterThanOrEqual(1);

    // Wait for auto-save debounce (SYNC_DEBOUNCE_MS = 2000ms + buffer)
    await page.waitForTimeout(3_000);

    await screenshotMilestone(page, testInfo, "artifact-01-created");

    // Soft assert — sync depends on whether the component is artifact-worthy
    expect
      .soft(
        syncCalled,
        "Expected /artifact/sync to be called for artifact-worthy component (soft)",
      )
      .toBe(true);
  });

  // ── Test 2: session restore — artifact list fires on page load ─────────
  test("session restore — artifact list fires on page load", async ({
    page,
  }, testInfo) => {
    let listCallCount = 0;
    page.on("response", (response) => {
      if (response.url().includes("/artifact/list")) {
        listCallCount++;
      }
    });

    await page.goto(`/d/${deploymentId}`);

    // Wait for textarea to confirm page loaded
    await page
      .locator("textarea")
      .waitFor({ state: "visible", timeout: 30_000 });

    // Wait for useArtifactSync to fetch manifest
    await page.waitForTimeout(3_000);

    expect
      .soft(
        listCallCount,
        "Expected /artifact/list to be called at least once on page load",
      )
      .toBeGreaterThanOrEqual(1);

    await screenshotMilestone(page, testInfo, "artifact-02-session-load");
  });

  // ── Test 3: pin and restore — pinned artifacts survive navigation ──────
  test("pin and restore — pinned artifacts survive navigation", async ({
    page,
  }, testInfo) => {
    test.slow();
    await page.goto(`/d/${deploymentId}`);
    await clearCanvasState(page);

    await sendPromptAndWait(
      page,
      "Create a bar chart showing monthly revenue for Jan-Jun: 10k, 15k, 12k, 18k, 22k, 25k. Pin it to my workspace.",
      { minCards: 1 },
    );

    const cardCount = await getCanvasCardCount(page);
    expect
      .soft(cardCount, "Expected at least 1 card after chart creation")
      .toBeGreaterThanOrEqual(1);

    await screenshotMilestone(page, testInfo, "artifact-03-chart-created");

    // Wait for sync to persist
    await page.waitForTimeout(3_000);

    // Navigate away
    await page.goto("/dashboard");
    await page.waitForTimeout(2_000);

    // Navigate back
    await page.goto(`/d/${deploymentId}`);
    await page
      .locator("textarea")
      .waitFor({ state: "visible", timeout: 30_000 });

    // Wait for artifact restore
    await page.waitForTimeout(5_000);

    // Soft assert — depends on bot actually pinning the artifact
    const restoredCount = await getCanvasCardCount(page);
    expect
      .soft(
        restoredCount,
        "Expected pinned artifact to restore after navigation (soft)",
      )
      .toBeGreaterThanOrEqual(1);

    await screenshotMilestone(page, testInfo, "artifact-03-after-navigate");
  });

  // ── Test 4: API endpoint validation — network requests at correct times ─
  test("API endpoint validation — network requests at correct times", async ({
    page,
  }, testInfo) => {
    test.slow();
    await page.goto(`/d/${deploymentId}`);
    await clearCanvasState(page);

    let listCount = 0;
    let syncCount = 0;

    page.on("response", (response) => {
      const url = response.url();
      if (url.includes("/artifact/list")) listCount++;
      if (url.includes("/artifact/sync")) syncCount++;
    });

    // Reload to trigger artifact/list
    await page.reload();
    await page
      .locator("textarea")
      .waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(3_000);

    expect
      .soft(
        listCount,
        "Expected /artifact/list to fire on page load",
      )
      .toBeGreaterThanOrEqual(1);

    await sendPromptAndWait(
      page,
      "Show me a chart of quarterly profits: Q1 100k, Q2 150k, Q3 200k, Q4 250k",
      { minCards: 1 },
    );

    // Wait for sync debounce
    await page.waitForTimeout(3_000);

    // Soft assert — chart is artifact-worthy so sync should fire
    expect
      .soft(
        syncCount,
        "Expected /artifact/sync to fire for artifact-worthy chart (soft)",
      )
      .toBeGreaterThanOrEqual(1);

    await screenshotMilestone(page, testInfo, "artifact-04-network");
  });

  // ── Test 5: SSE update — bot updates existing card in place ────────────
  test("SSE update — bot updates existing card in place", async ({
    page,
  }, testInfo) => {
    test.slow();
    await page.goto(`/d/${deploymentId}`);
    await clearCanvasState(page);

    await sendPromptAndWait(
      page,
      "Create a chart showing sales: Jan 100, Feb 150, Mar 200",
      { minCards: 1 },
    );

    const countBefore = await getCanvasCardCount(page);
    const idsBefore = await getCanvasCardIds(page);
    await screenshotMilestone(page, testInfo, "artifact-05-initial");

    await sendPromptAndWait(
      page,
      "Update the chart to add April 250 and May 300",
    );

    // Small buffer for render
    await page.waitForTimeout(2_000);

    const countAfter = await getCanvasCardCount(page);

    // Soft assert — update should modify in place, not create extra cards
    // Allow +2 tolerance since bot may render additional text cards
    expect
      .soft(
        countAfter,
        `Card count should not dramatically increase (before: ${countBefore}, after: ${countAfter})`,
      )
      .toBeLessThanOrEqual(countBefore + 2);

    await screenshotMilestone(page, testInfo, "artifact-05-updated");
  });

  // ── Test 6: non-artifact components skip sync ──────────────────────────
  test("non-artifact components skip sync", async ({ page }, testInfo) => {
    test.slow();
    await page.goto(`/d/${deploymentId}`);
    await clearCanvasState(page);

    let syncCount = 0;
    page.on("response", (response) => {
      if (response.url().includes("/artifact/sync")) {
        syncCount++;
      }
    });

    await sendPromptAndWait(
      page,
      "Show me an alert that says 'Hello World'",
      { minCards: 1 },
    );

    // Wait well past the debounce window
    await page.waitForTimeout(4_000);

    // Alert is NOT artifact-worthy — sync should not fire
    expect
      .soft(
        syncCount,
        "Expected /artifact/sync NOT to fire for non-artifact component (alert)",
      )
      .toBe(0);

    await screenshotMilestone(page, testInfo, "artifact-06-no-sync");
  });

  // ── Test 7: artifact-worthy component triggers sync ────────────────────
  test("artifact-worthy component triggers sync", async ({
    page,
  }, testInfo) => {
    test.slow();
    await page.goto(`/d/${deploymentId}`);
    await clearCanvasState(page);

    let syncCount = 0;
    page.on("response", (response) => {
      if (response.url().includes("/artifact/sync")) {
        syncCount++;
      }
    });

    await sendPromptAndWait(
      page,
      "Create a code editor with a Python hello world program",
      { minCards: 1 },
    );

    // Wait for sync debounce
    await page.waitForTimeout(3_000);

    // Soft assert — code_editor IS artifact-worthy
    expect
      .soft(
        syncCount,
        "Expected /artifact/sync to fire for artifact-worthy code_editor (soft)",
      )
      .toBeGreaterThanOrEqual(1);

    await screenshotMilestone(page, testInfo, "artifact-07-sync-triggered");
  });
});
