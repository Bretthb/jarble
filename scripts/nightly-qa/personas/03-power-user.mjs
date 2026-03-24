/**
 * Persona 03: Power User
 * Experienced user testing chat interface, canvas components, conversation history.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runPowerUser({ baseUrl }) {
  const session = new BrowserSession("03-power-user");
  const steps = [];

  try {
    await session.start();

    // Step 1: Load a deployment chat page (using a test/demo path)
    const chatLoadTime = await session.navigate(`${baseUrl}/d/demo`);
    steps.push(
      testStep("Chat page loads", chatLoadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${chatLoadTime}ms` })
    );
    await session.screenshot("chat-page");

    // Step 2: Check for chat input
    const hasChatInput = await session.exists(
      'textarea, input[type="text"], [contenteditable="true"], [role="textbox"]'
    );
    steps.push(
      testStep("Chat input field present", hasChatInput ? TestStatus.PASS : TestStatus.WARN, {
        note: "May require auth to see chat UI",
      })
    );

    // Step 3: Check for chat thread container
    const hasThread = await session.exists(
      '[data-testid="thread"], [role="log"], .aui-thread, [class*="thread"], [class*="chat"], [class*="message"]'
    );
    steps.push(
      testStep("Chat thread container exists", hasThread ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 4: Load homepage and check for deployment links
    await session.navigate(baseUrl);
    const hasDeployLinks = await session.exists('a[href*="/d/"], a[href*="deployment"]');
    steps.push(
      testStep("Deployment links visible", hasDeployLinks ? TestStatus.PASS : TestStatus.SKIP, {
        note: "Requires existing deployments",
      })
    );

    // Step 5: Check conversation history sidebar toggle
    const hasSidebarToggle = await session.exists(
      '[data-testid="conversation-toggle"], button[aria-label*="conversation"], button[aria-label*="history"]'
    );
    steps.push(
      testStep("Conversation history toggle", hasSidebarToggle ? TestStatus.PASS : TestStatus.SKIP, {
        note: "Only visible on chat pages",
      })
    );

    // Step 6: Verify no unhandled JS exceptions
    const pageErrors = session.consoleLogs.filter((l) => l.type === "page_error");
    steps.push(
      testStep(
        "No unhandled JS exceptions",
        pageErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL,
        { count: pageErrors.length, first: pageErrors[0]?.text?.slice(0, 100) }
      )
    );

    // Step 7: Check for canvas area
    await session.navigate(`${baseUrl}/d/demo`);
    const hasCanvas = await session.exists(
      '[data-testid="canvas"], [class*="canvas"], [class*="grid"], .react-flow'
    );
    steps.push(
      testStep("Canvas area present", hasCanvas ? TestStatus.PASS : TestStatus.SKIP, {
        note: "Canvas renders after bot sends UI blocks",
      })
    );
    await session.screenshot("canvas-area");

    // Step 8: Check network request count is reasonable
    const reqCount = session.networkRequests.length;
    steps.push(
      testStep(
        "Network request count reasonable",
        reqCount < 200 ? TestStatus.PASS : TestStatus.WARN,
        { count: reqCount }
      )
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Power User",
    description: "Experienced user testing chat, canvas, and history",
    steps,
    browser: session.getReport(),
  };
}
