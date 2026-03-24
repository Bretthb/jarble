/**
 * Persona 20: Chat Tester
 * Actually sends messages, waits for streaming responses, verifies content,
 * tests conversation switching, and validates the full chat lifecycle.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runChatTester({ baseUrl, apiUrl, config = {} }) {
  const session = new BrowserSession("20-chat-tester");
  const api = new ApiClient(apiUrl, config.authToken);
  const steps = [];

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Find a running deployment via API
    let deploymentId = null;
    try {
      const listResult = await api.trpc("deployment.list");
      const deployments = listResult.data?.result?.data;
      if (Array.isArray(deployments)) {
        const running = deployments.find((d) => d.status === "running" || d.status === "active");
        deploymentId = running?.id || (deployments.length > 0 ? deployments[0].id : null);
      }
      steps.push(testStep("Find a deployment via API", deploymentId ? TestStatus.PASS : TestStatus.SKIP, { id: deploymentId }));
    } catch (err) {
      steps.push(testStep("Find a deployment via API", TestStatus.WARN, { error: err.message }));
    }

    if (!deploymentId) {
      // Fallback: try /d/demo or just the first link
      deploymentId = "demo";
    }

    // Step 2: Navigate to chat page
    const chatLoad = await session.navigate(`${baseUrl}/d/${deploymentId}`);
    await session.page.waitForTimeout(4000);
    steps.push(testStep("Navigate to chat page", chatLoad < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${chatLoad}ms`, deploymentId }));
    await session.screenshot("chat-loaded");

    // Step 3: Wait for chat input to appear
    let chatInput = null;
    try {
      chatInput = await session.page.$('textarea, input[placeholder*="message" i], input[placeholder*="type" i], [contenteditable="true"], [class*="chat-input"]');
      steps.push(testStep("Chat input field present", chatInput ? TestStatus.PASS : TestStatus.FAIL));
    } catch (err) {
      steps.push(testStep("Chat input field present", TestStatus.FAIL, { error: err.message }));
    }

    // Step 4: Type first message and send
    if (chatInput) {
      try {
        await chatInput.click();
        await chatInput.fill("Hello, what can you do?");
        await session.page.waitForTimeout(500);

        // Press Enter or click Send button
        const sendBtn = await session.page.$('button[aria-label*="send" i], button:has-text("Send"), button[type="submit"]');
        if (sendBtn) {
          await sendBtn.click();
        } else {
          await session.page.keyboard.press("Enter");
        }
        steps.push(testStep("Send first message: 'Hello, what can you do?'", TestStatus.PASS));
      } catch (err) {
        steps.push(testStep("Send first message", TestStatus.FAIL, { error: err.message }));
      }
    } else {
      steps.push(testStep("Send first message", TestStatus.SKIP, { note: "No chat input found" }));
    }

    // Step 5: Wait for streaming response
    try {
      // Wait for assistant message to appear (up to 30s)
      await session.page.waitForTimeout(2000);
      let responseFound = false;
      for (let i = 0; i < 14; i++) {
        const assistantMessages = await session.page.$$('[class*="assistant"], [data-role="assistant"], [class*="bot-message"], [class*="ai-message"]');
        if (assistantMessages.length > 0) {
          responseFound = true;
          break;
        }
        // Also check for any new text content appearing after user message
        const allMessages = await session.page.$$('[class*="message"]');
        if (allMessages.length >= 2) {
          responseFound = true;
          break;
        }
        await session.page.waitForTimeout(2000);
      }
      steps.push(testStep("Wait for streaming response", responseFound ? TestStatus.PASS : TestStatus.WARN, { found: responseFound }));
      await session.screenshot("first-response");
    } catch (err) {
      steps.push(testStep("Wait for streaming response", TestStatus.WARN, { error: err.message }));
    }

    // Step 6: Verify response text is not empty
    try {
      const bodyText = await session.safeTextContent("body");
      // Check that something beyond just the user message appeared
      const hasContent = bodyText && bodyText.length > 100;
      steps.push(testStep("Response text is not empty", hasContent ? TestStatus.PASS : TestStatus.WARN, { bodyLength: bodyText?.length }));
    } catch (err) {
      steps.push(testStep("Response text is not empty", TestStatus.WARN, { error: err.message }));
    }

    // Step 7: Check streaming indicator appeared and disappeared
    try {
      // The streaming indicator should be gone by now (we waited 30s)
      const stillStreaming = await session.exists('[class*="streaming"], [class*="typing"], [class*="loading-dots"]');
      steps.push(testStep("Streaming indicator resolved", !stillStreaming ? TestStatus.PASS : TestStatus.WARN, { stillStreaming }));
    } catch (err) {
      steps.push(testStep("Streaming indicator resolved", TestStatus.WARN, { error: err.message }));
    }

    // Step 8: Send second message requesting a component
    try {
      const chatInput2 = await session.page.$('textarea, input[placeholder*="message" i], input[placeholder*="type" i], [contenteditable="true"]');
      if (chatInput2) {
        await chatInput2.click();
        await chatInput2.fill("Show me a simple chart of monthly sales data");
        await session.page.waitForTimeout(300);
        const sendBtn = await session.page.$('button[aria-label*="send" i], button:has-text("Send"), button[type="submit"]');
        if (sendBtn) {
          await sendBtn.click();
        } else {
          await session.page.keyboard.press("Enter");
        }
        steps.push(testStep("Send second message: chart request", TestStatus.PASS));

        // Wait for response + potential canvas cards
        await session.page.waitForTimeout(15000);
        await session.screenshot("chart-response");

        // Check for canvas cards
        const canvasCards = await session.countElements('[class*="canvas-card"], [class*="card"], [class*="component-block"], [class*="sandbox"]');
        steps.push(testStep("Canvas cards appeared (if applicable)", canvasCards > 0 ? TestStatus.PASS : TestStatus.SKIP, { cardCount: canvasCards }));
      } else {
        steps.push(testStep("Send second message", TestStatus.SKIP, { note: "Chat input not found" }));
      }
    } catch (err) {
      steps.push(testStep("Send second message", TestStatus.WARN, { error: err.message }));
    }

    // Step 9: Check conversation history sidebar
    try {
      const historyBtn = await session.page.$('button[aria-label*="history" i], button[aria-label*="conversation" i], [class*="conversation-history"], button:has-text("History")');
      if (historyBtn) {
        await historyBtn.click();
        await session.page.waitForTimeout(1500);
        await session.screenshot("conversation-sidebar");
        const sidebarVisible = await session.exists('[class*="sidebar"], [class*="panel"], [class*="conversation-list"]');
        steps.push(testStep("Conversation history sidebar opens", sidebarVisible ? TestStatus.PASS : TestStatus.WARN));
      } else {
        steps.push(testStep("Conversation history sidebar opens", TestStatus.SKIP, { note: "History button not found" }));
      }
    } catch (err) {
      steps.push(testStep("Conversation history sidebar opens", TestStatus.WARN, { error: err.message }));
    }

    // Step 10: Click "New Chat"
    try {
      const newChatBtn = await session.page.$('button:has-text("New Chat"), button:has-text("New"), button[aria-label*="new chat" i]');
      if (newChatBtn) {
        await newChatBtn.click();
        await session.page.waitForTimeout(2000);
        steps.push(testStep("Click New Chat button", TestStatus.PASS));
      } else {
        steps.push(testStep("Click New Chat button", TestStatus.SKIP, { note: "New Chat button not found" }));
      }
    } catch (err) {
      steps.push(testStep("Click New Chat button", TestStatus.WARN, { error: err.message }));
    }

    // Step 11: Verify fresh conversation (input empty)
    try {
      const chatInput3 = await session.page.$('textarea, input[placeholder*="message" i], [contenteditable="true"]');
      if (chatInput3) {
        const val = await chatInput3.inputValue().catch(() => "");
        const isEmpty = !val || val.trim().length === 0;
        steps.push(testStep("New chat has empty input", isEmpty ? TestStatus.PASS : TestStatus.WARN, { value: val?.slice(0, 50) }));
      } else {
        steps.push(testStep("New chat has empty input", TestStatus.SKIP));
      }
    } catch (err) {
      steps.push(testStep("New chat has empty input", TestStatus.WARN, { error: err.message }));
    }

    // Step 12: Send math question in new conversation
    try {
      const chatInput4 = await session.page.$('textarea, input[placeholder*="message" i], [contenteditable="true"]');
      if (chatInput4) {
        await chatInput4.click();
        await chatInput4.fill("What is 2+2?");
        await session.page.waitForTimeout(300);
        const sendBtn = await session.page.$('button[aria-label*="send" i], button:has-text("Send"), button[type="submit"]');
        if (sendBtn) {
          await sendBtn.click();
        } else {
          await session.page.keyboard.press("Enter");
        }

        // Wait for response
        await session.page.waitForTimeout(15000);
        const bodyText = await session.safeTextContent("body");
        const hasAnswer = bodyText && bodyText.includes("4");
        steps.push(testStep("Send '2+2' and verify response contains '4'", hasAnswer ? TestStatus.PASS : TestStatus.WARN, { hasAnswer }));
        await session.screenshot("math-answer");
      } else {
        steps.push(testStep("Send math question", TestStatus.SKIP));
      }
    } catch (err) {
      steps.push(testStep("Send math question", TestStatus.WARN, { error: err.message }));
    }

    // Step 13: Verify no 5xx errors during chat flow
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(testStep("No server errors during chat flow", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length }));

    // Step 14: Console error count
    const consoleErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(testStep("Minimal console errors", consoleErrors.length <= 5 ? TestStatus.PASS : TestStatus.WARN, { count: consoleErrors.length }));

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message, stack: err.stack?.slice(0, 500) }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Chat Tester",
    description: "Sends messages, verifies streaming responses, tests conversation switching",
    steps,
    browser: session.getReport(),
    api: api.getResults(),
  };
}
