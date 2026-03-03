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
import { DATA_PROMPTS } from "./helpers/prompts";

test.describe("Canvas render — Charts, Tables, Metrics", () => {
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
      logTestFailure(testInfo, { group: "data", scenario: testInfo.title });
    }
  });

  for (const entry of DATA_PROMPTS) {
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

      // Component-specific DOM assertions — find card by component type (not just first card)
      const componentType = entry.expectedComponents[0];
      const typedCard = page.locator(`[data-component="${componentType}"]`).first();
      const card = (await typedCard.isVisible().catch(() => false))
        ? typedCard
        : page.locator("[data-card-id]").last(); // fallback to last card (most recently rendered)

      if (componentType === "chart") {
        // Charts should contain a recharts wrapper or SVG element
        const hasRecharts = await card
          .locator(".recharts-wrapper, svg.recharts-surface")
          .first()
          .isVisible()
          .catch(() => false);
        const hasSvg = await card
          .locator("svg")
          .first()
          .isVisible()
          .catch(() => false);
        expect
          .soft(
            hasRecharts || hasSvg,
            `Chart card should contain .recharts-wrapper or svg`,
          )
          .toBe(true);
      }

      if (componentType === "data_table") {
        // Data tables should contain a <table> element
        const hasTable = await card
          .locator("table")
          .first()
          .isVisible()
          .catch(() => false);
        expect
          .soft(hasTable, `Data table card should contain a <table> element`)
          .toBe(true);
      }

      if (componentType === "map") {
        // Maps should contain a Leaflet container (dynamically loaded)
        // Wait for Leaflet to fully load — it needs extra time for dynamic import
        await page.waitForTimeout(5_000);

        // Check multiple Leaflet indicators — the dynamic import may render differently
        const leaflet = page.locator(".leaflet-container").first();
        const hasLeaflet = await leaflet.isVisible().catch(() => false);
        // Leaflet zoom buttons have accessible name "Zoom in" with text "+"
        const hasZoomBtn = await page.getByRole("button", { name: "Zoom in" }).first().isVisible().catch(() => false);
        // Leaflet attribution link
        const hasAttribution = await page.locator('a[href*="leafletjs.com"], a:has-text("Leaflet")').first().isVisible().catch(() => false);
        // OpenStreetMap attribution
        const hasOSM = await page.locator('a[href*="openstreetmap.org"]').first().isVisible().catch(() => false);

        const hasMap = hasLeaflet || hasZoomBtn || hasAttribution || hasOSM;
        expect
          .soft(hasMap, `Map card should contain Leaflet elements (leaflet=${hasLeaflet}, zoom=${hasZoomBtn}, attribution=${hasAttribution}, osm=${hasOSM})`)
          .toBe(true);
      }

      // Capture milestone screenshot
      await screenshotMilestone(page, testInfo, entry.id);
    });
  }
});
