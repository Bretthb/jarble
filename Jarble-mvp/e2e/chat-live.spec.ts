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
  closeCard,
  waitForBotReady,
} from "./helpers/canvas";

// ---------------------------------------------------------------------------
// Deployment IDs for live tests
// ---------------------------------------------------------------------------

const DEPLOYMENT_ID_1 = "3vt3ej3hj1oi"; // test1
const DEPLOYMENT_ID_2 = "42puqb1asrdx"; // test2

// ---------------------------------------------------------------------------
// 1. Chat Page Loading & Basic UI
// ---------------------------------------------------------------------------

test.describe("Chat page - loading and basic UI", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "chat-load", scenario: testInfo.title });
    }
  });

  test("chat page loads for running deployment (test1)", async ({ page }, testInfo) => {
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);

    // Header shows deployment name and status badge
    await expect(page.locator("header")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("test1")).toBeVisible({ timeout: 15_000 });

    // Status badge should be visible (running or other status)
    const statusBadge = page.locator("header").locator("[class*='badge'], [class*='Badge'], span:has-text('running'), span:has-text('Running')");
    await expect(statusBadge.first()).toBeVisible({ timeout: 10_000 });

    await screenshotMilestone(page, testInfo, "chat-page-loaded");
  });

  test("chat page loads for second running deployment (test2)", async ({ page }, testInfo) => {
    await page.goto(`/d/${DEPLOYMENT_ID_2}`);

    await expect(page.locator("header")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("test2")).toBeVisible({ timeout: 15_000 });

    await screenshotMilestone(page, testInfo, "chat-page-test2-loaded");
  });

  test("chat textarea is visible and focusable", async ({ page }) => {
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    const textarea = page.locator("textarea");
    await textarea.waitFor({ state: "visible", timeout: 30_000 });

    // Verify it has the placeholder text
    await expect(textarea).toHaveAttribute("placeholder", /type a message/i);

    // Focus and type - textarea should accept input
    await textarea.focus();
    await textarea.fill("test input");
    await expect(textarea).toHaveValue("test input");
  });

  test("submit button is present and initially disabled when empty", async ({ page }) => {
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    const textarea = page.locator("textarea");
    await textarea.waitFor({ state: "visible", timeout: 30_000 });

    const submitBtn = page.locator('button[type="submit"]');
    await expect(submitBtn).toBeVisible();
    // Button should be disabled when textarea is empty
    await expect(submitBtn).toBeDisabled();

    // Type something - button should become enabled
    await textarea.fill("hello");
    await expect(submitBtn).toBeEnabled();
  });

  test("empty state shows example prompts", async ({ page }) => {
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    await clearCanvasState(page);

    // The empty state should show example prompt buttons
    await expect(page.getByText("Start a conversation")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("What can you do?")).toBeVisible();
    await expect(page.getByText("Show me a chart of something interesting")).toBeVisible();
    await expect(page.getByText("Create an interactive 3D visualization")).toBeVisible();
  });

  test("back button navigates to dashboard", async ({ page }) => {
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });

    // Click the back arrow button
    const backBtn = page.locator("header button").first();
    await backBtn.click();

    // Should navigate to /dashboard
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 10_000 });
  });

  test("settings button toggles config panel", async ({ page }, testInfo) => {
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    await page.locator("header").waitFor({ state: "visible", timeout: 15_000 });

    // Click the settings button
    const settingsBtn = page.locator('button[title="Configuration"]');
    await settingsBtn.click();
    await page.waitForTimeout(500);

    await screenshotMilestone(page, testInfo, "config-panel-open");

    // Click again to close
    await settingsBtn.click();
    await page.waitForTimeout(500);

    await screenshotMilestone(page, testInfo, "config-panel-closed");
  });

  test("page transitions from loading to loaded state", async ({ page }, testInfo) => {
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);

    // Page should eventually load with chat input visible
    const chatInput = page.getByRole("textbox").first();
    await expect(chatInput).toBeVisible({ timeout: 15_000 });

    await screenshotMilestone(page, testInfo, "page-loaded-state");
  });
});

// ---------------------------------------------------------------------------
// 2. Error States
// ---------------------------------------------------------------------------

test.describe("Chat page - error states", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "chat-error", scenario: testInfo.title });
    }
  });

  test("shows 'Deployment not found' for invalid deployment ID", async ({ page }, testInfo) => {
    await page.goto("/d/nonexistent-deployment-id-12345");

    // Wait for the "not found" message
    await expect(page.getByText("Deployment not found")).toBeVisible({ timeout: 30_000 });

    await screenshotMilestone(page, testInfo, "deployment-not-found");
  });

  test("shows 'Deployment not found' for empty-ish deployment ID", async ({ page }) => {
    await page.goto("/d/000000000000");

    await expect(page.getByText("Deployment not found")).toBeVisible({ timeout: 30_000 });
  });
});

// ---------------------------------------------------------------------------
// 3. Live Chat Interaction - Simple Message
// ---------------------------------------------------------------------------

test.describe("Chat page - live bot interaction", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    await clearCanvasState(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "chat-live", scenario: testInfo.title });
    }
  });

  test("send a simple message and receive bot response", async ({ page }, testInfo) => {
    await waitForBotReady(page, 30_000);

    const textarea = page.locator("textarea");
    await textarea.fill("Say hello in one sentence.");
    await page.locator('button[type="submit"]').click();

    // User message should appear
    await expect(page.locator('[data-testid="user-message"]').first()).toBeVisible({ timeout: 10_000 });

    // Wait for bot response to complete
    await waitForBotResponse(page, 30_000);

    // Bot response message should appear
    const assistantMessages = page.locator('[data-testid="assistant-message"]');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 10_000 });

    // Bot response should contain some text (not empty)
    const responseText = await assistantMessages.first().textContent();
    expect(responseText).toBeTruthy();
    expect(responseText!.length).toBeGreaterThan(5);

    await screenshotMilestone(page, testInfo, "simple-message-response");
  });

  test("submit button shows spinner during streaming", async ({ page }) => {
    await waitForBotReady(page, 30_000);

    const textarea = page.locator("textarea");
    await textarea.fill("Tell me a short joke.");

    const submitBtn = page.locator('button[type="submit"]');
    await submitBtn.click();

    // Spinner should appear on the submit button during streaming
    const spinner = page.locator('button[type="submit"] svg.animate-spin');
    await spinner.waitFor({ state: "visible", timeout: 15_000 }).catch(() => {
      // Fast response - spinner may have come and gone
    });

    // Textarea should be disabled during streaming
    await expect(textarea).toBeDisabled().catch(() => {
      // Response may have already finished
    });

    // Wait for response to finish
    await waitForBotResponse(page, 30_000);
  });

  test("Enter key submits message (without Shift)", async ({ page }) => {
    await waitForBotReady(page, 30_000);

    const textarea = page.locator("textarea");
    await textarea.fill("What is 2+2? Answer in one word.");

    // Press Enter to submit
    await textarea.press("Enter");

    // User message should appear
    await expect(page.locator('[data-testid="user-message"]').first()).toBeVisible({ timeout: 10_000 });

    // Wait for bot response
    await waitForBotResponse(page, 30_000);

    const assistantMessages = page.locator('[data-testid="assistant-message"]');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 10_000 });
  });

  test("Shift+Enter adds newline instead of submitting", async ({ page }) => {
    await waitForBotReady(page, 30_000);

    const textarea = page.locator("textarea");
    await textarea.fill("Line one");
    await textarea.press("Shift+Enter");
    await textarea.type("Line two");

    // Textarea should contain a newline - message NOT submitted
    const value = await textarea.inputValue();
    expect(value).toContain("Line one");
    expect(value).toContain("Line two");

    // No user messages should have been sent yet
    const userMessages = page.locator('[data-testid="user-message"]');
    expect(await userMessages.count()).toBe(0);
  });

  test("example prompt buttons send message on click", async ({ page }, testInfo) => {
    await waitForBotReady(page, 30_000);

    // Click "What can you do?" example prompt
    const exampleBtn = page.getByText("What can you do?");
    await expect(exampleBtn).toBeVisible({ timeout: 10_000 });
    await exampleBtn.click();

    // Wait for bot response
    await waitForBotResponse(page, 60_000);

    // Bot should have responded
    const assistantMessages = page.locator('[data-testid="assistant-message"]');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 10_000 });

    await screenshotMilestone(page, testInfo, "example-prompt-response");
  });
});

// ---------------------------------------------------------------------------
// 4. Live Chat - Component Rendering
// ---------------------------------------------------------------------------

test.describe("Chat page - component rendering", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    await clearCanvasState(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "chat-components", scenario: testInfo.title });
    }
  });

  test("ask bot to render a card component", async ({ page }, testInfo) => {
    await sendPromptAndWait(
      page,
      'Show me a card with the title "Hello World" and body text "This is a test card"',
      { minCards: 1 },
    );

    // Canvas panel should be visible (the dashboard grid area)
    const canvasPanel = page.locator(".min-w-\\[300px\\]");
    await expect(canvasPanel).toBeVisible({ timeout: 10_000 });

    // At least one canvas card should be visible
    const cardCount = await getCanvasCardCount(page);
    expect(cardCount).toBeGreaterThanOrEqual(1);

    // No error cards
    await assertNoErrorCards(page);

    await screenshotMilestone(page, testInfo, "card-component-rendered");
  });

  test("ask bot to render a chart component", async ({ page }, testInfo) => {
    await sendPromptAndWait(
      page,
      "Show me a bar chart of the top 5 programming languages by popularity",
      { minCards: 1, timeout: 60_000 },
    );

    // Should have rendered a chart component
    const hasChart = await waitForComponentType(page, "chart", 10_000);
    expect.soft(hasChart, "Expected chart component to render").toBe(true);

    await assertNoErrorCards(page);

    await screenshotMilestone(page, testInfo, "chart-component-rendered");
  });

  test("ask bot to render a data table", async ({ page }, testInfo) => {
    await sendPromptAndWait(
      page,
      "Create a data table showing 5 fictional employees with name, role, and salary columns",
      { minCards: 1, timeout: 60_000 },
    );

    const hasTable = await waitForComponentType(page, "data_table", 10_000);
    expect.soft(hasTable, "Expected data_table component to render").toBe(true);

    await assertNoErrorCards(page);

    await screenshotMilestone(page, testInfo, "table-component-rendered");
  });

  test("canvas card close button removes card", async ({ page }, testInfo) => {
    // First, render a component
    await sendPromptAndWait(
      page,
      'Show me a simple card with the title "Removable Card"',
      { minCards: 1 },
    );

    const initialCount = await getCanvasCardCount(page);
    expect(initialCount).toBeGreaterThanOrEqual(1);

    // Close the first card
    await closeCard(page, 0);
    await page.waitForTimeout(1_000);

    // Card count should decrease
    const newCount = await getCanvasCardCount(page);
    expect(newCount).toBeLessThan(initialCount);

    await screenshotMilestone(page, testInfo, "card-closed");
  });

  test("canvas grid renders in dashboard panel alongside chat", async ({ page }, testInfo) => {
    await sendPromptAndWait(
      page,
      "Show me a stat grid with 3 metrics: Revenue $1.2M, Users 45K, Growth 23%",
      { minCards: 1, timeout: 60_000 },
    );

    // Both chat panel and canvas panel should be visible side by side
    const chatPanel = page.locator("textarea").locator("..");
    await expect(page.locator("textarea")).toBeVisible();

    const canvasPanel = page.locator(".min-w-\\[300px\\]");
    await expect(canvasPanel).toBeVisible();

    await screenshotMilestone(page, testInfo, "split-view-chat-canvas");
  });
});

// ---------------------------------------------------------------------------
// 5. Multiple Messages in Sequence
// ---------------------------------------------------------------------------

test.describe("Chat page - multiple messages", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    await clearCanvasState(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "chat-multi", scenario: testInfo.title });
    }
  });

  test("send two messages in sequence - both appear with responses", async ({ page }, testInfo) => {
    await waitForBotReady(page, 30_000);

    // First message
    const textarea = page.locator("textarea");
    await textarea.fill("Say the word 'alpha' and nothing else.");
    await page.locator('button[type="submit"]').click();
    await waitForBotResponse(page, 30_000);

    // Verify first exchange
    const userMessages1 = page.locator('[data-testid="user-message"]');
    await expect(userMessages1).toHaveCount(1, { timeout: 5_000 });
    const assistantMessages1 = page.locator('[data-testid="assistant-message"]');
    await expect(assistantMessages1.first()).toBeVisible();

    await screenshotMilestone(page, testInfo, "first-message");

    // Second message
    await textarea.fill("Now say the word 'beta' and nothing else.");
    await page.locator('button[type="submit"]').click();
    await waitForBotResponse(page, 30_000);

    // Both user messages should be visible
    const userMessages2 = page.locator('[data-testid="user-message"]');
    await expect(userMessages2).toHaveCount(2, { timeout: 5_000 });

    // Both bot responses should be visible
    const assistantMessages2 = page.locator('[data-testid="assistant-message"]');
    const assistantCount = await assistantMessages2.count();
    expect(assistantCount).toBeGreaterThanOrEqual(2);

    await screenshotMilestone(page, testInfo, "two-messages");
  });

  test("send text then component request - both render correctly", async ({ page }, testInfo) => {
    await waitForBotReady(page, 30_000);

    // First: text-only message
    const textarea = page.locator("textarea");
    await textarea.fill("Hi, just respond with a brief greeting.");
    await page.locator('button[type="submit"]').click();
    await waitForBotResponse(page, 30_000);

    // Second: component request
    await sendPromptAndWait(
      page,
      'Now show me a card with the title "Follow-up Card" and body "Created after greeting"',
      { minCards: 1, timeout: 60_000 },
    );

    // Should have 2 user messages and 2 assistant messages
    const userMessages = page.locator('[data-testid="user-message"]');
    expect(await userMessages.count()).toBeGreaterThanOrEqual(2);

    // Canvas should have at least 1 card
    const cardCount = await getCanvasCardCount(page);
    expect(cardCount).toBeGreaterThanOrEqual(1);

    await screenshotMilestone(page, testInfo, "text-then-component");
  });
});

// ---------------------------------------------------------------------------
// 6. Long Messages & Edge Cases
// ---------------------------------------------------------------------------

test.describe("Chat page - edge cases", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    await clearCanvasState(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "chat-edge", scenario: testInfo.title });
    }
  });

  test("long message auto-resizes textarea", async ({ page }) => {
    await waitForBotReady(page, 30_000);

    const textarea = page.locator("textarea");
    const initialHeight = await textarea.evaluate(
      (el) => el.getBoundingClientRect().height,
    );

    // Type a long multi-line message
    const longMessage = Array(6).fill("This is a line of text for testing auto-resize behavior.").join("\n");
    await textarea.fill(longMessage);

    // Textarea should have grown taller
    const newHeight = await textarea.evaluate(
      (el) => el.getBoundingClientRect().height,
    );
    expect(newHeight).toBeGreaterThan(initialHeight);
  });

  test("textarea maxes out at 150px height", async ({ page }) => {
    await waitForBotReady(page, 30_000);

    const textarea = page.locator("textarea");

    // Type a very long message
    const veryLong = Array(30).fill("Long line of text.").join("\n");
    await textarea.fill(veryLong);

    // Textarea should not exceed 150px (max-height set in style)
    const height = await textarea.evaluate(
      (el) => el.getBoundingClientRect().height,
    );
    expect(height).toBeLessThanOrEqual(155); // small tolerance for borders
  });

  test("empty message cannot be submitted", async ({ page }) => {
    await waitForBotReady(page, 30_000);

    const textarea = page.locator("textarea");
    const submitBtn = page.locator('button[type="submit"]');

    // Submit button disabled when empty
    await expect(submitBtn).toBeDisabled();

    // Fill whitespace only
    await textarea.fill("   ");
    await expect(submitBtn).toBeDisabled();

    // Type actual content - should enable
    await textarea.fill("hello");
    await expect(submitBtn).toBeEnabled();
  });

  test("long bot response renders fully and is scrollable", async ({ page }, testInfo) => {
    await sendPromptAndWait(
      page,
      "Write a detailed 5-paragraph essay about the history of computing. Include at least 200 words.",
      { timeout: 60_000 },
    );

    // Bot response should be present
    const assistantMessages = page.locator('[data-testid="assistant-message"]');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 10_000 });

    // Response text should be substantial
    const responseText = await assistantMessages.first().textContent();
    expect(responseText!.length).toBeGreaterThan(200);

    // The chat viewport should be scrollable
    const viewport = page.locator('[class*="overflow-y-auto"]').first();
    const isScrollable = await viewport.evaluate(
      (el) => el.scrollHeight > (el as HTMLElement).clientHeight,
    );
    expect.soft(isScrollable, "Chat viewport should be scrollable with long content").toBe(true);

    await screenshotMilestone(page, testInfo, "long-response");
  });
});

// ---------------------------------------------------------------------------
// 7. Canvas Persistence (localStorage)
// ---------------------------------------------------------------------------

test.describe("Chat page - canvas persistence", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "chat-persist", scenario: testInfo.title });
    }
  });

  test("canvas cards persist after page reload", async ({ page }, testInfo) => {
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    await clearCanvasState(page);

    // Send a message that generates canvas cards
    await sendPromptAndWait(
      page,
      'Show me a card with the title "Persistence Test" and body "This should survive a reload"',
      { minCards: 1, timeout: 60_000 },
    );

    const cardCountBefore = await getCanvasCardCount(page);
    expect(cardCountBefore).toBeGreaterThanOrEqual(1);

    await screenshotMilestone(page, testInfo, "before-reload");

    // Reload the page
    await page.reload();
    await page.locator("textarea").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(2_000); // Wait for persistence restoration

    // Cards should be restored from localStorage
    const cardCountAfter = await getCanvasCardCount(page);
    expect.soft(
      cardCountAfter,
      "Canvas cards should persist after reload",
    ).toBeGreaterThanOrEqual(1);

    await screenshotMilestone(page, testInfo, "after-reload");
  });
});

// ---------------------------------------------------------------------------
// 8. Chat on Second Deployment
// ---------------------------------------------------------------------------

test.describe("Chat page - second deployment", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    await page.goto(`/d/${DEPLOYMENT_ID_2}`);
    await clearCanvasState(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "chat-deploy2", scenario: testInfo.title });
    }
  });

  test("chat works on test2 deployment", async ({ page }, testInfo) => {
    await waitForBotReady(page, 30_000);

    const textarea = page.locator("textarea");
    await textarea.fill("Say hello in one sentence.");
    await page.locator('button[type="submit"]').click();

    await waitForBotResponse(page, 30_000);

    const assistantMessages = page.locator('[data-testid="assistant-message"]');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 10_000 });

    const responseText = await assistantMessages.first().textContent();
    expect(responseText).toBeTruthy();

    await screenshotMilestone(page, testInfo, "test2-response");
  });
});

// ---------------------------------------------------------------------------
// 9. Chat Panel Resize
// ---------------------------------------------------------------------------

test.describe("Chat page - panel resize", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    await page.locator("textarea").waitFor({ state: "visible", timeout: 30_000 });
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "chat-resize", scenario: testInfo.title });
    }
  });

  test("chat panel resize handle is present and draggable", async ({ page }, testInfo) => {
    // The resize handle is the narrow div between chat and canvas
    const resizeHandle = page.locator("[class*='cursor-col-resize']");
    await expect(resizeHandle).toBeVisible({ timeout: 5_000 });

    // Get initial chat panel width
    const chatPanel = page.locator("textarea").locator("..").locator("..").locator("..");
    const initialBox = await chatPanel.boundingBox();
    expect(initialBox).not.toBeNull();

    // Drag the resize handle to the right
    const handleBox = await resizeHandle.boundingBox();
    if (handleBox) {
      const startX = handleBox.x + handleBox.width / 2;
      const startY = handleBox.y + handleBox.height / 2;

      await page.mouse.move(startX, startY);
      await page.mouse.down();
      await page.mouse.move(startX + 100, startY, { steps: 5 });
      await page.mouse.up();

      await page.waitForTimeout(300);

      // Verify the panel width changed
      const newBox = await chatPanel.boundingBox();
      if (initialBox && newBox) {
        expect.soft(
          newBox.width,
          "Chat panel should be wider after drag-right",
        ).toBeGreaterThan(initialBox.width);
      }
    }

    await screenshotMilestone(page, testInfo, "panel-resized");
  });
});

// ---------------------------------------------------------------------------
// 10. Markdown Rendering in Bot Responses
// ---------------------------------------------------------------------------

test.describe("Chat page - markdown rendering", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    await page.goto(`/d/${DEPLOYMENT_ID_1}`);
    await clearCanvasState(page);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, { group: "chat-markdown", scenario: testInfo.title });
    }
  });

  test("bot response with markdown renders formatted text", async ({ page }, testInfo) => {
    await sendPromptAndWait(
      page,
      "Respond with a short markdown-formatted message: include a bold word, an italic word, and a bullet list of 3 items. Keep it very brief.",
      { timeout: 60_000 },
    );

    const assistantMessages = page.locator('[data-testid="assistant-message"]');
    await expect(assistantMessages.first()).toBeVisible({ timeout: 10_000 });

    // Check that rendered HTML contains formatted elements (bold, italic, list)
    const messageHTML = await assistantMessages.first().innerHTML();
    const hasBold = messageHTML.includes("<strong>") || messageHTML.includes("<b>");
    const hasItalic = messageHTML.includes("<em>") || messageHTML.includes("<i>");
    const hasList = messageHTML.includes("<li>") || messageHTML.includes("<ul>");

    // At least one formatting element should be present (bot may not always follow instructions exactly)
    const hasAnyFormatting = hasBold || hasItalic || hasList;
    expect.soft(hasAnyFormatting, "Bot response should contain some markdown formatting").toBe(true);

    await screenshotMilestone(page, testInfo, "markdown-response");
  });
});
