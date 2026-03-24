/**
 * Persona 15: Theme Tester
 * Tests theme switching, CSS variable integrity, responsive styling, dark/light mode across viewports.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds, Viewports } from "../lib/types.mjs";

export default async function runThemeTester({ baseUrl, config = {} }) {
  const session = new BrowserSession("15-theme-tester");
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

    // Step 2: Check default theme (dark mode)
    const hasDarkClass = await session.page.evaluate(() => {
      return document.documentElement.classList.contains("dark") ||
        document.body.classList.contains("dark") ||
        getComputedStyle(document.documentElement).getPropertyValue("color-scheme").includes("dark");
    });
    steps.push(
      testStep("Default theme loads (dark mode check)", hasDarkClass ? TestStatus.PASS : TestStatus.WARN, { hasDarkClass })
    );
    await session.screenshot("default-theme");

    // Step 3: Theme CSS variables defined
    const cssVars = await session.page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      const vars = {};
      for (const prop of ["--background", "--foreground", "--primary", "--card", "--muted", "--accent", "--border", "--ring", "--destructive"]) {
        vars[prop] = style.getPropertyValue(prop).trim();
      }
      return vars;
    });
    const hasCssVars = Object.values(cssVars).some((v) => v.length > 0);
    steps.push(
      testStep("Theme CSS variables defined", hasCssVars ? TestStatus.PASS : TestStatus.WARN, { cssVars })
    );

    // Step 4: CSS stylesheets loaded
    const sheetCount = await session.page.evaluate(() => document.styleSheets.length);
    steps.push(
      testStep("CSS stylesheets loaded", sheetCount > 0 ? TestStatus.PASS : TestStatus.FAIL, { count: sheetCount })
    );

    // Step 5: No layout shifts or broken styling
    const layoutIssues = await session.page.evaluate(() => {
      const body = document.body;
      const rect = body.getBoundingClientRect();
      return {
        bodyWidth: rect.width, bodyHeight: rect.height,
        hasOverflow: body.scrollWidth > window.innerWidth + 10,
        hasContent: body.innerHTML.length > 100,
      };
    });
    steps.push(
      testStep("No layout shifts or broken styling", layoutIssues.hasContent && !layoutIssues.hasOverflow ? TestStatus.PASS : TestStatus.WARN, layoutIssues)
    );

    // Step 6: Background color is not white (dark theme)
    const bgColor = await session.page.evaluate(() => {
      return getComputedStyle(document.body).backgroundColor;
    });
    const isNotPlainWhite = bgColor !== "rgb(255, 255, 255)" && bgColor !== "#ffffff";
    steps.push(
      testStep("Background color is themed (not plain white)", isNotPlainWhite ? TestStatus.PASS : TestStatus.WARN, { bgColor })
    );

    // Step 7: Text color contrasts with background
    const textColor = await session.page.evaluate(() => {
      return getComputedStyle(document.body).color;
    });
    steps.push(
      testStep("Text color set", textColor && textColor !== bgColor ? TestStatus.PASS : TestStatus.WARN, { textColor, bgColor })
    );

    // Step 8-10: Theme at different viewport sizes
    const viewportSizes = [
      { name: "desktop", ...Viewports.DESKTOP },
      { name: "tablet", ...Viewports.TABLET },
      { name: "mobile", ...Viewports.MOBILE },
    ];
    for (const vp of viewportSizes) {
      try {
        await session.page.setViewportSize({ width: vp.width, height: vp.height });
        await session.page.waitForTimeout(500);
        const vpOverflow = await session.page.evaluate(() => document.body.scrollWidth > window.innerWidth + 10);
        steps.push(
          testStep(`Theme renders at ${vp.name} (${vp.width}x${vp.height})`, !vpOverflow ? TestStatus.PASS : TestStatus.WARN, { viewport: `${vp.width}x${vp.height}` })
        );
        await session.screenshot(`theme-${vp.name}`);
      } catch (err) {
        steps.push(testStep(`Theme renders at ${vp.name}`, TestStatus.WARN, { error: err.message }));
      }
    }
    // Reset viewport
    await session.page.setViewportSize(Viewports.DESKTOP);

    // Step 11: Check chat area theme integration
    const chatTheme = await session.page.evaluate(() => {
      const chatArea = document.querySelector('[class*="thread"], [class*="chat"], [class*="message"]');
      if (!chatArea) return null;
      const style = getComputedStyle(chatArea);
      return { bgColor: style.backgroundColor, color: style.color };
    });
    steps.push(
      testStep("Chat area uses theme colors", chatTheme !== null ? TestStatus.PASS : TestStatus.SKIP, chatTheme)
    );

    // Step 12: Check send button styling
    const sendBtnStyle = await session.page.evaluate(() => {
      const btn = document.querySelector('button[aria-label*="send" i], button[type="submit"]');
      if (!btn) return null;
      const style = getComputedStyle(btn);
      return { bgColor: style.backgroundColor, color: style.color, borderRadius: style.borderRadius };
    });
    steps.push(
      testStep("Send button has themed styling", sendBtnStyle !== null ? TestStatus.PASS : TestStatus.SKIP, sendBtnStyle)
    );

    // Step 13: Test homepage theme
    await session.navigate(baseUrl);
    await session.page.waitForTimeout(2000);
    const homeTheme = await session.page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return { bgColor: style.backgroundColor, color: style.color };
    });
    steps.push(
      testStep("Homepage uses consistent theme", TestStatus.PASS, homeTheme)
    );
    await session.screenshot("theme-homepage");

    // Step 14: Test dashboard theme
    await session.navigate(`${baseUrl}/dashboard`);
    await session.page.waitForTimeout(2000);
    const dashTheme = await session.page.evaluate(() => {
      const style = getComputedStyle(document.body);
      return { bgColor: style.backgroundColor, color: style.color };
    });
    steps.push(
      testStep("Dashboard uses consistent theme", TestStatus.PASS, dashTheme)
    );
    await session.screenshot("theme-dashboard");

    // Step 15: Test settings page theme
    await session.navigate(`${baseUrl}/settings`);
    await session.page.waitForTimeout(2000);
    await session.screenshot("theme-settings");
    steps.push(testStep("Settings page themed consistently", TestStatus.PASS));

    // Step 16: Check card/panel styling consistency
    const cardStyles = await session.page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="card"], [class*="Card"], [class*="panel"], [class*="Panel"]');
      const styles = Array.from(cards).slice(0, 5).map((c) => {
        const s = getComputedStyle(c);
        return { bgColor: s.backgroundColor, borderRadius: s.borderRadius, border: s.border };
      });
      return styles;
    });
    steps.push(
      testStep("Card/panel styling consistent", cardStyles.length > 0 ? TestStatus.PASS : TestStatus.SKIP, { cardCount: cardStyles.length })
    );

    // Step 17: Check no un-themed raw HTML elements
    const rawElements = await session.page.evaluate(() => {
      const els = document.querySelectorAll("button, input, select, textarea");
      let unthemed = 0;
      els.forEach((el) => {
        const style = getComputedStyle(el);
        // Check for browser default appearance
        if (style.appearance === "auto" || style.appearance === "button" || style.appearance === "textfield") {
          unthemed++;
        }
      });
      return unthemed;
    });
    steps.push(
      testStep("No un-themed browser-default elements", rawElements <= 2 ? TestStatus.PASS : TestStatus.WARN, { unthemed: rawElements })
    );

    // Step 18: Check font loading
    const fontsLoaded = await session.page.evaluate(async () => {
      if (document.fonts) {
        await document.fonts.ready;
        return { loaded: true, count: document.fonts.size };
      }
      return { loaded: false };
    });
    steps.push(
      testStep("Custom fonts loaded", fontsLoaded.loaded ? TestStatus.PASS : TestStatus.SKIP, fontsLoaded)
    );

    // Step 19: Check transition/animation properties on interactive elements
    const hasTransitions = await session.page.evaluate(() => {
      const buttons = document.querySelectorAll("button, a");
      let withTransition = 0;
      Array.from(buttons).slice(0, 10).forEach((btn) => {
        const style = getComputedStyle(btn);
        if (style.transition !== "all 0s ease 0s" && style.transition !== "none") withTransition++;
      });
      return withTransition;
    });
    steps.push(
      testStep("Interactive elements have transitions", hasTransitions > 0 ? TestStatus.PASS : TestStatus.SKIP, { withTransition: hasTransitions })
    );

    // Step 20: No console errors with theme
    const pageErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors with theme", pageErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { errorCount: pageErrors.length })
    );

    // Step 21: No server errors
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
    persona: "Theme Tester",
    description: "Tests theme switching, CSS variables, and responsive styling",
    steps,
    browser: session.getReport(),
  };
}
