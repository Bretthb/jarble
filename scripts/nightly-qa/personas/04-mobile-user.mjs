/**
 * Persona 04: Mobile User
 * Mobile viewport (375x812) testing across key flows — homepage, login, chat, dashboard.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds, Viewports } from "../lib/types.mjs";

export default async function runMobileUser({ baseUrl }) {
  const session = new BrowserSession("04-mobile-user", {
    viewport: Viewports.MOBILE,
    isMobile: true,
  });
  const steps = [];

  try {
    await session.start();

    // Step 1: Load homepage on mobile
    const loadTime = await session.navigate(baseUrl);
    steps.push(
      testStep("Homepage loads (mobile)", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms`, viewport: "375x812" })
    );
    await session.page.waitForTimeout(3000);
    await session.screenshot("mobile-homepage");

    // Step 2: Check no horizontal overflow
    const bodyWidth = await session.page.evaluate(() => document.body.scrollWidth);
    const viewportWidth = 375;
    steps.push(
      testStep(
        "No horizontal overflow",
        bodyWidth <= viewportWidth + 5 ? TestStatus.PASS : TestStatus.FAIL,
        { bodyWidth, viewportWidth }
      )
    );

    // Step 3: Check hero is readable on mobile
    const heroText = await session.safeTextContent("h2");
    steps.push(
      testStep("Hero text visible on mobile", heroText && heroText.trim().length > 0 ? TestStatus.PASS : TestStatus.FAIL, { text: heroText?.slice(0, 60) })
    );

    // Step 4: Check mobile navigation (hamburger menu or similar)
    const hasMobileNav = await session.exists(
      'button[aria-label*="menu"], button[aria-label*="nav"], [data-testid="mobile-menu"], button[class*="hamburger"], nav button'
    );
    steps.push(
      testStep("Mobile navigation accessible", hasMobileNav ? TestStatus.PASS : TestStatus.WARN, {
        note: "Hamburger or mobile nav toggle expected",
      })
    );

    // Step 5: Navigate to dashboard on mobile
    const dashLoadTime = await session.navigate(`${baseUrl}/dashboard`);
    steps.push(
      testStep("Dashboard loads (mobile)", dashLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${dashLoadTime}ms` })
    );
    await session.screenshot("mobile-dashboard");

    // Step 6: Navigate to chat page on mobile
    const chatLoadTime = await session.navigate(`${baseUrl}/d/demo`);
    steps.push(
      testStep("Chat page loads (mobile)", chatLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${chatLoadTime}ms` })
    );
    await session.screenshot("mobile-chat");

    // Step 7: Touch-friendly tap targets (check button sizes)
    const smallButtons = await session.page.evaluate(() => {
      const buttons = document.querySelectorAll("button, a, [role='button']");
      let tooSmall = 0;
      buttons.forEach((b) => {
        const rect = b.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && (rect.width < 44 || rect.height < 44)) {
          tooSmall++;
        }
      });
      return { total: buttons.length, tooSmall };
    });
    steps.push(
      testStep(
        "Touch targets >= 44px",
        smallButtons.tooSmall <= 3 ? TestStatus.PASS : TestStatus.WARN,
        { tooSmall: smallButtons.tooSmall, total: smallButtons.total }
      )
    );

    // Step 8: No console errors on mobile
    const errors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors (mobile)", errors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { count: errors.length })
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Mobile User",
    description: "Mobile viewport testing across key flows",
    steps,
    browser: session.getReport(),
  };
}
