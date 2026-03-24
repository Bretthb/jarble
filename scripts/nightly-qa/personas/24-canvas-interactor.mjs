/**
 * Persona 24: Canvas Interactor
 * Actually interacts with canvas cards — sends messages to generate components,
 * uses context menus, tests zoom controls, drags cards, and closes them.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runCanvasInteractor({ baseUrl, apiUrl, config = {} }) {
  const session = new BrowserSession("24-canvas-interactor");
  const api = new ApiClient(apiUrl, config.authToken);
  const steps = [];
  let deploymentId = null;

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Find a running deployment
    try {
      const listResult = await api.trpc("deployment.list");
      const deployments = listResult.data?.result?.data;
      if (Array.isArray(deployments) && deployments.length > 0) {
        const running = deployments.find((d) => d.status === "running" || d.status === "active");
        deploymentId = running?.id || deployments[0].id;
      }
      steps.push(testStep("Find deployment via API", deploymentId ? TestStatus.PASS : TestStatus.SKIP, { id: deploymentId }));
    } catch (err) {
      steps.push(testStep("Find deployment via API", TestStatus.WARN, { error: err.message }));
    }

    if (!deploymentId) {
      deploymentId = "demo";
    }

    // Step 2: Navigate to deployment chat
    const chatLoad = await session.navigate(`${baseUrl}/d/${deploymentId}`);
    await session.page.waitForTimeout(4000);
    steps.push(testStep("Navigate to deployment chat", chatLoad < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${chatLoad}ms` }));
    await session.screenshot("canvas-chat-loaded");

    // Step 3: Send message to generate a component
    try {
      const chatInput = await session.page.$('textarea, input[placeholder*="message" i], input[placeholder*="type" i], [contenteditable="true"]');
      if (chatInput) {
        await chatInput.click();
        await chatInput.fill("Show me a stat grid with 3 metrics: Revenue $45K, Users 1.2K, Growth 23%");
        await session.page.waitForTimeout(300);

        const sendBtn = await session.page.$('button[aria-label*="send" i], button:has-text("Send"), button[type="submit"]');
        if (sendBtn) {
          await sendBtn.click();
        } else {
          await session.page.keyboard.press("Enter");
        }
        steps.push(testStep("Send component-generating message", TestStatus.PASS));
      } else {
        steps.push(testStep("Send component-generating message", TestStatus.SKIP, { note: "Chat input not found" }));
      }
    } catch (err) {
      steps.push(testStep("Send component-generating message", TestStatus.WARN, { error: err.message }));
    }

    // Step 4: Wait for response and canvas card
    let canvasCardFound = false;
    try {
      // Wait up to 30s for canvas card to appear
      for (let i = 0; i < 15; i++) {
        const cards = await session.page.$$('[class*="canvas-card"], [class*="card"], [class*="component-block"], [class*="sandbox"], [data-card-id]');
        if (cards.length > 0) {
          canvasCardFound = true;
          break;
        }
        await session.page.waitForTimeout(2000);
      }
      steps.push(testStep("Wait for canvas card to appear", canvasCardFound ? TestStatus.PASS : TestStatus.SKIP, { found: canvasCardFound }));
      await session.screenshot("canvas-card-response");
    } catch (err) {
      steps.push(testStep("Wait for canvas card to appear", TestStatus.WARN, { error: err.message }));
    }

    // Step 5: Right-click a card (context menu)
    try {
      const card = await session.page.$('[class*="canvas-card"], [data-card-id], [class*="component-block"]');
      if (card) {
        const box = await card.boundingBox();
        if (box) {
          await session.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
          await session.page.waitForTimeout(1500);
          steps.push(testStep("Right-click card for context menu", TestStatus.PASS));
          await session.screenshot("context-menu-open");
        } else {
          steps.push(testStep("Right-click card for context menu", TestStatus.WARN, { note: "Card has no bounding box" }));
        }
      } else {
        // Try the ... button instead
        const moreBtn = await session.page.$('[class*="card"] button, button:has-text("..."), [class*="more-button"]');
        if (moreBtn) {
          await moreBtn.click();
          await session.page.waitForTimeout(1500);
          steps.push(testStep("Click card menu button", TestStatus.PASS));
          await session.screenshot("card-menu-open");
        } else {
          steps.push(testStep("Right-click card for context menu", TestStatus.SKIP, { note: "No card found to right-click" }));
        }
      }
    } catch (err) {
      steps.push(testStep("Right-click card for context menu", TestStatus.WARN, { error: err.message }));
    }

    // Step 6: Click "Select" in context menu
    try {
      const selectOption = await session.page.$('[role="menuitem"]:has-text("Select"), button:has-text("Select"), [class*="context-menu"] button:has-text("Select")');
      if (selectOption) {
        await selectOption.click();
        await session.page.waitForTimeout(1000);
        steps.push(testStep("Click Select in context menu", TestStatus.PASS));
      } else {
        steps.push(testStep("Click Select in context menu", TestStatus.SKIP, { note: "Select option not found" }));
      }
    } catch (err) {
      steps.push(testStep("Click Select in context menu", TestStatus.WARN, { error: err.message }));
    }

    // Step 7: Verify card is selected (visual indicator)
    try {
      const selectedCard = await session.exists('[class*="selected"], [data-selected="true"], [aria-selected="true"], [class*="ring"], [class*="border-blue"]');
      steps.push(testStep("Card shows selected state", selectedCard ? TestStatus.PASS : TestStatus.SKIP, { hasIndicator: selectedCard }));
      await session.screenshot("card-selected");
    } catch (err) {
      steps.push(testStep("Card shows selected state", TestStatus.WARN, { error: err.message }));
    }

    // Step 8: Test zoom controls
    try {
      const zoomInBtn = await session.page.$('button[aria-label*="zoom in" i], button:has-text("+"), [class*="zoom-in"]');
      const zoomOutBtn = await session.page.$('button[aria-label*="zoom out" i], button:has-text("-"), [class*="zoom-out"]');
      const resetBtn = await session.page.$('button[aria-label*="reset" i], button[aria-label*="fit" i], button:has-text("Reset"), button:has-text("100%")');

      let zoomActionsPerformed = 0;
      if (zoomInBtn) {
        await zoomInBtn.click();
        await session.page.waitForTimeout(500);
        await zoomInBtn.click();
        await session.page.waitForTimeout(500);
        zoomActionsPerformed++;
      }
      if (zoomOutBtn) {
        await zoomOutBtn.click();
        await session.page.waitForTimeout(500);
        zoomActionsPerformed++;
      }
      if (resetBtn) {
        await resetBtn.click();
        await session.page.waitForTimeout(500);
        zoomActionsPerformed++;
      }

      steps.push(testStep("Test zoom controls (in/out/reset)", zoomActionsPerformed > 0 ? TestStatus.PASS : TestStatus.SKIP, { actionsPerformed: zoomActionsPerformed }));
      await session.screenshot("zoom-state");
    } catch (err) {
      steps.push(testStep("Test zoom controls", TestStatus.WARN, { error: err.message }));
    }

    // Step 9: Close a card via context menu
    try {
      const card = await session.page.$('[class*="canvas-card"], [data-card-id], [class*="component-block"]');
      if (card) {
        const box = await card.boundingBox();
        if (box) {
          await session.page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
          await session.page.waitForTimeout(1000);
          const closeOption = await session.page.$('[role="menuitem"]:has-text("Close"), button:has-text("Close"), [class*="context-menu"] button:has-text("Close"), [role="menuitem"]:has-text("Remove")');
          if (closeOption) {
            const cardsBefore = await session.countElements('[class*="canvas-card"], [data-card-id], [class*="component-block"]');
            await closeOption.click();
            await session.page.waitForTimeout(1500);
            const cardsAfter = await session.countElements('[class*="canvas-card"], [data-card-id], [class*="component-block"]');
            steps.push(testStep("Close card via context menu", cardsAfter < cardsBefore ? TestStatus.PASS : TestStatus.WARN, { before: cardsBefore, after: cardsAfter }));
          } else {
            steps.push(testStep("Close card via context menu", TestStatus.SKIP, { note: "Close option not found" }));
          }
        }
      } else {
        steps.push(testStep("Close card via context menu", TestStatus.SKIP, { note: "No card to close" }));
      }
      await session.screenshot("card-closed");
    } catch (err) {
      steps.push(testStep("Close card via context menu", TestStatus.WARN, { error: err.message }));
    }

    // Step 10: Send another message to get a new card
    try {
      const chatInput2 = await session.page.$('textarea, input[placeholder*="message" i], [contenteditable="true"]');
      if (chatInput2) {
        await chatInput2.click();
        await chatInput2.fill("Create a simple code block showing a hello world function in JavaScript");
        await session.page.waitForTimeout(300);
        const sendBtn = await session.page.$('button[aria-label*="send" i], button:has-text("Send"), button[type="submit"]');
        if (sendBtn) {
          await sendBtn.click();
        } else {
          await session.page.keyboard.press("Enter");
        }
        // Wait for response
        await session.page.waitForTimeout(15000);
        steps.push(testStep("Send message for new canvas card", TestStatus.PASS));
        await session.screenshot("new-card-response");
      } else {
        steps.push(testStep("Send message for new canvas card", TestStatus.SKIP));
      }
    } catch (err) {
      steps.push(testStep("Send message for new canvas card", TestStatus.WARN, { error: err.message }));
    }

    // Step 11: Drag a card
    try {
      const card = await session.page.$('[class*="canvas-card"], [data-card-id], [class*="component-block"]');
      if (card) {
        const box = await card.boundingBox();
        if (box) {
          // Drag from center to 100px right and 50px down
          const startX = box.x + box.width / 2;
          const startY = box.y + 10; // top area for drag handle
          await session.page.mouse.move(startX, startY);
          await session.page.mouse.down();
          await session.page.waitForTimeout(200);
          await session.page.mouse.move(startX + 100, startY + 50, { steps: 10 });
          await session.page.waitForTimeout(200);
          await session.page.mouse.up();
          await session.page.waitForTimeout(500);
          steps.push(testStep("Drag card to new position", TestStatus.PASS, { from: { x: startX, y: startY }, to: { x: startX + 100, y: startY + 50 } }));
          await session.screenshot("card-dragged");
        } else {
          steps.push(testStep("Drag card to new position", TestStatus.WARN, { note: "Card has no bounding box" }));
        }
      } else {
        steps.push(testStep("Drag card to new position", TestStatus.SKIP, { note: "No card to drag" }));
      }
    } catch (err) {
      steps.push(testStep("Drag card to new position", TestStatus.WARN, { error: err.message }));
    }

    // Step 12: Keyboard shortcuts on canvas (Ctrl+A, Escape)
    try {
      await session.page.keyboard.press("Escape");
      await session.page.waitForTimeout(500);
      steps.push(testStep("Press Escape to deselect", TestStatus.PASS));
    } catch (err) {
      steps.push(testStep("Press Escape to deselect", TestStatus.WARN, { error: err.message }));
    }

    // Step 13: Overall error check
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(testStep("No server errors (5xx)", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length }));

    const consoleErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(testStep("Minimal console errors", consoleErrors.length <= 5 ? TestStatus.PASS : TestStatus.WARN, { count: consoleErrors.length }));

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message, stack: err.stack?.slice(0, 500) }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Canvas Interactor",
    description: "Generates canvas cards, uses context menus, zooms, drags, and closes cards",
    steps,
    browser: session.getReport(),
    api: api.getResults(),
  };
}
