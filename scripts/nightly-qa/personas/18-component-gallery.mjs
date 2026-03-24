/**
 * Persona 18: Component Gallery
 * Tests canvas components — canvas area, component catalog, rendering, hydration, card controls.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runComponentGallery({ baseUrl, config = {} }) {
  const session = new BrowserSession("18-component-gallery");
  const steps = [];

  try {
    await session.start();

    // Inject auth token
    if (config.authToken) {
      await session.context.addCookies([{
        name: 'auth_token',
        value: config.authToken,
        domain: new URL(baseUrl).hostname,
        path: '/',
      }]);
      await session.page.addInitScript((token) => {
        localStorage.setItem('jarble_qa_token', token);
      }, config.authToken);
    }

    // Step 1: Navigate to deployment chat page
    const loadTime = await session.navigate(`${baseUrl}/d/test`);
    steps.push(
      testStep("Deployment chat page loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("component-gallery-landing");

    // Step 2: Chat interface rendered
    const hasChatInput = await session.exists('textarea, [role="textbox"], [contenteditable="true"]');
    steps.push(
      testStep("Chat interface rendered", hasChatInput ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 3: Canvas area exists
    const canvasSelector = '[class*="canvas"], [class*="Canvas"], [data-canvas], [class*="workspace"], [class*="Workspace"]';
    const canvasExists = await session.exists(canvasSelector);
    steps.push(
      testStep("Canvas area exists", canvasExists ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 4: Component catalog provider loads
    const catalogCheck = await session.page.evaluate(() => {
      const hasCanvasElements = document.querySelectorAll('[class*="canvas"], [class*="Canvas"], [data-component-type]').length;
      const hasProviderElements = document.querySelectorAll('[class*="provider"], [class*="Provider"], [class*="catalog"], [class*="Catalog"]').length;
      return { hasCanvasElements, hasProviderElements };
    });
    steps.push(
      testStep("Component catalog provider present", catalogCheck.hasCanvasElements > 0 || catalogCheck.hasProviderElements > 0 ? TestStatus.PASS : TestStatus.WARN, catalogCheck)
    );

    // Step 5: Canvas-related DOM elements present
    const canvasDomCheck = await session.page.evaluate(() => {
      const selectors = ['[class*="grid"]', '[class*="card"]', '[class*="block"]', '[class*="renderer"]', '[class*="Renderer"]', '[data-component-type]'];
      const found = {};
      for (const sel of selectors) found[sel] = document.querySelectorAll(sel).length;
      return found;
    });
    steps.push(
      testStep("Canvas-related DOM elements present", Object.values(canvasDomCheck).some((v) => v > 0) ? TestStatus.PASS : TestStatus.WARN, canvasDomCheck)
    );

    // Step 6: CanvasRenderer-related DOM elements
    const rendererCheck = await session.page.evaluate(() => {
      const body = document.body.innerHTML;
      return {
        hasCanvasGrid: body.includes("canvas-grid") || body.includes("CanvasGrid") || body.includes("SimpleCanvasGrid"),
        hasCardElements: document.querySelectorAll('[class*="card"], [class*="Card"]').length > 0,
      };
    });
    steps.push(
      testStep("CanvasRenderer in DOM", rendererCheck.hasCanvasGrid || rendererCheck.hasCardElements ? TestStatus.PASS : TestStatus.WARN, rendererCheck)
    );

    // Step 7: Screenshot empty canvas state
    await session.screenshot("empty-canvas-state");
    steps.push(testStep("Empty canvas state screenshotted", TestStatus.PASS));

    // Step 8: Check canvas card controls (... button, context menu)
    const hasCardControls = await session.exists(
      '[class*="card-controls"], [class*="CardControls"], button[class*="more"], [class*="ellipsis"]'
    );
    steps.push(
      testStep("Canvas card controls present", hasCardControls ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 9: Right-click context menu on canvas
    if (canvasExists) {
      try {
        const canvasEl = await session.page.$(canvasSelector);
        if (canvasEl) {
          await canvasEl.click({ button: "right" });
          await session.page.waitForTimeout(500);
          const hasContextMenu = await session.exists('[class*="context-menu"], [class*="ContextMenu"], [role="menu"]');
          steps.push(testStep("Right-click context menu on canvas", hasContextMenu ? TestStatus.PASS : TestStatus.SKIP));
          await session.screenshot("canvas-context-menu");
          // Close context menu
          await session.page.keyboard.press("Escape");
        }
      } catch (err) {
        steps.push(testStep("Right-click context menu on canvas", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Right-click context menu on canvas", TestStatus.SKIP));
    }

    // Step 10: Check canvas zoom/pan controls
    const hasZoomControls = await session.exists(
      'button[aria-label*="zoom" i], button[aria-label*="fit" i], [class*="zoom"], [class*="controls"]'
    );
    steps.push(
      testStep("Canvas zoom/pan controls", hasZoomControls ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 11: Check for sandbox iframe elements (for rendered components)
    const hasSandbox = await session.exists('iframe[sandbox], iframe[class*="sandbox"], [class*="sandbox"]');
    steps.push(
      testStep("Sandbox iframe elements", hasSandbox ? TestStatus.PASS : TestStatus.SKIP, { note: "Sandbox used for rendered components" })
    );

    // Step 12: Check code block rendering
    const hasCodeBlock = await session.exists(
      '[class*="code-block"], [class*="CodeBlock"], [class*="CanvasCodeBlock"], pre code, [class*="shiki"]'
    );
    steps.push(
      testStep("Code block renderer present", hasCodeBlock ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 13: Check for component type data attributes
    const componentTypes = await session.page.evaluate(() => {
      const els = document.querySelectorAll('[data-component-type]');
      return Array.from(els).map((el) => el.getAttribute("data-component-type"));
    });
    steps.push(
      testStep("Component type data attributes", componentTypes.length > 0 ? TestStatus.PASS : TestStatus.SKIP, { types: componentTypes })
    );

    // Step 14: Check marketplace panel for component browsing
    const marketplaceBtn = 'button[aria-label*="marketplace" i], button[aria-label*="store" i], button[aria-label*="component" i]';
    const hasMarketplace = await session.exists(marketplaceBtn);
    steps.push(
      testStep("Marketplace panel for component browsing", hasMarketplace ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 15: Open marketplace panel
    if (hasMarketplace) {
      try {
        await session.page.click(marketplaceBtn);
        await session.page.waitForTimeout(1000);
        await session.screenshot("component-marketplace-panel");
        const componentList = await session.countElements('[class*="card"], [class*="item"], [class*="component"]');
        steps.push(testStep("Component list in marketplace panel", componentList > 0 ? TestStatus.PASS : TestStatus.SKIP, { count: componentList }));
      } catch (err) {
        steps.push(testStep("Component list in marketplace panel", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Component list in marketplace panel", TestStatus.SKIP));
    }

    // Step 16: Navigate to /test-components or /about for showcases
    try {
      const testLoadTime = await session.navigate(`${baseUrl}/test-components`);
      steps.push(testStep("/test-components page exists", testLoadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${testLoadTime}ms` }));
      await session.screenshot("test-components-page");
    } catch (_) {
      try {
        const aboutLoadTime = await session.navigate(`${baseUrl}/about`);
        steps.push(testStep("About page loads (fallback)", aboutLoadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN));
        await session.screenshot("about-page");
      } catch (_) {
        steps.push(testStep("/test-components or /about page", TestStatus.WARN, { note: "Neither page found" }));
      }
    }

    // Step 17: Check canvas action context (content_edit, etc.)
    const hasActionContext = await session.page.evaluate(() => {
      // Check for dispatch-related elements
      const body = document.body.innerHTML;
      return body.includes("CanvasAction") || body.includes("canvas-action") || body.includes("content_edit");
    });
    steps.push(
      testStep("Canvas action context elements", hasActionContext ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 18: Check card drag/resize handles
    const hasDragHandles = await session.exists(
      '[class*="drag-handle"], [class*="DragHandle"], [class*="resize"], [class*="Resize"], [class*="handle"]'
    );
    steps.push(
      testStep("Card drag/resize handles", hasDragHandles ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 19: Check canvas grid layout
    const gridLayout = await session.page.evaluate(() => {
      const grid = document.querySelector('[class*="grid"], [class*="Grid"], [class*="canvas-grid"]');
      if (!grid) return null;
      const style = getComputedStyle(grid);
      return { display: style.display, position: style.position };
    });
    steps.push(
      testStep("Canvas grid layout present", gridLayout !== null ? TestStatus.PASS : TestStatus.SKIP, gridLayout)
    );

    // Step 20: No hydration errors
    const hydrationErrors = session.consoleLogs.filter(
      (l) => (l.type === "error" || l.type === "page_error") && (l.text?.includes("hydrat") || l.text?.includes("Hydrat") || l.text?.includes("mismatch"))
    );
    steps.push(
      testStep("No hydration errors", hydrationErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: hydrationErrors.length })
    );

    // Step 21: No console errors overall
    const allErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors overall", allErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { errorCount: allErrors.length })
    );

    // Step 22: No server errors
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length })
    );

    // Step 23: Performance check
    const slowPages = session.performanceMetrics.filter((m) => m.name.startsWith("navigate:") && m.value > Thresholds.PAGE_LOAD);
    steps.push(
      testStep("All pages load within threshold", slowPages.length === 0 ? TestStatus.PASS : TestStatus.WARN, {
        slowPages: slowPages.map((p) => `${p.name} (${p.value}ms)`),
      })
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Component Gallery",
    description: "Tests canvas components — canvas area, catalog provider, hydration, rendering",
    steps,
    browser: session.getReport(),
  };
}
