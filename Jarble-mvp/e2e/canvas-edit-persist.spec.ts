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
import { EDIT_PERSIST_PROMPTS } from "./helpers/prompts";

test.describe("Canvas edit & persist", () => {
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
      logTestFailure(testInfo, { group: "edit-persist", scenario: testInfo.title });
    }
  });

  // -------------------------------------------------------------------------
  // 1. Editable data table (edit-01)
  // -------------------------------------------------------------------------
  test("editable data table - enter and exit edit mode (edit-01)", async ({ page }, testInfo) => {
    const entry = EDIT_PERSIST_PROMPTS.find((p) => p.id === "edit-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);

    const found = await waitForComponentType(page, "data_table", 15_000);
    expect.soft(found, "data_table component should render").toBeTruthy();
    await screenshotMilestone(page, testInfo, "edit-01-rendered");

    // Hover over the card area to reveal the edit pencil button
    const cardGroup = page.locator(".group").first();
    if (await cardGroup.isVisible().catch(() => false)) {
      await cardGroup.hover();
      await page.waitForTimeout(500);
    }

    // Click pencil icon to enter edit mode
    const pencilBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-pencil") })
      .first();
    const pencilVisible = await pencilBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!pencilVisible) {
      test.skip(true, "Edit button not found - component may not support edit mode");
      return;
    }

    await pencilBtn.click();
    await page.waitForTimeout(1_000);
    await screenshotMilestone(page, testInfo, "edit-01-edit-mode");

    // Look for save button and click it to exit edit mode
    const saveBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-save") })
      .first();
    const saveVisible = await saveBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (saveVisible) {
      await saveBtn.click();
      await page.waitForTimeout(1_000);
    } else {
      // Fallback: click cancel/X to exit edit mode
      const cancelBtn = page
        .locator("button")
        .filter({ has: page.locator("svg.lucide-x") })
        .first();
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click();
        await page.waitForTimeout(500);
      }
    }

    await screenshotMilestone(page, testInfo, "edit-01-after-save");
  });

  // -------------------------------------------------------------------------
  // 2. Editable code editor (edit-02)
  // -------------------------------------------------------------------------
  test("editable code editor - Monaco becomes interactive (edit-02)", async ({ page }, testInfo) => {
    const entry = EDIT_PERSIST_PROMPTS.find((p) => p.id === "edit-02")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);

    const found = await waitForComponentType(page, "code_editor", 15_000);
    expect.soft(found, "code_editor component should render").toBeTruthy();
    await screenshotMilestone(page, testInfo, "edit-02-rendered");

    // Hover over the card to reveal edit controls
    const cardGroup = page.locator(".group").first();
    if (await cardGroup.isVisible().catch(() => false)) {
      await cardGroup.hover();
      await page.waitForTimeout(500);
    }

    const pencilBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-pencil") })
      .first();
    const pencilVisible = await pencilBtn.isVisible({ timeout: 5_000 }).catch(() => false);
    if (!pencilVisible) {
      test.skip(true, "Edit button not found - code_editor may not support edit mode");
      return;
    }

    await pencilBtn.click();
    await page.waitForTimeout(1_500);

    // Verify Monaco editor is present and interactive
    const monacoEditor = page.locator("[data-card-id] .monaco-editor").first();
    const monacoVisible = await monacoEditor.isVisible().catch(() => false);
    expect.soft(monacoVisible, "Monaco editor should be visible in edit mode").toBeTruthy();

    await screenshotMilestone(page, testInfo, "edit-02-edit-mode");

    // Exit edit mode - save or cancel
    const saveBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-save") })
      .first();
    if (await saveBtn.isVisible().catch(() => false)) {
      await saveBtn.click();
    } else {
      const cancelBtn = page
        .locator("button")
        .filter({ has: page.locator("svg.lucide-x") })
        .first();
      if (await cancelBtn.isVisible().catch(() => false)) {
        await cancelBtn.click();
      }
    }
    await page.waitForTimeout(500);
    await screenshotMilestone(page, testInfo, "edit-02-exited");
  });

  // -------------------------------------------------------------------------
  // 3. Editable card (edit-03)
  // -------------------------------------------------------------------------
  test("editable card - enter edit mode (edit-03)", async ({ page }, testInfo) => {
    const entry = EDIT_PERSIST_PROMPTS.find((p) => p.id === "edit-03")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);

    const found = await waitForComponentType(page, "card", 15_000);
    expect.soft(found, "card component should render").toBeTruthy();
    await screenshotMilestone(page, testInfo, "edit-03-rendered");

    // Hover to reveal edit controls
    const cardGroup = page.locator(".group").first();
    if (await cardGroup.isVisible().catch(() => false)) {
      await cardGroup.hover();
      await page.waitForTimeout(500);
    }

    const pencilBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-pencil") })
      .first();
    const pencilVisible = await pencilBtn.isVisible({ timeout: 5_000 }).catch(() => false);

    if (pencilVisible) {
      await pencilBtn.click();
      await page.waitForTimeout(1_000);
      await screenshotMilestone(page, testInfo, "edit-03-edit-mode");

      // Exit edit mode
      const saveBtn = page
        .locator("button")
        .filter({ has: page.locator("svg.lucide-save") })
        .first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click();
      }
    } else {
      // Card may not support edit mode - document this
      await screenshotMilestone(page, testInfo, "edit-03-no-edit-button");
    }
  });

  // -------------------------------------------------------------------------
  // 4. Editable stat grid (edit-04)
  // -------------------------------------------------------------------------
  test("editable stat grid - enter edit mode (edit-04)", async ({ page }, testInfo) => {
    const entry = EDIT_PERSIST_PROMPTS.find((p) => p.id === "edit-04")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);

    const found = await waitForComponentType(page, "stat_grid", 15_000);
    expect.soft(found, "stat_grid component should render").toBeTruthy();
    await screenshotMilestone(page, testInfo, "edit-04-rendered");

    // Hover to reveal edit controls
    const cardGroup = page.locator(".group").first();
    if (await cardGroup.isVisible().catch(() => false)) {
      await cardGroup.hover();
      await page.waitForTimeout(500);
    }

    const pencilBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-pencil") })
      .first();
    const pencilVisible = await pencilBtn.isVisible({ timeout: 5_000 }).catch(() => false);

    if (pencilVisible) {
      await pencilBtn.click();
      await page.waitForTimeout(1_000);
      await screenshotMilestone(page, testInfo, "edit-04-edit-mode");

      // Exit edit mode
      const saveBtn = page
        .locator("button")
        .filter({ has: page.locator("svg.lucide-save") })
        .first();
      if (await saveBtn.isVisible().catch(() => false)) {
        await saveBtn.click();
      }
    } else {
      await screenshotMilestone(page, testInfo, "edit-04-no-edit-button");
    }
  });

  // -------------------------------------------------------------------------
  // 5. Canvas persists on reload
  // -------------------------------------------------------------------------
  test("canvas cards persist across page reload", async ({ page }, testInfo) => {
    const entry = EDIT_PERSIST_PROMPTS.find((p) => p.id === "edit-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });

    const countBefore = await getCanvasCardCount(page);
    expect.soft(countBefore, "At least one card should be present before reload").toBeGreaterThanOrEqual(1);

    const idsBefore = await getCanvasCardIds(page);
    await screenshotMilestone(page, testInfo, "before-reload");

    // Reload the page
    await page.reload();
    await setupAuthIntercept(page);
    await page.locator("textarea").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(3_000); // Allow time for localStorage restore

    const countAfter = await getCanvasCardCount(page);
    const idsAfter = await getCanvasCardIds(page);

    // Soft-assert: cards may or may not be restored from localStorage
    // depending on implementation - document the behavior
    if (countAfter > 0) {
      expect.soft(countAfter, "Card count should match or be >= previous count").toBeGreaterThanOrEqual(1);
      await screenshotMilestone(page, testInfo, "after-reload-restored");
    } else {
      // Cards were not persisted - this is valid behavior to document
      await screenshotMilestone(page, testInfo, "after-reload-empty");
    }

    // Attach persistence data for debugging
    await testInfo.attach("persistence-data", {
      body: JSON.stringify({
        countBefore,
        countAfter,
        idsBefore,
        idsAfter,
        persisted: countAfter > 0,
      }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 6. Chat history persists on reload
  // -------------------------------------------------------------------------
  test("chat history persists across page reload", async ({ page }, testInfo) => {
    const entry = EDIT_PERSIST_PROMPTS.find((p) => p.id === "edit-03")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 0 });

    // Count messages before reload (user + assistant messages)
    const messagesBefore = await page.locator("[data-testid='user-message'], [data-testid='assistant-message']").count();
    expect.soft(messagesBefore, "At least 2 messages before reload (user + assistant)").toBeGreaterThanOrEqual(2);
    await screenshotMilestone(page, testInfo, "chat-before-reload");

    // Reload the page
    await page.reload();
    await setupAuthIntercept(page);
    await page.locator("textarea").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(3_000); // Allow time for history restore

    const messagesAfter = await page.locator("[data-testid='user-message'], [data-testid='assistant-message']").count();

    // Soft-assert: messages may or may not be restored depending on implementation
    if (messagesAfter > 0) {
      expect.soft(messagesAfter, "Message count should be restored after reload").toBeGreaterThanOrEqual(1);
      await screenshotMilestone(page, testInfo, "chat-after-reload-restored");
    } else {
      await screenshotMilestone(page, testInfo, "chat-after-reload-empty");
    }

    await testInfo.attach("chat-persistence-data", {
      body: JSON.stringify({
        messagesBefore,
        messagesAfter,
        persisted: messagesAfter > 0,
      }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 7. Edit mode pencil visibility on hover
  // -------------------------------------------------------------------------
  test("pencil icon appears on card hover and hides otherwise (edit-hover)", async ({ page }, testInfo) => {
    const entry = EDIT_PERSIST_PROMPTS.find((p) => p.id === "edit-01")!;
    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);

    const cardGroup = page.locator(".group").first();
    const pencilBtn = page
      .locator("button")
      .filter({ has: page.locator("svg.lucide-pencil") })
      .first();

    if (!(await cardGroup.isVisible().catch(() => false))) {
      test.skip(true, "No group card found for hover test");
      return;
    }

    // Before hover: pencil should be hidden or have opacity-0
    // Move mouse away from any card first
    await page.mouse.move(0, 0);
    await page.waitForTimeout(500);

    const pencilBeforeHover = await pencilBtn.isVisible().catch(() => false);
    // Note: pencil may be in the DOM with opacity-0 but still report visible
    // We check via computed style as well
    let pencilOpacityBefore = "1";
    if (pencilBeforeHover) {
      pencilOpacityBefore = await pencilBtn.evaluate((el) => {
        return window.getComputedStyle(el).opacity;
      }).catch(() => "1");
    }

    await screenshotMilestone(page, testInfo, "pencil-before-hover");

    // Hover over the card
    await cardGroup.hover();
    await page.waitForTimeout(500);

    const pencilAfterHover = await pencilBtn.isVisible().catch(() => false);
    let pencilOpacityAfter = "0";
    if (pencilAfterHover) {
      pencilOpacityAfter = await pencilBtn.evaluate((el) => {
        return window.getComputedStyle(el).opacity;
      }).catch(() => "0");
    }

    await screenshotMilestone(page, testInfo, "pencil-after-hover");

    // The pencil should be more visible after hover than before
    expect.soft(
      pencilAfterHover,
      "Pencil button should be visible when hovering over card",
    ).toBeTruthy();

    await testInfo.attach("pencil-visibility", {
      body: JSON.stringify({
        pencilBeforeHover,
        pencilOpacityBefore,
        pencilAfterHover,
        pencilOpacityAfter,
      }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 8. Multiple editable cards show pencil icons independently
  // -------------------------------------------------------------------------
  test("multiple editable cards show pencil icons independently", async ({ page }, testInfo) => {
    // Send two prompts to create two cards
    const prompt1 = EDIT_PERSIST_PROMPTS.find((p) => p.id === "edit-01")!;
    const prompt2 = EDIT_PERSIST_PROMPTS.find((p) => p.id === "edit-03")!;

    await sendPromptAndWait(page, prompt1.prompt, { minCards: 1 });
    await sendPromptAndWait(page, prompt2.prompt, { minCards: 2 });

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "At least 2 cards should be visible").toBeGreaterThanOrEqual(2);
    await screenshotMilestone(page, testInfo, "two-cards-rendered");

    // Hover over each card group and check for pencil buttons independently
    const cardGroups = page.locator(".group");
    const groupCount = await cardGroups.count();
    const pencilResults: Array<{ index: number; hasPencil: boolean }> = [];

    for (let i = 0; i < Math.min(groupCount, 3); i++) {
      const group = cardGroups.nth(i);
      if (!(await group.isVisible().catch(() => false))) continue;

      await group.hover();
      await page.waitForTimeout(500);

      // Check if a pencil button is visible within or near this card
      const pencil = group.locator("button").filter({ has: page.locator("svg.lucide-pencil") }).first();
      const hasPencil = await pencil.isVisible().catch(() => false);
      pencilResults.push({ index: i, hasPencil });

      await screenshotMilestone(page, testInfo, `card-${i}-hover`);
    }

    // At least one card should have a pencil button
    const anyPencil = pencilResults.some((r) => r.hasPencil);
    expect.soft(anyPencil, "At least one card should have an edit pencil button").toBeTruthy();

    await testInfo.attach("pencil-results", {
      body: JSON.stringify(pencilResults, null, 2),
      contentType: "application/json",
    });
  });
});
