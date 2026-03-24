/**
 * Persona 18: Component Gallery
 * Tests that canvas components render correctly — canvas area, component catalog, hydration.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runComponentGallery({ baseUrl }) {
  const session = new BrowserSession("18-component-gallery");
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
    await session.screenshot("component-gallery-landing");

    // Step 2: Check the canvas area exists
    const canvasSelector = '[class*="canvas"], [class*="Canvas"], [data-canvas], [class*="workspace"], [class*="Workspace"]';
    const canvasExists = await session.exists(canvasSelector);
    steps.push(
      testStep(
        "Canvas area exists",
        canvasExists ? TestStatus.PASS : TestStatus.WARN,
        { note: "Searched for canvas/workspace DOM elements" }
      )
    );

    // Step 3: Verify the component catalog provider loads
    const catalogCheck = await session.page.evaluate(() => {
      // Check for any React context or global related to component catalog
      const hasCanvasElements = document.querySelectorAll('[class*="canvas"], [class*="Canvas"], [data-component-type]').length;
      const hasProviderElements = document.querySelectorAll('[class*="provider"], [class*="Provider"], [class*="catalog"], [class*="Catalog"]').length;
      return { hasCanvasElements, hasProviderElements };
    });
    steps.push(
      testStep(
        "Component catalog provider present",
        catalogCheck.hasCanvasElements > 0 || catalogCheck.hasProviderElements > 0 ? TestStatus.PASS : TestStatus.WARN,
        catalogCheck
      )
    );

    // Step 4: Look for canvas-related DOM elements
    const canvasDomCheck = await session.page.evaluate(() => {
      const selectors = [
        '[class*="grid"]',
        '[class*="card"]',
        '[class*="block"]',
        '[class*="renderer"]',
        '[class*="Renderer"]',
        '[data-component-type]',
        '[class*="CanvasRenderer"]',
      ];
      const found = {};
      for (const sel of selectors) {
        found[sel] = document.querySelectorAll(sel).length;
      }
      return found;
    });
    steps.push(
      testStep(
        "Canvas-related DOM elements present",
        Object.values(canvasDomCheck).some((v) => v > 0) ? TestStatus.PASS : TestStatus.WARN,
        canvasDomCheck
      )
    );

    // Step 5: Check that CanvasRenderer-related imports are available (via rendered DOM)
    const rendererCheck = await session.page.evaluate(() => {
      const body = document.body.innerHTML;
      return {
        hasCanvasGrid: body.includes("canvas-grid") || body.includes("CanvasGrid") || body.includes("SimpleCanvasGrid"),
        hasCardElements: document.querySelectorAll('[class*="card"], [class*="Card"]').length > 0,
      };
    });
    steps.push(
      testStep(
        "CanvasRenderer imports available in DOM",
        rendererCheck.hasCanvasGrid || rendererCheck.hasCardElements ? TestStatus.PASS : TestStatus.WARN,
        rendererCheck
      )
    );

    // Step 6: Screenshot the empty canvas state
    await session.screenshot("empty-canvas-state");
    steps.push(testStep("Empty canvas state screenshotted", TestStatus.PASS));

    // Step 7: Navigate to /test-components or about page for component showcases
    try {
      const testLoadTime = await session.navigate(`${baseUrl}/test-components`);
      const hasTestComponents = await session.exists("body *");
      steps.push(
        testStep(
          "/test-components page exists",
          testLoadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN,
          { loadTime: `${testLoadTime}ms` }
        )
      );
      await session.screenshot("test-components-page");
    } catch (err) {
      // /test-components may not exist, try /about
      try {
        const aboutLoadTime = await session.navigate(`${baseUrl}/about`);
        steps.push(
          testStep(
            "About page loads (fallback for component showcase)",
            aboutLoadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN,
            { loadTime: `${aboutLoadTime}ms` }
          )
        );
        await session.screenshot("about-page");
      } catch (err2) {
        steps.push(
          testStep("/test-components or /about page", TestStatus.WARN, { note: "Neither page found" })
        );
      }
    }

    // Step 8: Verify no hydration errors in console
    const hydrationErrors = session.consoleLogs.filter(
      (l) =>
        (l.type === "error" || l.type === "page_error") &&
        (l.text?.includes("hydrat") || l.text?.includes("Hydrat") || l.text?.includes("mismatch"))
    );
    const allErrors = session.consoleLogs.filter(
      (l) => l.type === "error" || l.type === "page_error"
    );
    steps.push(
      testStep(
        "No hydration errors in console",
        hydrationErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL,
        { hydrationErrors: hydrationErrors.length, totalErrors: allErrors.length }
      )
    );
    steps.push(
      testStep(
        "No console errors overall",
        allErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN,
        { errorCount: allErrors.length }
      )
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
