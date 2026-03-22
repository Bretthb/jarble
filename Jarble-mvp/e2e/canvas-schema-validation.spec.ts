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
import { SCHEMA_VALIDATION_PROMPTS } from "./helpers/prompts";

test.describe("Canvas schema validation & autoFix", () => {
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
      logTestFailure(testInfo, { group: "schema-validation", scenario: testInfo.title });
    }
  });

  // -------------------------------------------------------------------------
  // 1. String-to-number coercion (schema-01)
  // -------------------------------------------------------------------------
  test("progress bar renders with string value coerced to number (schema-01)", async ({ page }, testInfo) => {
    const entry = SCHEMA_VALIDATION_PROMPTS.find((p) => p.id === "schema-01")!;

    // Capture console messages to check for autoFix breadcrumbs
    const consoleMessages: string[] = [];
    page.on("console", (msg) => consoleMessages.push(msg.text()));

    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "schema-01-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render after string-to-number coercion").toBeGreaterThanOrEqual(1);

    // Progress bar should render (autoFix coerces '75' string to 75 number)
    const foundProgress = await waitForComponentType(page, "progress", 10_000);
    expect.soft(foundProgress, "Progress bar should render after autoFix coercion").toBeTruthy();

    // Check console for autoFix breadcrumbs
    const fixLogs = consoleMessages.filter(
      (m) => m.includes("autoFix") || m.includes("repair") || m.includes("coerce"),
    );
    await testInfo.attach("autofix-logs", {
      body: JSON.stringify({ fixLogCount: fixLogs.length, fixLogs: fixLogs.slice(0, 10) }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 2. Enum normalization — capital 'Bar' to 'bar' (schema-02)
  // -------------------------------------------------------------------------
  test("chart renders with capitalized type normalized (schema-02)", async ({ page }, testInfo) => {
    const entry = SCHEMA_VALIDATION_PROMPTS.find((p) => p.id === "schema-02")!;

    const consoleMessages: string[] = [];
    page.on("console", (msg) => consoleMessages.push(msg.text()));

    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "schema-02-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render after enum normalization").toBeGreaterThanOrEqual(1);

    // Chart should render (autoFix normalizes 'Bar' to 'bar')
    const foundChart = await waitForComponentType(page, "chart", 10_000);
    expect.soft(foundChart, "Chart should render after autoFix enum normalization").toBeTruthy();

    const fixLogs = consoleMessages.filter(
      (m) => m.includes("autoFix") || m.includes("repair") || m.includes("normalize"),
    );
    await testInfo.attach("autofix-logs", {
      body: JSON.stringify({ fixLogCount: fixLogs.length, fixLogs: fixLogs.slice(0, 10) }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 3. Component name alias — info_card -> card (schema-03)
  // -------------------------------------------------------------------------
  test("card renders via component name alias (schema-03)", async ({ page }, testInfo) => {
    const entry = SCHEMA_VALIDATION_PROMPTS.find((p) => p.id === "schema-03")!;

    const consoleMessages: string[] = [];
    page.on("console", (msg) => consoleMessages.push(msg.text()));

    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "schema-03-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render via alias resolution").toBeGreaterThanOrEqual(1);

    // Card component should render (autoFix resolves 'info_card' alias)
    const foundCard = await waitForComponentType(page, "card", 10_000);
    expect.soft(foundCard, "Card component should render after alias resolution").toBeTruthy();

    const fixLogs = consoleMessages.filter(
      (m) => m.includes("autoFix") || m.includes("repair") || m.includes("alias"),
    );
    await testInfo.attach("autofix-logs", {
      body: JSON.stringify({ fixLogCount: fixLogs.length, fixLogs: fixLogs.slice(0, 10) }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 4. Canvas -> sandbox alias (schema-04)
  // -------------------------------------------------------------------------
  test("sandbox renders via canvas alias (schema-04)", async ({ page }, testInfo) => {
    const entry = SCHEMA_VALIDATION_PROMPTS.find((p) => p.id === "schema-04")!;

    const consoleMessages: string[] = [];
    page.on("console", (msg) => consoleMessages.push(msg.text()));

    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "schema-04-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render after canvas -> sandbox alias").toBeGreaterThanOrEqual(1);

    // Sandbox should render (autoFix resolves 'canvas' alias to 'sandbox')
    const foundSandbox = await waitForComponentType(page, "sandbox", 10_000);
    expect.soft(foundSandbox, "Sandbox iframe should render via canvas alias").toBeTruthy();

    if (foundSandbox) {
      const iframe = page.locator("[data-card-id] iframe").first();
      const hasIframe = await iframe.isVisible().catch(() => false);
      expect.soft(hasIframe, "Sandbox iframe element should be visible").toBeTruthy();
    }

    const fixLogs = consoleMessages.filter(
      (m) => m.includes("autoFix") || m.includes("repair") || m.includes("alias") || m.includes("canvas"),
    );
    await testInfo.attach("autofix-logs", {
      body: JSON.stringify({ fixLogCount: fixLogs.length, fixLogs: fixLogs.slice(0, 10) }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 5. Field alias — title -> label in stat grid (schema-05)
  // -------------------------------------------------------------------------
  test("stat grid renders with title->label field alias (schema-05)", async ({ page }, testInfo) => {
    const entry = SCHEMA_VALIDATION_PROMPTS.find((p) => p.id === "schema-05")!;

    const consoleMessages: string[] = [];
    page.on("console", (msg) => consoleMessages.push(msg.text()));

    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "schema-05-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render after field alias fix").toBeGreaterThanOrEqual(1);

    // Stat grid should render with correct labels
    const foundStatGrid = await waitForComponentType(page, "stat_grid", 10_000);
    expect.soft(foundStatGrid, "Stat grid should render after field alias fix").toBeTruthy();

    if (foundStatGrid) {
      // Verify stat labels are visible (not empty)
      const cardText = await page.locator("[data-card-id]").first().textContent() ?? "";
      expect.soft(cardText.length, "Stat grid should have visible label text").toBeGreaterThan(0);
    }

    const fixLogs = consoleMessages.filter(
      (m) => m.includes("autoFix") || m.includes("repair") || m.includes("title") || m.includes("label"),
    );
    await testInfo.attach("autofix-logs", {
      body: JSON.stringify({ fixLogCount: fixLogs.length, fixLogs: fixLogs.slice(0, 10) }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 6. Table -> data_table alias (schema-06)
  // -------------------------------------------------------------------------
  test("data_table renders via table alias (schema-06)", async ({ page }, testInfo) => {
    const entry = SCHEMA_VALIDATION_PROMPTS.find((p) => p.id === "schema-06")!;

    const consoleMessages: string[] = [];
    page.on("console", (msg) => consoleMessages.push(msg.text()));

    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "schema-06-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render via table alias").toBeGreaterThanOrEqual(1);

    // Data table should render (autoFix resolves 'table' to 'data_table')
    const foundTable = await waitForComponentType(page, "data_table", 10_000);
    expect.soft(foundTable, "Data table should render after table alias resolution").toBeTruthy();

    if (foundTable) {
      const tableEl = page.locator("[data-card-id] table").first();
      const hasTable = await tableEl.isVisible().catch(() => false);
      expect.soft(hasTable, "HTML <table> element should be visible").toBeTruthy();
    }

    const fixLogs = consoleMessages.filter(
      (m) => m.includes("autoFix") || m.includes("repair") || m.includes("alias") || m.includes("table"),
    );
    await testInfo.attach("autofix-logs", {
      body: JSON.stringify({ fixLogCount: fixLogs.length, fixLogs: fixLogs.slice(0, 10) }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 7. Chart data shape fix — flat array to objects (schema-07)
  // -------------------------------------------------------------------------
  test("chart renders with flat array data converted to objects (schema-07)", async ({ page }, testInfo) => {
    const entry = SCHEMA_VALIDATION_PROMPTS.find((p) => p.id === "schema-07")!;

    const consoleMessages: string[] = [];
    page.on("console", (msg) => consoleMessages.push(msg.text()));

    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "schema-07-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render after chart data shape fix").toBeGreaterThanOrEqual(1);

    // Chart should render (autoFix converts flat array [10,20,30] to [{value:10},...])
    const foundChart = await waitForComponentType(page, "chart", 10_000);
    expect.soft(foundChart, "Chart should render after data shape autoFix").toBeTruthy();

    if (foundChart) {
      // Verify recharts SVG is present
      const rechartsSvg = page.locator("[data-card-id] svg.recharts-surface").first();
      const hasSvg = await rechartsSvg.isVisible().catch(() => false);
      expect.soft(hasSvg, "Recharts SVG should be rendered").toBeTruthy();
    }

    const fixLogs = consoleMessages.filter(
      (m) => m.includes("autoFix") || m.includes("repair") || m.includes("data") || m.includes("shape"),
    );
    await testInfo.attach("autofix-logs", {
      body: JSON.stringify({ fixLogCount: fixLogs.length, fixLogs: fixLogs.slice(0, 10) }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 8. Duplicate field handling — body + content (schema-08)
  // -------------------------------------------------------------------------
  test("card renders with duplicate body/content fields handled (schema-08)", async ({ page }, testInfo) => {
    const entry = SCHEMA_VALIDATION_PROMPTS.find((p) => p.id === "schema-08")!;

    const consoleMessages: string[] = [];
    page.on("console", (msg) => consoleMessages.push(msg.text()));

    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "schema-08-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render after duplicate field handling").toBeGreaterThanOrEqual(1);

    // Card should render (autoFix handles duplicate body/content fields)
    const foundCard = await waitForComponentType(page, "card", 10_000);
    expect.soft(foundCard, "Card should render after duplicate field handling").toBeTruthy();

    if (foundCard) {
      const cardText = await page.locator("[data-card-id]").first().textContent() ?? "";
      expect.soft(cardText.length, "Card should have visible text content").toBeGreaterThan(0);
    }

    const fixLogs = consoleMessages.filter(
      (m) => m.includes("autoFix") || m.includes("repair") || m.includes("duplicate"),
    );
    await testInfo.attach("autofix-logs", {
      body: JSON.stringify({ fixLogCount: fixLogs.length, fixLogs: fixLogs.slice(0, 10) }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 9. Single item -> array coercion (schema-09)
  // -------------------------------------------------------------------------
  test("stat grid renders with single stat wrapped in array (schema-09)", async ({ page }, testInfo) => {
    const entry = SCHEMA_VALIDATION_PROMPTS.find((p) => p.id === "schema-09")!;

    const consoleMessages: string[] = [];
    page.on("console", (msg) => consoleMessages.push(msg.text()));

    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "schema-09-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render after array coercion").toBeGreaterThanOrEqual(1);

    // Stat grid should render (autoFix wraps single object in array)
    const foundStatGrid = await waitForComponentType(page, "stat_grid", 10_000);
    expect.soft(foundStatGrid, "Stat grid should render after single→array coercion").toBeTruthy();

    const fixLogs = consoleMessages.filter(
      (m) => m.includes("autoFix") || m.includes("repair") || m.includes("array") || m.includes("wrap"),
    );
    await testInfo.attach("autofix-logs", {
      body: JSON.stringify({ fixLogCount: fixLogs.length, fixLogs: fixLogs.slice(0, 10) }, null, 2),
      contentType: "application/json",
    });
  });

  // -------------------------------------------------------------------------
  // 10. Button text -> label alias (schema-10)
  // -------------------------------------------------------------------------
  test("button group renders with text->label field alias (schema-10)", async ({ page }, testInfo) => {
    const entry = SCHEMA_VALIDATION_PROMPTS.find((p) => p.id === "schema-10")!;

    const consoleMessages: string[] = [];
    page.on("console", (msg) => consoleMessages.push(msg.text()));

    await sendPromptAndWait(page, entry.prompt, { minCards: 1 });
    await assertNoErrorCards(page);
    await screenshotMilestone(page, testInfo, "schema-10-result");

    const cardCount = await getCanvasCardCount(page);
    expect.soft(cardCount, "Card should render after button text alias").toBeGreaterThanOrEqual(1);

    // Button group should render (autoFix maps 'text' field to 'label')
    const foundButtons = await waitForComponentType(page, "button_group", 10_000);
    expect.soft(foundButtons, "Button group should render after text→label alias").toBeTruthy();

    if (foundButtons) {
      // Verify buttons have visible text labels
      const buttons = page.locator("[data-card-id] button:not([type='submit'])");
      const buttonCount = await buttons.count();
      expect.soft(buttonCount, "At least one button should be visible").toBeGreaterThanOrEqual(1);

      if (buttonCount > 0) {
        const firstButtonText = await buttons.first().textContent() ?? "";
        expect.soft(firstButtonText.length, "Button should have visible label text").toBeGreaterThan(0);
      }
    }

    const fixLogs = consoleMessages.filter(
      (m) => m.includes("autoFix") || m.includes("repair") || m.includes("text") || m.includes("label"),
    );
    await testInfo.attach("autofix-logs", {
      body: JSON.stringify({ fixLogCount: fixLogs.length, fixLogs: fixLogs.slice(0, 10) }, null, 2),
      contentType: "application/json",
    });
  });
});
