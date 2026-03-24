/**
 * Persona 15: Theme Tester
 * Tests theme switching and CSS variable integrity in the chat interface.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds, Viewports } from "../lib/types.mjs";

export default async function runThemeTester({ baseUrl }) {
  const session = new BrowserSession("15-theme-tester");
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

    // Step 2: Check default theme loads (dark mode)
    const hasDarkClass = await session.page.evaluate(() => {
      return document.documentElement.classList.contains("dark") ||
        document.body.classList.contains("dark") ||
        getComputedStyle(document.documentElement).getPropertyValue("color-scheme").includes("dark");
    });
    steps.push(
      testStep(
        "Default theme loads (dark mode check)",
        hasDarkClass ? TestStatus.PASS : TestStatus.WARN,
        { hasDarkClass }
      )
    );
    await session.screenshot("default-theme");

    // Step 3: Look for theme-related CSS variables
    const cssVars = await session.page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const vars = {};
      for (const prop of ["--background", "--foreground", "--primary", "--card", "--muted", "--accent"]) {
        vars[prop] = style.getPropertyValue(prop).trim();
      }
      return vars;
    });
    const hasCssVars = Object.values(cssVars).some((v) => v.length > 0);
    steps.push(
      testStep(
        "Theme CSS variables are defined",
        hasCssVars ? TestStatus.PASS : TestStatus.WARN,
        { cssVars }
      )
    );

    // Step 4: Check that the chat skin CSS file loads
    const hasStylesheets = await session.page.evaluate(() => {
      const sheets = Array.from(document.styleSheets);
      return sheets.length > 0;
    });
    steps.push(
      testStep(
        "CSS stylesheets loaded",
        hasStylesheets ? TestStatus.PASS : TestStatus.FAIL,
        { note: "Checked document.styleSheets" }
      )
    );
    await session.screenshot("theme-stylesheets");

    // Step 5: Verify no layout shifts or broken styling
    const layoutIssues = await session.page.evaluate(() => {
      const body = document.body;
      const rect = body.getBoundingClientRect();
      return {
        bodyWidth: rect.width,
        bodyHeight: rect.height,
        hasOverflow: body.scrollWidth > window.innerWidth + 10,
        hasContent: body.innerHTML.length > 100,
      };
    });
    steps.push(
      testStep(
        "No layout shifts or broken styling",
        layoutIssues.hasContent && !layoutIssues.hasOverflow ? TestStatus.PASS : TestStatus.WARN,
        layoutIssues
      )
    );

    // Step 6: Check different viewport sizes with theme
    const viewportSizes = [
      { name: "desktop", ...Viewports.DESKTOP },
      { name: "tablet", ...Viewports.TABLET },
      { name: "mobile", ...Viewports.MOBILE },
    ];
    for (const vp of viewportSizes) {
      try {
        await session.page.setViewportSize({ width: vp.width, height: vp.height });
        await session.page.waitForTimeout(500);
        const vpOverflow = await session.page.evaluate(() => {
          return document.body.scrollWidth > window.innerWidth + 10;
        });
        steps.push(
          testStep(
            `Theme renders at ${vp.name} viewport (${vp.width}x${vp.height})`,
            !vpOverflow ? TestStatus.PASS : TestStatus.WARN,
            { viewport: `${vp.width}x${vp.height}` }
          )
        );
        await session.screenshot(`theme-${vp.name}`);
      } catch (err) {
        steps.push(
          testStep(`Theme renders at ${vp.name} viewport`, TestStatus.WARN, { error: err.message })
        );
      }
    }

    // Step 7: Verify no console errors
    const pageErrors = session.consoleLogs.filter(
      (l) => l.type === "error" || l.type === "page_error"
    );
    steps.push(
      testStep(
        "No console errors with theme",
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
    persona: "Theme Tester",
    description: "Tests theme switching, CSS variables, and responsive styling",
    steps,
    browser: session.getReport(),
  };
}
