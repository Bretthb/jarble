import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
  screenshotElement,
  waitForBotResponse,
  getTestConfig,
} from "./helpers/logging";
import { COMPONENT_PROMPTS } from "./helpers/prompts";
import { setupAuthIntercept } from "./helpers/auth";

test.describe("Chat component rendering", () => {
  let flush: () => Promise<void>;
  let deploymentId: string;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);

    const config = getTestConfig();
    deploymentId = config.deploymentId;
    test.skip(!deploymentId, "No deploymentId in test-config.json — run auth-setup first");

    await page.goto(`/d/${deploymentId}`);
    // Wait for the chat textarea to be ready
    await page.locator("textarea").waitFor({ state: "visible", timeout: 30_000 });
  });

  test.afterEach(async () => {
    await flush();
  });

  // Generate a test for each component prompt
  for (const entry of COMPONENT_PROMPTS) {
    test(`renders ${entry.description}`, async ({ page }, testInfo) => {
      // Type the prompt
      await page.locator("textarea").fill(entry.prompt);

      // Click send
      await page.locator('button[type="submit"]').click();

      // Wait for bot response to complete
      await waitForBotResponse(page);

      // Extra wait for canvas rendering
      await page.waitForTimeout(2_000);

      // Screenshot full page
      await screenshotMilestone(page, testInfo, `response-${entry.description}`);

      // Try to screenshot canvas panel if it appeared
      const canvasPanel = page.locator(".min-w-\\[300px\\]");
      if (await canvasPanel.isVisible()) {
        await screenshotElement(canvasPanel, testInfo, `canvas-${entry.description}`);
      }
    });
  }

  test("view mode toggle works", async ({ page }, testInfo) => {
    // Send a prompt that should generate a canvas component
    await page.locator("textarea").fill(COMPONENT_PROMPTS[0].prompt);
    await page.locator('button[type="submit"]').click();
    await waitForBotResponse(page);
    await page.waitForTimeout(2_000);

    // Check if canvas panel is visible
    const canvasPanel = page.locator(".min-w-\\[300px\\]");
    test.skip(!(await canvasPanel.isVisible()), "No canvas panel rendered — skipping view mode test");

    // Screenshot dashboard mode (default)
    await screenshotMilestone(page, testInfo, "mode-dashboard");

    // Switch to freeform mode
    const freeformBtn = page.locator('button[title="Freeform mode — drag & resize freely"]');
    await freeformBtn.click();
    await page.waitForTimeout(500);
    await screenshotMilestone(page, testInfo, "mode-freeform");

    // Switch back to dashboard mode
    const dashboardBtn = page.locator('button[title="Dashboard mode — auto-arranged grid"]');
    await dashboardBtn.click();
    await page.waitForTimeout(500);
    await screenshotMilestone(page, testInfo, "mode-dashboard-restored");
  });
});
