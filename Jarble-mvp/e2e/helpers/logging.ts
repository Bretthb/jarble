import type { Page, Locator, TestInfo } from "@playwright/test";
import * as fs from "fs";
import * as path from "path";

/**
 * Attach console and network loggers to the page.
 * Returns a flush() function — call it in afterEach to write logs as attachments.
 */
export function attachAllLoggers(page: Page, testInfo: TestInfo) {
  const consoleLines: string[] = [];
  const networkLines: string[] = [];

  page.on("console", (msg) => {
    consoleLines.push(
      `[${msg.type()}] ${msg.text()}  (${msg.location().url})`,
    );
  });

  page.on("response", (response) => {
    const timing = response.request().timing();
    const duration =
      timing.responseEnd > 0
        ? `${Math.round(timing.responseEnd)}ms`
        : "n/a";
    networkLines.push(
      `${response.request().method()} ${response.status()} ${response.url()} (${duration})`,
    );
  });

  async function flush() {
    if (consoleLines.length > 0) {
      await testInfo.attach("console.log", {
        body: consoleLines.join("\n"),
        contentType: "text/plain",
      });
    }
    if (networkLines.length > 0) {
      await testInfo.attach("network.log", {
        body: networkLines.join("\n"),
        contentType: "text/plain",
      });
    }
  }

  return { flush };
}

/**
 * Take a full-page screenshot and attach it to the test report.
 */
export async function screenshotMilestone(
  page: Page,
  testInfo: TestInfo,
  name: string,
) {
  const buf = await page.screenshot({ fullPage: true });
  await testInfo.attach(name, { body: buf, contentType: "image/png" });
}

/**
 * Take a screenshot of a specific element and attach it to the test report.
 */
export async function screenshotElement(
  locator: Locator,
  testInfo: TestInfo,
  name: string,
) {
  const buf = await locator.screenshot();
  await testInfo.attach(name, { body: buf, contentType: "image/png" });
}

/**
 * Wait for a bot response to complete by watching the submit button spinner.
 * 1. Wait for the spinner to appear (streaming started), up to 10s.
 * 2. Wait for the spinner to disappear (streaming done), up to `timeout`.
 */
export async function waitForBotResponse(page: Page, timeout = 60_000) {
  const spinner = page.locator('button[type="submit"] svg.animate-spin');

  // Wait for streaming to start
  await spinner.waitFor({ state: "visible", timeout: 10_000 }).catch(() => {
    // Spinner may have already come and gone for fast responses — that's OK
  });

  // Wait for streaming to finish
  await spinner.waitFor({ state: "hidden", timeout });
}

/**
 * Wait until at least `minCount` canvas cards are rendered.
 * Tries data-card-id first, then falls back to grid children.
 */
export async function waitForCanvasCards(
  page: Page,
  minCount = 1,
  timeout = 30_000,
) {
  // Primary: cards with data-card-id attribute
  const dataCardLocator = page.locator("[data-card-id]");
  try {
    await dataCardLocator
      .nth(minCount - 1)
      .waitFor({ state: "visible", timeout: 5_000 });
    return;
  } catch {
    // Fallback: count children in the canvas grid area
  }

  // Fallback: look for motion.div cards in the grid panel
  const gridChildren = page.locator(".min-w-\\[300px\\] > div > div");
  await gridChildren
    .nth(minCount - 1)
    .waitFor({ state: "visible", timeout });
}

/**
 * Read the test config saved by auth-setup.
 */
export function getTestConfig(): { deploymentId: string } {
  const configPath = path.join(__dirname, "..", ".auth", "test-config.json");
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return { deploymentId: "" };
  }
}
