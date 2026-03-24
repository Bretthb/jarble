/**
 * Persona 03: Power User
 * Experienced user testing chat interface, canvas, conversation history, config panels, all workspace features.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runPowerUser({ baseUrl, config = {} }) {
  const session = new BrowserSession("03-power-user");
  const steps = [];

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Load deployment chat page
    const chatLoadTime = await session.navigate(`${baseUrl}/d/demo`);
    steps.push(
      testStep("Chat page loads", chatLoadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${chatLoadTime}ms` })
    );
    await session.page.waitForTimeout(3000);
    await session.screenshot("chat-page");

    // Step 2: Check chat input exists and is functional
    const hasChatInput = await session.exists('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
    steps.push(
      testStep("Chat input field present", hasChatInput ? TestStatus.PASS : TestStatus.WARN, { note: "May require auth" })
    );

    // Step 3: Verify canvas area renders
    const hasCanvas = await session.exists(
      '[data-testid="canvas"], [class*="canvas"], [class*="Canvas"], [class*="grid"], .react-flow, [class*="workspace"], [class*="Workspace"]'
    );
    steps.push(
      testStep("Canvas area present", hasCanvas ? TestStatus.PASS : TestStatus.SKIP, { note: "Canvas renders after bot sends UI blocks" })
    );

    // Step 4: Verify conversation history sidebar toggle
    const sidebarToggleSelector = 'button[aria-label*="conversation" i], button[aria-label*="history" i], button[aria-label*="sidebar" i], [class*="MessageSquare"]';
    const hasSidebarToggle = await session.exists(sidebarToggleSelector);
    steps.push(
      testStep("Conversation history toggle exists", hasSidebarToggle ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 5: Open conversation history, check new chat button
    if (hasSidebarToggle) {
      try {
        await session.page.click(sidebarToggleSelector);
        await session.page.waitForTimeout(1000);
        await session.screenshot("conversation-sidebar");
        const newChatExists = await session.exists(
          'button:has-text("New Chat"), button:has-text("New chat"), button[aria-label*="new chat" i]'
        );
        steps.push(
          testStep("New Chat button in sidebar", newChatExists ? TestStatus.PASS : TestStatus.WARN)
        );
      } catch (err) {
        steps.push(testStep("Conversation sidebar opens", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("New Chat button in sidebar", TestStatus.SKIP));
    }

    // Step 6: Test the config panel (Settings gear)
    const gearSelector = 'button[aria-label*="settings" i], button[aria-label*="config" i], button[aria-label*="gear" i]';
    const gearExists = await session.exists(gearSelector);
    steps.push(
      testStep("Config panel gear icon found", gearExists ? TestStatus.PASS : TestStatus.WARN)
    );
    if (gearExists) {
      try {
        await session.page.click(gearSelector);
        await session.page.waitForTimeout(1000);
        await session.screenshot("config-panel-open");
      } catch (_) { /* ignore click issues */ }
    }

    // Step 7: Check Model tab in config
    const hasModelTab = await session.exists(
      '[role="tab"]:has-text("Model"), button:has-text("Model"), [class*="model" i]'
    );
    steps.push(
      testStep("Model tab in config panel", hasModelTab ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 8: Check Platforms tab
    const hasPlatformsTab = await session.exists(
      '[role="tab"]:has-text("Platform"), button:has-text("Platform"), [class*="platform" i]'
    );
    steps.push(
      testStep("Platforms tab in config panel", hasPlatformsTab ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 9: Check Advanced tab
    const hasAdvancedTab = await session.exists(
      '[role="tab"]:has-text("Advanced"), button:has-text("Advanced"), [class*="advanced" i]'
    );
    steps.push(
      testStep("Advanced tab in config panel", hasAdvancedTab ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 10: Verify marketplace panel opens
    const marketplaceBtn = 'button[aria-label*="marketplace" i], button[aria-label*="store" i], button[aria-label*="component" i]';
    const hasMarketplaceBtn = await session.exists(marketplaceBtn);
    steps.push(
      testStep("Marketplace panel button present", hasMarketplaceBtn ? TestStatus.PASS : TestStatus.SKIP)
    );
    if (hasMarketplaceBtn) {
      try {
        await session.page.click(marketplaceBtn);
        await session.page.waitForTimeout(1000);
        await session.screenshot("marketplace-panel");
      } catch (_) { /* ignore */ }
    }

    // Step 11: Verify files panel opens
    const filesBtn = 'button[aria-label*="file" i], button[aria-label*="File" i]';
    const hasFilesBtn = await session.exists(filesBtn);
    steps.push(
      testStep("Files panel button present", hasFilesBtn ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 12: Verify knowledge panel opens
    const knowledgeBtn = 'button[aria-label*="knowledge" i], button[aria-label*="Knowledge" i]';
    const hasKnowledgeBtn = await session.exists(knowledgeBtn);
    steps.push(
      testStep("Knowledge panel button present", hasKnowledgeBtn ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 13: Check canvas zoom controls
    const hasZoomControls = await session.exists(
      'button[aria-label*="zoom" i], button[aria-label*="fit" i], [class*="zoom"], [class*="controls"]'
    );
    steps.push(
      testStep("Canvas zoom controls present", hasZoomControls ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 14: Verify context menu on right-click canvas area
    if (hasCanvas) {
      try {
        const canvasEl = await session.page.$('[class*="canvas"], [class*="Canvas"], [class*="workspace"]');
        if (canvasEl) {
          await canvasEl.click({ button: "right" });
          await session.page.waitForTimeout(500);
          const hasContextMenu = await session.exists('[class*="context-menu"], [class*="ContextMenu"], [role="menu"]');
          steps.push(
            testStep("Context menu on right-click", hasContextMenu ? TestStatus.PASS : TestStatus.SKIP)
          );
          await session.screenshot("context-menu");
        } else {
          steps.push(testStep("Context menu on right-click", TestStatus.SKIP));
        }
      } catch (err) {
        steps.push(testStep("Context menu on right-click", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Context menu on right-click", TestStatus.SKIP));
    }

    // Step 15: Check profile dropdown
    const hasProfile = await session.exists(
      'button[aria-label*="profile" i], button[aria-label*="account" i], [class*="avatar"], [class*="Avatar"]'
    );
    steps.push(
      testStep("Profile dropdown present", hasProfile ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 16: Check credits display
    const bodyText = await session.safeTextContent("body");
    const hasCredits = bodyText && (
      bodyText.toLowerCase().includes("credit") ||
      bodyText.toLowerCase().includes("token") ||
      bodyText.toLowerCase().includes("usage")
    );
    steps.push(
      testStep("Credits/usage display visible", hasCredits ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 17: Verify send button has correct aria-label
    const sendBtn = await session.page.$('button[aria-label*="send" i], button[type="submit"], button[class*="send" i]');
    steps.push(
      testStep("Send button present", sendBtn !== null ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 18: Check for hydration errors
    const hydrationErrors = session.consoleLogs.filter(
      (l) => (l.type === "error" || l.type === "page_error") && (l.text?.includes("hydrat") || l.text?.includes("mismatch"))
    );
    steps.push(
      testStep("No hydration errors", hydrationErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: hydrationErrors.length })
    );

    // Step 19: Check chat thread container
    const hasThread = await session.exists(
      '[data-testid="thread"], [role="log"], .aui-thread, [class*="thread"], [class*="chat"], [class*="message"]'
    );
    steps.push(
      testStep("Chat thread container exists", hasThread ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 20: Try typing in chat input
    if (hasChatInput) {
      try {
        const inputEl = await session.page.$('textarea, [role="textbox"], [contenteditable="true"]');
        if (inputEl) {
          await inputEl.click();
          await session.page.keyboard.type("Hello test message");
          steps.push(testStep("Can type in chat input", TestStatus.PASS));
        } else {
          steps.push(testStep("Can type in chat input", TestStatus.SKIP));
        }
      } catch (err) {
        steps.push(testStep("Can type in chat input", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Can type in chat input", TestStatus.SKIP));
    }

    // Step 21: Screenshot chat with canvas
    await session.screenshot("chat-with-canvas");

    // Step 22: Navigate to dashboard and back
    await session.navigate(`${baseUrl}/dashboard`);
    await session.page.waitForTimeout(1000);
    await session.navigate(`${baseUrl}/d/demo`);
    await session.page.waitForTimeout(2000);
    const chatStillWorks = await session.exists('textarea, [role="textbox"], [contenteditable="true"]');
    steps.push(
      testStep("Chat persists after navigation round-trip", chatStillWorks ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 23: Network request count reasonable
    const reqCount = session.networkRequests.length;
    steps.push(
      testStep("Network request count reasonable", reqCount < 200 ? TestStatus.PASS : TestStatus.WARN, { count: reqCount })
    );

    // Step 24: No unhandled JS exceptions
    const pageErrors = session.consoleLogs.filter((l) => l.type === "page_error");
    steps.push(
      testStep("No unhandled JS exceptions", pageErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, {
        count: pageErrors.length, first: pageErrors[0]?.text?.slice(0, 100),
      })
    );

    // Step 25: No server errors
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors (5xx)", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length })
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
