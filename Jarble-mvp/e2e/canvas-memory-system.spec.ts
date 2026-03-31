import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
  getTestConfig,
  logTestFailure,
} from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";
import { sendPromptAndWait, clearCanvasState } from "./helpers/canvas";
import { MEMORY_PROMPTS } from "./helpers/prompts";

test.describe("Canvas memory system", () => {
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
      logTestFailure(testInfo, { group: "memory", scenario: testInfo.title });
    }
  });

  // -----------------------------------------------------------------------
  // Sequential conversation test - all 8 memory prompts in order
  // Must run as a single test to maintain conversation context.
  // -----------------------------------------------------------------------
  test("sequential memory: store, recall, overwrite, and list facts", async ({ page }, testInfo) => {
    test.setTimeout(540_000); // 9 sequential prompts need ~9 minutes
    // Helper to get the last assistant message text
    async function getLastBotMessage(): Promise<string> {
      const messages = page.locator('[data-testid="assistant-message"]');
      const count = await messages.count();
      if (count === 0) return "";
      const last = messages.nth(count - 1);
      return (await last.textContent()) || "";
    }

    // ---------------------------------------------------------------
    // memory-01: Store "favorite language is TypeScript"
    // ---------------------------------------------------------------
    const mem01 = MEMORY_PROMPTS.find((p) => p.id === "memory-01")!;
    await sendPromptAndWait(page, mem01.prompt);
    await screenshotMilestone(page, testInfo, "memory-01-store");

    const ack01 = await getLastBotMessage();
    expect.soft(
      ack01.length > 0,
      "Bot should acknowledge memory-01 (store TypeScript)",
    ).toBeTruthy();

    // ---------------------------------------------------------------
    // memory-02: Recall "What is my favorite language?"
    // ---------------------------------------------------------------
    const mem02 = MEMORY_PROMPTS.find((p) => p.id === "memory-02")!;
    await sendPromptAndWait(page, mem02.prompt);
    await screenshotMilestone(page, testInfo, "memory-02-recall");

    const recall02 = await getLastBotMessage();
    expect.soft(
      /typescript/i.test(recall02),
      `Bot should mention "TypeScript" in recall - got: "${recall02.slice(0, 200)}"`,
    ).toBeTruthy();

    // ---------------------------------------------------------------
    // memory-03: Store complex fact (team info)
    // ---------------------------------------------------------------
    const mem03 = MEMORY_PROMPTS.find((p) => p.id === "memory-03")!;
    await sendPromptAndWait(page, mem03.prompt);
    await screenshotMilestone(page, testInfo, "memory-03-store-team");

    const ack03 = await getLastBotMessage();
    expect.soft(
      ack03.length > 0,
      "Bot should acknowledge memory-03 (store team info)",
    ).toBeTruthy();

    // ---------------------------------------------------------------
    // memory-04: Recall team info
    // ---------------------------------------------------------------
    const mem04 = MEMORY_PROMPTS.find((p) => p.id === "memory-04")!;
    await sendPromptAndWait(page, mem04.prompt);
    await screenshotMilestone(page, testInfo, "memory-04-recall-team");

    const recall04 = await getLastBotMessage();
    const mentionsTeam =
      /platform\s*engineering/i.test(recall04) || /12/i.test(recall04);
    expect.soft(
      mentionsTeam,
      `Bot should mention "Platform Engineering" or "12" - got: "${recall04.slice(0, 200)}"`,
    ).toBeTruthy();

    // ---------------------------------------------------------------
    // memory-05: Store deadline fact
    // ---------------------------------------------------------------
    const mem05 = MEMORY_PROMPTS.find((p) => p.id === "memory-05")!;
    await sendPromptAndWait(page, mem05.prompt);
    await screenshotMilestone(page, testInfo, "memory-05-store-deadline");

    const ack05 = await getLastBotMessage();
    expect.soft(
      ack05.length > 0,
      "Bot should acknowledge memory-05 (store deadline)",
    ).toBeTruthy();

    // ---------------------------------------------------------------
    // memory-06: Recall all facts
    // ---------------------------------------------------------------
    const mem06 = MEMORY_PROMPTS.find((p) => p.id === "memory-06")!;
    await sendPromptAndWait(page, mem06.prompt);
    await screenshotMilestone(page, testInfo, "memory-06-recall-all");

    const recallAll = await getLastBotMessage();
    // Should mention at least some of the stored facts
    const mentionsLanguage = /typescript/i.test(recallAll);
    const mentionsTeamOrDeadline =
      /platform\s*engineering/i.test(recallAll) ||
      /12/i.test(recallAll) ||
      /march/i.test(recallAll) ||
      /deadline/i.test(recallAll);

    expect.soft(
      mentionsLanguage || mentionsTeamOrDeadline,
      `Bot should recall multiple facts - got: "${recallAll.slice(0, 300)}"`,
    ).toBeTruthy();

    // ---------------------------------------------------------------
    // memory-07: Overwrite - language changed to Rust
    // ---------------------------------------------------------------
    const mem07 = MEMORY_PROMPTS.find((p) => p.id === "memory-07")!;
    await sendPromptAndWait(page, mem07.prompt);
    await screenshotMilestone(page, testInfo, "memory-07-overwrite");

    const ack07 = await getLastBotMessage();
    expect.soft(
      ack07.length > 0,
      "Bot should acknowledge memory-07 (overwrite to Rust)",
    ).toBeTruthy();

    // ---------------------------------------------------------------
    // memory-08: Recall updated fact - should say Rust
    // ---------------------------------------------------------------
    const mem08 = MEMORY_PROMPTS.find((p) => p.id === "memory-08")!;
    await sendPromptAndWait(page, mem08.prompt);
    await screenshotMilestone(page, testInfo, "memory-08-recall-updated");

    const recallUpdated = await getLastBotMessage();
    expect.soft(
      /rust/i.test(recallUpdated),
      `Bot should mention "Rust" after overwrite - got: "${recallUpdated.slice(0, 200)}"`,
    ).toBeTruthy();
  });
});
