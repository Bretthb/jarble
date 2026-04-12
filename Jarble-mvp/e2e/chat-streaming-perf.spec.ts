import { test, expect } from "@playwright/test";
import {
  attachAllLoggers,
  screenshotMilestone,
  waitForBotResponse,
  logTestFailure,
} from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";
import { clearCanvasState, waitForBotReady } from "./helpers/canvas";

// ---------------------------------------------------------------------------
// JAR-63: SSE streaming performance + thinking UI visibility assertions.
//
// These tests pin three things the plan calls for:
//   1. Time-to-first-token (TTFT) — time from submit click to the first
//      non-empty assistant-message character appearing in the DOM.
//   2. Reasoning visibility — the "Thinking..." block must appear during
//      the wait, not only at the end of the response.
//   3. Stream cleanliness — after the response completes, the spinner is
//      gone and the textarea is re-enabled (no stuck state).
//
// Run against a live dev deployment. Thresholds are tuned conservatively
// so they catch real regressions without failing on cold-pod warmups.
// Tighten after we have a baseline in CI.
// ---------------------------------------------------------------------------

// Reuse the same live deployment used by chat-live.spec.ts
const DEPLOYMENT_ID = "3vt3ej3hj1oi"; // test1

// TTFT budget — generous because it includes LLM cold-start. Tighten
// once we have dashboards to track the distribution.
const TTFT_BUDGET_MS = 8_000;

// Reasoning must become visible within this window from submit.
const REASONING_VISIBLE_WITHIN_MS = 8_000;

test.describe("Chat streaming perf + thinking visibility (JAR-63)", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    ({ flush } = attachAllLoggers(page, testInfo));
    await setupAuthIntercept(page);
    await page.goto(`/d/${DEPLOYMENT_ID}`);
    await clearCanvasState(page);
    await waitForBotReady(page, 30_000);
  });

  test.afterEach(async ({}, testInfo) => {
    await flush();
    if (testInfo.status === "failed") {
      logTestFailure(testInfo, {
        group: "chat-streaming-perf",
        scenario: testInfo.title,
      });
    }
  });

  test("time-to-first-token is within budget", async ({ page }, testInfo) => {
    const textarea = page.locator("textarea");
    await textarea.fill("Say hello in one short sentence.");

    // Stamp the submit click so we can measure TTFT from that exact moment.
    const submitAtMs = Date.now();
    await page.locator('button[type="submit"]').click();

    // Wait until the first assistant-message element contains at least one
    // non-whitespace character. This is the earliest visible render point
    // the user perceives as "the bot started replying".
    const assistantMsg = page.locator('[data-testid="assistant-message"]').first();
    await assistantMsg.waitFor({ state: "attached", timeout: TTFT_BUDGET_MS });
    await expect
      .poll(
        async () => {
          const text = (await assistantMsg.textContent().catch(() => "")) ?? "";
          return text.replace(/\s/g, "").length > 0;
        },
        { timeout: TTFT_BUDGET_MS, intervals: [50, 100, 200] },
      )
      .toBe(true);

    const ttftMs = Date.now() - submitAtMs;
    testInfo.annotations.push({
      type: "perf",
      description: `TTFT=${ttftMs}ms (budget=${TTFT_BUDGET_MS}ms)`,
    });

    // Soft expectation so we get the metric recorded even when it
    // overshoots — prevents flake from gating merges during baseline tuning.
    expect.soft(ttftMs, `TTFT should be under ${TTFT_BUDGET_MS}ms`).toBeLessThan(TTFT_BUDGET_MS);

    // Hard ceiling — anything over 30s is a real regression.
    expect(ttftMs).toBeLessThan(30_000);

    // Let the stream finish so afterEach cleanup runs cleanly.
    await waitForBotResponse(page, 60_000);

    await screenshotMilestone(page, testInfo, "ttft-measured");
  });

  test("thinking indicator appears during response generation", async ({ page }, testInfo) => {
    const textarea = page.locator("textarea");
    // Prompt that reliably triggers either native thinking (Anthropic /
    // OpenClaw --thinking medium), inline <think> tags, or the
    // generateReasoning() GPT-4o-mini fallback. All three paths emit
    // REASONING_START which drives the "Thinking..." label.
    await textarea.fill("Think step by step about what 12 multiplied by 17 is, then give the final answer.");

    const submitAtMs = Date.now();
    await page.locator('button[type="submit"]').click();

    // The ReasoningPartRenderer shows "Thinking..." while the reasoning
    // stream is running. It auto-expands on first delta.
    const thinkingLabel = page.getByText("Thinking...", { exact: true });
    await expect(thinkingLabel).toBeVisible({ timeout: REASONING_VISIBLE_WITHIN_MS });

    const visibleAtMs = Date.now() - submitAtMs;
    testInfo.annotations.push({
      type: "perf",
      description: `thinking visible at ${visibleAtMs}ms`,
    });

    await screenshotMilestone(page, testInfo, "thinking-visible");

    // Once the full response is done the label flips to "Thought process".
    await waitForBotResponse(page, 90_000);

    const thoughtProcessLabel = page.getByText("Thought process", { exact: true });
    await expect(thoughtProcessLabel).toBeVisible({ timeout: 10_000 });

    await screenshotMilestone(page, testInfo, "thought-process-final");
  });

  test("stream ends cleanly — no stuck spinner, textarea re-enabled", async ({ page }, testInfo) => {
    const textarea = page.locator("textarea");
    await textarea.fill("Reply with just the word 'ok'.");

    await page.locator('button[type="submit"]').click();

    // Wait for the stream to finish
    await waitForBotResponse(page, 60_000);

    // Spinner should be gone
    const spinner = page.locator('button[type="submit"] svg.animate-spin');
    await expect(spinner).toHaveCount(0, { timeout: 10_000 });

    // Textarea should be enabled again
    await expect(textarea).toBeEnabled({ timeout: 5_000 });

    // Assistant message should contain text
    const assistantMsg = page.locator('[data-testid="assistant-message"]').first();
    const body = await assistantMsg.textContent();
    expect(body?.trim().length ?? 0).toBeGreaterThan(0);

    await screenshotMilestone(page, testInfo, "stream-ended-clean");
  });
});
