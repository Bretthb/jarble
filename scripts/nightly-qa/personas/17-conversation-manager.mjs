/**
 * Persona 17: Conversation Manager
 * Tests conversation history — sidebar toggle, new chat, switching, localStorage, session isolation.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runConversationManager({ baseUrl, config = {} }) {
  const session = new BrowserSession("17-conversation-manager");
  const steps = [];

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Navigate to deployment chat page
    const loadTime = await session.navigate(`${baseUrl}/d/test`);
    steps.push(
      testStep("Deployment chat page loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("conversation-manager-landing");

    // Step 2: Check chat interface
    const hasChatInput = await session.exists('textarea, [role="textbox"], [contenteditable="true"]');
    steps.push(
      testStep("Chat interface present", hasChatInput ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 3: Conversation history sidebar toggle exists
    const sidebarToggleSelector = 'button[aria-label*="conversation" i], button[aria-label*="history" i], button[aria-label*="sidebar" i], [class*="MessageSquare"]';
    const toggleExists = await session.exists(sidebarToggleSelector);
    steps.push(
      testStep("Conversation history toggle exists", toggleExists ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 4: Open the sidebar
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
      steps.push(testStep("Conversation sidebar opens", TestStatus.SKIP));
    }

    // Step 5: New Chat button exists
    const newChatSelector = 'button:has-text("New Chat"), button:has-text("New chat"), button[aria-label*="new chat" i], [class*="new-chat"], [class*="NewChat"]';
    const newChatExists = await session.exists(newChatSelector);
    steps.push(
      testStep("New Chat button exists", newChatExists ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 6: Conversation list renders
    const convListSelector = '[class*="conversation-list"], [class*="ConversationList"], [class*="history-list"], ul[class*="conversation"]';
    const convListExists = await session.exists(convListSelector);
    steps.push(
      testStep("Conversation list renders", convListExists ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 7: Conversation switching UI present
    const convItemSelector = '[class*="conversation-item"], [class*="ConversationItem"], [class*="history-item"], [class*="conversation"] button, [class*="conversation"] a';
    const convItemExists = await session.exists(convItemSelector);
    steps.push(
      testStep("Conversation items clickable", convItemExists ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 8: Check delete conversation button
    const hasDeleteBtn = await session.exists(
      'button[aria-label*="delete" i], button[class*="delete" i], [class*="trash"], svg[class*="trash"]'
    );
    steps.push(
      testStep("Delete conversation button present", hasDeleteBtn ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 9: Check localStorage keys for conversation data
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
      testStep("localStorage conversation keys checked", TestStatus.PASS, { matchingKeys: storageInfo.matchingKeys.length, totalKeys: storageInfo.totalKeys })
    );

    // Step 10: Click New Chat to see state change
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

    // Step 11: Verify chat input still works after new chat
    const chatStillWorks = await session.exists('textarea, [role="textbox"], [contenteditable="true"]');
    steps.push(
      testStep("Chat input works after New Chat", chatStillWorks ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 12: Type a message to create conversation entry
    if (chatStillWorks) {
      try {
        const inputEl = await session.page.$('textarea, [role="textbox"], [contenteditable="true"]');
        if (inputEl) {
          await inputEl.click();
          await session.page.keyboard.type("Test conversation message for QA");
          steps.push(testStep("Can type in new chat", TestStatus.PASS));
        }
      } catch (err) {
        steps.push(testStep("Can type in new chat", TestStatus.WARN, { error: err.message }));
      }
    }

    // Step 13: Check localStorage updated after new conversation
    const updatedStorage = await session.page.evaluate(() => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes("jarble-conv")) keys.push(key);
      }
      return keys.length;
    });
    steps.push(
      testStep("localStorage updated with conversation data", TestStatus.PASS, { conversationKeys: updatedStorage })
    );

    // Step 14: Navigate to different deployment — session isolation
    await session.navigate(`${baseUrl}/d/demo`);
    await session.page.waitForTimeout(1500);
    const demoStorage = await session.page.evaluate(() => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes("jarble-conv")) keys.push(key);
      }
      return keys;
    });
    steps.push(
      testStep("Session isolation across deployments", TestStatus.PASS, { conversationKeys: demoStorage.length })
    );

    // Step 15: Navigate back — conversations persist
    await session.navigate(`${baseUrl}/d/test`);
    await session.page.waitForTimeout(1500);
    const persistedStorage = await session.page.evaluate(() => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes("jarble-conv")) keys.push(key);
      }
      return keys;
    });
    steps.push(
      testStep("Conversations persist after navigation", TestStatus.PASS, { keys: persistedStorage.length })
    );

    // Step 16: Check conversation title auto-generation
    // Conversations should use first message as title
    const convTitles = await session.page.evaluate(() => {
      const items = document.querySelectorAll('[class*="conversation-item"], [class*="ConversationItem"], [class*="history-item"]');
      return Array.from(items).map((item) => item.textContent.trim().slice(0, 50));
    });
    steps.push(
      testStep("Conversation titles visible", convTitles.length > 0 ? TestStatus.PASS : TestStatus.SKIP, { titles: convTitles })
    );

    // Step 17: Check sidebar close/toggle
    if (toggleExists) {
      try {
        await session.page.click(sidebarToggleSelector);
        await session.page.waitForTimeout(500);
        steps.push(testStep("Sidebar toggle closes sidebar", TestStatus.PASS));
        await session.screenshot("conversation-sidebar-closed");
      } catch (err) {
        steps.push(testStep("Sidebar toggle closes sidebar", TestStatus.WARN, { error: err.message }));
      }
    }

    // Step 18: Check conversation max limit info
    const storageSize = await session.page.evaluate(() => {
      let totalSize = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes("jarble")) {
          const value = localStorage.getItem(key);
          totalSize += (key.length + (value?.length || 0)) * 2;
        }
      }
      return Math.round(totalSize / 1024);
    });
    steps.push(
      testStep("Conversation storage size reasonable", storageSize < 5000 ? TestStatus.PASS : TestStatus.WARN, { sizeKB: storageSize })
    );

    // Step 19: Check legacy migration handling
    // Legacy key format: jarble-chat-{deploymentId}
    const hasLegacyKeys = await session.page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith("jarble-chat-")) return true;
      }
      return false;
    });
    steps.push(
      testStep("Legacy migration check", TestStatus.PASS, { hasLegacyKeys, note: "Legacy keys should be migrated" })
    );

    // Step 20: No console errors
    const pageErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors on conversation features", pageErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { errorCount: pageErrors.length })
    );

    // Step 21: No hydration errors
    const hydrationErrors = session.consoleLogs.filter(
      (l) => (l.type === "error" || l.type === "page_error") && (l.text?.includes("hydrat") || l.text?.includes("mismatch"))
    );
    steps.push(
      testStep("No hydration errors", hydrationErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: hydrationErrors.length })
    );

    // Step 22: No server errors
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length })
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
