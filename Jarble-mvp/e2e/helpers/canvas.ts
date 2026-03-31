import type { Page, TestInfo } from "@playwright/test";
import { expect } from "@playwright/test";

// ---------------------------------------------------------------------------
// Core: send a prompt and wait for bot response + canvas cards
// ---------------------------------------------------------------------------

/**
 * Wait for the bot to be in a ready state (running, textarea enabled, no error banner).
 * Retries up to `maxWait` ms, checking every 3s.
 */
export async function waitForBotReady(
  page: Page,
  maxWait = 60_000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    // Check for "Bot is not running" banner
    const notRunning = page.locator('text="Bot is not running"');
    const isDown = await notRunning.isVisible().catch(() => false);
    if (!isDown) {
      // Also check textarea is enabled (not disabled = bot not streaming)
      const textarea = page.locator("textarea");
      const isDisabled = await textarea.getAttribute("disabled").catch(() => null);
      if (isDisabled === null) {
        return; // Bot is ready
      }
    }
    // Bot is down or busy - wait and retry
    await page.waitForTimeout(3_000);
    // Try clicking Start Bot if visible
    const startBtn = page.locator('button:has-text("Start Bot")');
    if (await startBtn.isVisible().catch(() => false)) {
      await startBtn.click().catch(() => {});
      await page.waitForTimeout(5_000);
    }
  }
}

/**
 * Type a prompt, click submit, wait for the bot response to complete,
 * then optionally wait for a minimum number of canvas cards to appear.
 */
export async function sendPromptAndWait(
  page: Page,
  prompt: string,
  opts: { minCards?: number; timeout?: number } = {},
) {
  const { minCards = 0, timeout = 120_000 } = opts;

  // Wait for bot to be ready before sending
  await waitForBotReady(page, 30_000);

  const textarea = page.locator("textarea");
  await textarea.waitFor({ state: "visible", timeout: 15_000 });
  await textarea.fill(prompt);
  await page.locator('button[type="submit"]').click();

  // Wait for streaming to start (spinner appears)
  const spinner = page.locator('button[type="submit"] svg.animate-spin');
  await spinner
    .waitFor({ state: "visible", timeout: 30_000 })
    .catch(() => {
      /* fast response - spinner may have already gone */
    });

  // Wait for streaming to finish (spinner disappears)
  await spinner.waitFor({ state: "hidden", timeout });

  // Small buffer for canvas render
  await page.waitForTimeout(2_000);

  // Optionally wait for canvas cards
  if (minCards > 0) {
    await waitForCanvasCards(page, minCards, 15_000);
  }
}

// ---------------------------------------------------------------------------
// Canvas card utilities
// ---------------------------------------------------------------------------

/** Wait until at least `minCount` cards with [data-card-id] are visible. */
export async function waitForCanvasCards(
  page: Page,
  minCount = 1,
  timeout = 15_000,
) {
  const locator = page.locator("[data-card-id]");
  await locator
    .nth(minCount - 1)
    .waitFor({ state: "visible", timeout })
    .catch(() => {
      /* non-fatal - bot may not have rendered enough cards */
    });
}

/** Count visible canvas cards. */
export async function getCanvasCardCount(page: Page): Promise<number> {
  return page.locator("[data-card-id]").count();
}

/** Get all card IDs currently on the canvas. */
export async function getCanvasCardIds(page: Page): Promise<string[]> {
  const cards = page.locator("[data-card-id]");
  const count = await cards.count();
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = await cards.nth(i).getAttribute("data-card-id");
    if (id) ids.push(id);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Component type detection via data-component attribute
// ---------------------------------------------------------------------------

/**
 * Wait for a card containing a specific component type.
 * Uses the `data-component` attribute set by CanvasRenderer.tsx.
 */
export async function waitForComponentType(
  page: Page,
  componentName: string,
  timeout = 15_000,
): Promise<boolean> {
  try {
    await page
      .locator(`[data-component="${componentName}"]`)
      .first()
      .waitFor({ state: "visible", timeout });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Interaction helpers
// ---------------------------------------------------------------------------

/** Click a button inside a canvas card by button text/label.
 *  Searches across ALL canvas cards if not found in the specified card index. */
export async function clickCanvasButton(
  page: Page,
  buttonLabel: string,
  opts: { cardIndex?: number; timeout?: number } = {},
): Promise<void> {
  const { cardIndex, timeout = 10_000 } = opts;

  // If a specific card index was given, search there first
  if (cardIndex !== undefined) {
    const card = page.locator("[data-card-id]").nth(cardIndex);
    const button = card.getByRole("button", { name: buttonLabel });
    if (await button.isVisible().catch(() => false)) {
      await button.click();
      return;
    }
  }

  // Search ALL canvas cards for the button
  const button = page.locator("[data-card-id]").getByRole("button", { name: buttonLabel }).first();
  await button.waitFor({ state: "visible", timeout });
  await button.click();
}

/** Fill a form field inside a canvas card by field label.
 *  Searches across ALL canvas cards if not found in the specified card. */
export async function fillCanvasFormField(
  page: Page,
  fieldLabel: string,
  value: string,
  opts: { cardIndex?: number } = {},
): Promise<void> {
  // Scope: specific card if given, otherwise search all cards
  const scope = opts.cardIndex !== undefined
    ? page.locator("[data-card-id]").nth(opts.cardIndex)
    : page.locator("[data-card-id]");

  // Try label-based targeting first
  const input = scope.locator(`label:has-text("${fieldLabel}") + input, label:has-text("${fieldLabel}") + textarea, label:has-text("${fieldLabel}") ~ input, label:has-text("${fieldLabel}") ~ textarea`).first();
  if (await input.isVisible().catch(() => false)) {
    await input.fill(value);
    return;
  }

  // Fallback: placeholder-based
  const placeholder = scope.locator(`input[placeholder*="${fieldLabel}" i], textarea[placeholder*="${fieldLabel}" i]`).first();
  if (await placeholder.isVisible().catch(() => false)) {
    await placeholder.fill(value);
    return;
  }

  // Fallback: getByLabel across all cards
  const byLabel = scope.getByLabel(fieldLabel).first();
  if (await byLabel.isVisible().catch(() => false)) {
    await byLabel.fill(value);
    return;
  }

  // Final fallback: search across the entire page for the field
  await page.getByLabel(fieldLabel).first().fill(value);
}

/** Select an option in a select field inside a canvas card. */
export async function selectCanvasFormOption(
  page: Page,
  fieldLabel: string,
  optionValue: string,
  opts: { cardIndex?: number } = {},
): Promise<void> {
  const { cardIndex = 0 } = opts;
  const card = page.locator("[data-card-id]").nth(cardIndex);
  const select = card.locator(`label:has-text("${fieldLabel}") ~ select, select[name*="${fieldLabel}" i]`).first();
  await select.selectOption(optionValue);
}

/** Submit a form inside a canvas card. Searches all cards if not found in the specified card. */
export async function submitCanvasForm(
  page: Page,
  opts: { cardIndex?: number } = {},
): Promise<void> {
  const scope = opts.cardIndex !== undefined
    ? page.locator("[data-card-id]").nth(opts.cardIndex)
    : page.locator("[data-card-id]");
  const submitBtn = scope.locator('button[type="submit"], button:has-text("Submit")').first();
  await submitBtn.click();
}

// ---------------------------------------------------------------------------
// Error card detection
// ---------------------------------------------------------------------------

/** Count error cards on the canvas (red border indicates error). */
export async function getErrorCardCount(page: Page): Promise<number> {
  // Error cards have red borders and "failed to render" or "Fix Component" text
  const errorCards = page.locator('[data-card-id]:has-text("failed to render"), [data-card-id]:has-text("Fix Component"), [data-card-id]:has-text("Error rendering")');
  return errorCards.count();
}

/** Soft-assert that there are zero error cards on the canvas. */
export async function assertNoErrorCards(page: Page): Promise<void> {
  const count = await getErrorCardCount(page);
  expect.soft(count, "Expected zero error cards on canvas").toBe(0);
}

/** Check if any card has the streaming animation class. */
export async function hasStreamingCards(page: Page): Promise<boolean> {
  const streaming = page.locator(".canvas-card-streaming");
  return (await streaming.count()) > 0;
}

// ---------------------------------------------------------------------------
// Split / Merge / Close operations
// ---------------------------------------------------------------------------

/** Click the split button on a card (for splittable components). */
export async function splitCard(
  page: Page,
  cardIndex = 0,
): Promise<void> {
  const card = page.locator("[data-card-id]").nth(cardIndex);
  await card.hover();
  await page.waitForTimeout(300);
  const splitBtn = card.locator('button:has-text("Split"), button[title*="Split"]').first();
  await splitBtn.click();
}

/** Click the close (X) button on a card. */
export async function closeCard(
  page: Page,
  cardIndex = 0,
): Promise<void> {
  const card = page.locator("[data-card-id]").nth(cardIndex);
  await card.hover();
  await page.waitForTimeout(300);
  const closeBtn = card.locator('button:has(svg.lucide-x)').first();
  await closeBtn.click();
}

// ---------------------------------------------------------------------------
// View mode helpers
// ---------------------------------------------------------------------------

/** Switch to freeform mode. */
export async function switchToFreeformMode(page: Page): Promise<void> {
  const btn = page.locator('button[title="Freeform mode - drag & resize freely"]');
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(500);
  }
}

/** Switch to dashboard mode. */
export async function switchToDashboardMode(page: Page): Promise<void> {
  const btn = page.locator('button[title="Dashboard mode - auto-arranged grid"]');
  if (await btn.isVisible().catch(() => false)) {
    await btn.click();
    await page.waitForTimeout(500);
  }
}

// NOTE: logTestFailure is defined in helpers/logging.ts - import it from there.

// ---------------------------------------------------------------------------
// Page setup helper (common beforeEach pattern)
// ---------------------------------------------------------------------------

/**
 * Clear canvas and chat localStorage to prevent state bleed between tests.
 * Call this AFTER page.goto() but BEFORE interacting with the page.
 */
export async function clearCanvasState(page: Page): Promise<void> {
  await page.evaluate(() => {
    // Clear all localStorage EXCEPT Auth0 tokens (keys containing @@auth0spajs@@)
    const keysToRemove: string[] = [];
    for (const key of Object.keys(localStorage)) {
      if (!key.includes("@@auth0spajs@@")) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  });
  await page.reload();
  await page.locator("textarea").waitFor({ state: "visible", timeout: 30_000 });
}

/**
 * Standard page setup for canvas E2E tests.
 * Returns flush function and deploymentId.
 */
export async function setupCanvasTest(
  page: Page,
  testInfo: TestInfo,
  helpers: {
    attachAllLoggers: typeof import("./logging").attachAllLoggers;
    setupAuthIntercept: typeof import("./auth").setupAuthIntercept;
    getTestConfig: typeof import("./logging").getTestConfig;
  },
): Promise<{ flush: () => Promise<void>; deploymentId: string }> {
  const { flush } = helpers.attachAllLoggers(page, testInfo);
  await helpers.setupAuthIntercept(page);

  const config = helpers.getTestConfig();
  const deploymentId = config.deploymentId;

  return { flush, deploymentId };
}
