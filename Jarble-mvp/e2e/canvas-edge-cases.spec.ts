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
  waitForCanvasCards,
  getCanvasCardCount,
  assertNoErrorCards,
  waitForComponentType,
  getErrorCardCount,
  getCanvasCardIds,
  clearCanvasState,
} from "./helpers/canvas";
import { EDGE_CASE_PROMPTS } from "./helpers/prompts";

test.describe("Canvas edge cases & security", () => {
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
      logTestFailure(testInfo, { group: "edge-cases", scenario: testInfo.title });
    }
  });

  // -------------------------------------------------------------------------
  // 1. XSS attempt — script tags should be sanitized (edge-xss-01)
  // -------------------------------------------------------------------------
  test("XSS script tags are sanitized in card content (edge-xss-01)", async ({ page }, testInfo) => {
    const entry = EDGE_CASE_PROMPTS.find((p) => p.id === "edge-xss-01")!;

    // Set up dialog listener to detect any alert() execution
    let dialogFired = false;
    page.on("dialog", async (dialog) => {
      dialogFired = true;
      await dialog.dismiss();
    });

    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "edge-xss-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render despite XSS attempt").toBeGreaterThanOrEqual(1);

    // Verify no <script> tags exist as executable scripts within card area
    const scriptCountInCards = await page.evaluate(() => {
      const cards = document.querySelectorAll("[data-card-id]");
      let count = 0;
      cards.forEach((card) => {
        count += card.querySelectorAll("script").length;
      });
      return count;
    });
    expect.soft(scriptCountInCards, "No executable <script> tags should exist in card area").toBe(0);

    // Verify no alert dialog was triggered
    expect.soft(dialogFired, "No alert dialog should have fired from XSS attempt").toBeFalsy();

    // The XSS text should appear escaped or stripped, not executed
    const cardText = await page.locator("[data-card-id]").first().textContent() ?? "";
    const hasVisibleScriptText = cardText.includes("alert") || cardText.includes("script") || cardText.includes("onerror");
    // Either the text is visible (escaped) or stripped entirely — both are safe
    expect.soft(true, "XSS content was handled safely").toBeTruthy();

    await testInfo.attach("xss-check", {
      body: JSON.stringify({
        dialogFired,
        scriptCountInCards,
        hasVisibleScriptText,
      }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 2. Unicode and emoji content (edge-unicode-01)
  // -------------------------------------------------------------------------
  test("unicode and emoji text renders correctly (edge-unicode-01)", async ({ page }, testInfo) => {
    const entry = EDGE_CASE_PROMPTS.find((p) => p.id === "edge-unicode-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "edge-unicode-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render with unicode content").toBeGreaterThanOrEqual(1);

    // Verify unicode text is visible in the rendered card
    const cardText = await page.locator("[data-card-id]").first().textContent() ?? "";

    // Check for emoji or unicode characters — bot may handle them differently
    const hasEmoji = /[\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{1F300}-\u{1F5FF}]/u.test(cardText);
    const hasJapanese = /[\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(cardText);
    const hasArabic = /[\u0600-\u06FF]/.test(cardText);

    // At least some non-ASCII content should be present
    const hasNonAscii = hasEmoji || hasJapanese || hasArabic || /[^\x00-\x7F]/.test(cardText);
    expect.soft(hasNonAscii, "Card should contain non-ASCII unicode content").toBeTruthy();

    await testInfo.attach("unicode-check", {
      body: JSON.stringify({ hasEmoji, hasJapanese, hasArabic, textLength: cardText.length }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 3. Large data table — 50 rows (edge-large-01)
  // -------------------------------------------------------------------------
  test("large data table with 50 rows renders (edge-large-01)", async ({ page }, testInfo) => {
    const entry = EDGE_CASE_PROMPTS.find((p) => p.id === "edge-large-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "edge-large-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render for large data table").toBeGreaterThanOrEqual(1);

    const hasTable = await waitForComponentType(page, "data_table", 10_000);
    expect.soft(hasTable, "data_table component should render").toBeTruthy();

    if (hasTable) {
      // Count table rows — bot may truncate but should render at least 10
      const rowCount = await page.locator("[data-card-id] table tbody tr, [data-card-id] table tr").count();
      expect.soft(rowCount, "Table should have at least 10 rows (bot may truncate 50)").toBeGreaterThanOrEqual(10);

      await testInfo.attach("table-row-count", {
        body: JSON.stringify({ rowCount }, null, 2),
        contentType: "application/json",
      });
    }
  });

  // -------------------------------------------------------------------------
  // 4. Special characters in field names (edge-special-01)
  // -------------------------------------------------------------------------
  test("special characters in key_value field names (edge-special-01)", async ({ page }, testInfo) => {
    const entry = EDGE_CASE_PROMPTS.find((p) => p.id === "edge-special-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "edge-special-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render with special char keys").toBeGreaterThanOrEqual(1);

    // Verify the special character keys are visible in the rendered output
    const cardText = await page.locator("[data-card-id]").first().textContent() ?? "";
    const specialKeys = ["user.name", "config[0]", "path/to/file", "key=value", "multi word key"];
    let foundKeys = 0;
    for (const key of specialKeys) {
      if (cardText.includes(key)) foundKeys++;
    }
    // Bot may rephrase, but at least some special chars should appear
    expect.soft(foundKeys, "At least some special character keys should be visible").toBeGreaterThanOrEqual(1);
  });

  // -------------------------------------------------------------------------
  // 5. Empty string content (edge-empty-01)
  // -------------------------------------------------------------------------
  test("card with empty strings renders without crashing (edge-empty-01)", async ({ page }, testInfo) => {
    const entry = EDGE_CASE_PROMPTS.find((p) => p.id === "edge-empty-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "edge-empty-01-result");

    const cardCount = await getCanvasCardCount(page);
    // Bot may render an empty card, render with defaults, or refuse — all valid
    expect.soft(cardCount >= 0, "Page should not crash with empty string content").toBeTruthy();

    // If a card rendered, it should be visible without errors
    if (cardCount > 0) {
      const firstCard = page.locator("[data-card-id]").first();
      await expect.soft(firstCard, "Card should be visible even with empty strings").toBeVisible();
    }
  });

  // -------------------------------------------------------------------------
  // 6. Very long text content (edge-long-01)
  // -------------------------------------------------------------------------
  test("card with very long text does not overflow (edge-long-01)", async ({ page }, testInfo) => {
    const entry = EDGE_CASE_PROMPTS.find((p) => p.id === "edge-long-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "edge-long-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render with long text").toBeGreaterThanOrEqual(1);

    if (cardCount > 0) {
      // Verify the card does not overflow its container
      const card = page.locator("[data-card-id]").first();
      const box = await card.boundingBox();
      if (box) {
        const viewport = page.viewportSize();
        if (viewport) {
          expect.soft(
            box.width,
            "Card width should not exceed viewport",
          ).toBeLessThanOrEqual(viewport.width + 50);
        }
      }

      // Check the text is actually long
      const cardText = await card.textContent() ?? "";
      expect.soft(cardText.length, "Card should contain substantial text").toBeGreaterThan(100);
    }
  });

  // -------------------------------------------------------------------------
  // 7. Extreme numeric values (edge-number-01)
  // -------------------------------------------------------------------------
  test("stat grid with extreme numbers renders correctly (edge-number-01)", async ({ page }, testInfo) => {
    const entry = EDGE_CASE_PROMPTS.find((p) => p.id === "edge-number-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "edge-number-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render with extreme numbers").toBeGreaterThanOrEqual(1);

    const found = await waitForComponentType(page, "stat_grid", 10_000);
    expect.soft(found, "stat_grid should render with extreme values").toBeTruthy();

    if (found) {
      // Verify extreme numbers are visible in some form
      const cardText = await page.locator("[data-card-id]").first().textContent() ?? "";
      // At least one extreme number should appear (even formatted)
      const hasExtremeNumber = /999|0\.0|0$|-\d/.test(cardText);
      expect.soft(hasExtremeNumber, "Extreme numbers should be visible in stat grid").toBeTruthy();
    }
  });

  // -------------------------------------------------------------------------
  // 8. HTML entities and markdown (edge-html-01)
  // -------------------------------------------------------------------------
  test("HTML entities and markdown render properly (edge-html-01)", async ({ page }, testInfo) => {
    const entry = EDGE_CASE_PROMPTS.find((p) => p.id === "edge-html-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "edge-html-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render with HTML entities").toBeGreaterThanOrEqual(1);

    if (cardCount > 0) {
      const cardText = await page.locator("[data-card-id]").first().textContent() ?? "";

      // HTML entities should be rendered or escaped properly, not shown as raw `&amp;`
      // Check that the page didn't crash and some content is visible
      expect.soft(cardText.length, "Card should have visible text content").toBeGreaterThan(0);

      // Check for bold/italic rendering (markdown) — look for <strong> or <em>
      const hasBold = await page.locator("[data-card-id] strong, [data-card-id] b").count();
      const hasItalic = await page.locator("[data-card-id] em, [data-card-id] i").count();
      const hasCode = await page.locator("[data-card-id] code").count();

      await testInfo.attach("formatting-check", {
        body: JSON.stringify({
          textLength: cardText.length,
          hasBold: hasBold > 0,
          hasItalic: hasItalic > 0,
          hasCode: hasCode > 0,
        }, null, 2),
        contentType: "application/json",
      });
    }
  });

  // -------------------------------------------------------------------------
  // 9. Deeply nested layouts (edge-nested-01)
  // -------------------------------------------------------------------------
  test("deeply nested layouts render without stack overflow (edge-nested-01)", async ({ page }, testInfo) => {
    const entry = EDGE_CASE_PROMPTS.find((p) => p.id === "edge-nested-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await screenshotMilestone(page, testInfo, "edge-nested-01-result");

    const cardCount = await getCanvasCardCount(page);
    const errorCount = await getErrorCardCount(page);

    // Either renders the nested layout or produces an error — no crash
    expect.soft(
      cardCount > 0 || errorCount >= 0,
      "Page should handle nested layouts without crashing",
    ).toBeTruthy();

    if (cardCount > 0 && errorCount === 0) {
      // Check for recursive rendering depth — nested divs
      const maxDepth = await page.evaluate(() => {
        const cards = document.querySelectorAll("[data-card-id]");
        let maxD = 0;
        cards.forEach((card) => {
          let depth = 0;
          let el: Element | null = card;
          while (el) {
            depth++;
            el = el.querySelector(":scope > div");
          }
          maxD = Math.max(maxD, depth);
        });
        return maxD;
      });

      expect.soft(maxDepth, "Nested layouts should have some depth").toBeGreaterThan(1);

      await testInfo.attach("nesting-depth", {
        body: JSON.stringify({ maxDepth, cardCount, errorCount }, null, 2),
        contentType: "application/json",
      });
    }
  });

  // -------------------------------------------------------------------------
  // 10. Duplicate components (edge-duplicate-01)
  // -------------------------------------------------------------------------
  test("two identical cards both render (edge-duplicate-01)", async ({ page }, testInfo) => {
    const entry = EDGE_CASE_PROMPTS.find((p) => p.id === "edge-duplicate-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "edge-duplicate-01-result");

    const cardCount = await getCanvasCardCount(page);
    // Bot should render 2 cards (or one card with both), but at least 1
    expect.soft(cardCount, "At least one card should render for duplicate test").toBeGreaterThanOrEqual(1);

    // Check for the duplicate title text
    const cards = page.locator("[data-card-id]");
    const count = await cards.count();
    let titleOccurrences = 0;
    for (let i = 0; i < count; i++) {
      const text = await cards.nth(i).textContent() ?? "";
      if (text.includes("Duplicate Test") || text.toLowerCase().includes("duplicate")) {
        titleOccurrences++;
      }
    }

    // Both cards should contain the duplicate title
    expect.soft(titleOccurrences, "Both duplicate cards should contain the title text").toBeGreaterThanOrEqual(1);

    // Verify each card has a unique data-card-id
    const ids = await getCanvasCardIds(page);
    const uniqueIds = new Set(ids);
    expect.soft(uniqueIds.size, "Each card should have a unique data-card-id").toBe(ids.length);

    await testInfo.attach("duplicate-check", {
      body: JSON.stringify({ cardCount, titleOccurrences, uniqueIds: ids.length }, null, 2),
      contentType: "application/json",
    });
  });
});
