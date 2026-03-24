/**
 * Persona 17: Conversation Manager
 * Tests conversation history features — sidebar toggle, new chat, conversation switching, localStorage.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runConversationManager({ baseUrl }) {
  const session = new BrowserSession("17-conversation-manager");
  const steps = [];

  try {
    await session.start();

    // Step 1: Navigate to a deployment chat page
    const loadTime = await session.navigate(`${baseUrl}/d/test`);
    steps.push(
      testStep(
        "Deployment chat page loads",
        loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN,
        { loadTime: `${loadTime}ms` }
      )
    );
    await session.screenshot("conversation-manager-landing");

    // Step 2: Look for the conversation history sidebar toggle
    const sidebarToggleSelector = 'button[aria-label*="conversation" i], button[aria-label*="history" i], button[aria-label*="sidebar" i], [class*="MessageSquare"], svg[class*="lucide-message-square"]';
    const toggleExists = await session.exists(sidebarToggleSelector);
    steps.push(
      testStep(
        "Conversation history sidebar toggle exists",
        toggleExists ? TestStatus.PASS : TestStatus.WARN,
        { note: "Searched for conversation/history/sidebar toggle" }
      )
    );

    // Step 3: Open the sidebar and screenshot
    if (toggleExists) {
      try {
        await session.page.click(sidebarToggleSelector);
        await session.page.waitForTimeout(1000);
        steps.push(testStep("Conversation sidebar opens", TestStatus.PASS));
        await session.screenshot("conversation-sidebar-open");
      } catch (err) {
        steps.push(testStep("Conversation sidebar opens", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Conversation sidebar opens", TestStatus.SKIP, { note: "Toggle not found" }));
    }

    // Step 4: Check "New Chat" button exists
    const newChatSelector = 'button:has-text("New Chat"), button:has-text("New chat"), button:has-text("new chat"), button[aria-label*="new chat" i], [class*="new-chat"], [class*="NewChat"]';
    const newChatExists = await session.exists(newChatSelector);
    steps.push(
      testStep(
        "New Chat button exists",
        newChatExists ? TestStatus.PASS : TestStatus.WARN,
        { note: "Searched for New Chat button" }
      )
    );

    // Step 5: Check conversation list renders
    const convListSelector = '[class*="conversation-list"], [class*="ConversationList"], [class*="history-list"], [class*="HistoryList"], [class*="conversation"] li, ul[class*="conversation"]';
    const convListExists = await session.exists(convListSelector);
    steps.push(
      testStep(
        "Conversation list renders",
        convListExists ? TestStatus.PASS : TestStatus.WARN,
        { note: "Checked for conversation list element" }
      )
    );

    // Step 6: Verify conversation switching UI
    const convItemSelector = '[class*="conversation-item"], [class*="ConversationItem"], [class*="history-item"], [class*="HistoryItem"], [class*="conversation"] button, [class*="conversation"] a';
    const convItemExists = await session.exists(convItemSelector);
    steps.push(
      testStep(
        "Conversation switching UI present",
        convItemExists ? TestStatus.PASS : TestStatus.WARN,
        { note: "Checked for clickable conversation items" }
      )
    );

    // Step 7: Check localStorage keys for conversation data
    const storageInfo = await session.page.evaluate(() => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && (key.includes("jarble-conv") || key.includes("jarble-chat") || key.includes("conversation"))) {
          keys.push(key);
        }
      }
      return { matchingKeys: keys, totalKeys: localStorage.length };
    });
    steps.push(
      testStep(
        "localStorage conversation keys checked",
        TestStatus.PASS,
        { matchingKeys: storageInfo.matchingKeys.length, totalKeys: storageInfo.totalKeys }
      )
    );

    // Step 8: Screenshot conversation sidebar in different states
    // Try clicking "New Chat" to see the state change
    if (newChatExists) {
      try {
        await session.page.click(newChatSelector);
        await session.page.waitForTimeout(1000);
        await session.screenshot("conversation-after-new-chat");
        steps.push(testStep("New Chat button clickable", TestStatus.PASS));
      } catch (err) {
        steps.push(testStep("New Chat button clickable", TestStatus.WARN, { error: err.message }));
      }
    }

    // Step 9: Verify no console errors
    const pageErrors = session.consoleLogs.filter(
      (l) => l.type === "error" || l.type === "page_error"
    );
    steps.push(
      testStep(
        "No console errors on conversation features",
        pageErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN,
        { errorCount: pageErrors.length }
      )
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Conversation Manager",
    description: "Tests conversation history features — sidebar, new chat, switching, localStorage",
    steps,
    browser: session.getReport(),
  };
}
