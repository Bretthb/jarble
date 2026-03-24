/**
 * Persona 04: Mobile User
 * Mobile viewport (375x812) testing across all key flows — homepage, login, chat, dashboard, settings.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds, Viewports } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runMobileUser({ baseUrl, config = {} }) {
  const session = new BrowserSession("04-mobile-user", {
    viewport: Viewports.MOBILE,
    isMobile: true,
  });
  const steps = [];

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    const viewportWidth = 375;

    // Step 1: Load homepage on mobile
    const loadTime = await session.navigate(baseUrl);
    steps.push(
      testStep("Homepage loads (mobile)", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms`, viewport: "375x812" })
    );
    await session.page.waitForTimeout(3000);
    await session.screenshot("mobile-homepage");

    // Step 2: Check no horizontal overflow on homepage
    const homeBodyWidth = await session.page.evaluate(() => document.body.scrollWidth);
    steps.push(
      testStep("No horizontal overflow (homepage)", homeBodyWidth <= viewportWidth + 5 ? TestStatus.PASS : TestStatus.FAIL, { bodyWidth: homeBodyWidth, viewportWidth })
    );

    // Step 3: Hero text visible on mobile
    const heroText = await session.safeTextContent("h2");
    steps.push(
      testStep("Hero text visible on mobile", heroText && heroText.trim().length > 0 ? TestStatus.PASS : TestStatus.FAIL, { text: heroText?.slice(0, 60) })
    );

    // Step 4: Mobile navigation accessible
    const hasMobileNav = await session.exists(
      'button[aria-label*="menu"], button[aria-label*="nav"], [data-testid="mobile-menu"], button[class*="hamburger"], nav button'
    );
    steps.push(
      testStep("Mobile navigation accessible", hasMobileNav ? TestStatus.PASS : TestStatus.WARN, { note: "Hamburger or mobile nav toggle expected" })
    );

    // Step 5: Dashboard on mobile
    const dashLoadTime = await session.navigate(`${baseUrl}/dashboard`);
    steps.push(
      testStep("Dashboard loads (mobile)", dashLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${dashLoadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("mobile-dashboard");

    // Step 6: No horizontal overflow on dashboard
    const dashBodyWidth = await session.page.evaluate(() => document.body.scrollWidth);
    steps.push(
      testStep("No horizontal overflow (dashboard)", dashBodyWidth <= viewportWidth + 5 ? TestStatus.PASS : TestStatus.WARN, { bodyWidth: dashBodyWidth })
    );

    // Step 7: Chat page on mobile
    const chatLoadTime = await session.navigate(`${baseUrl}/d/demo`);
    steps.push(
      testStep("Chat page loads (mobile)", chatLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${chatLoadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("mobile-chat");

    // Step 8: Verify chat is full-width on mobile
    const chatInput = await session.page.$('textarea, [role="textbox"], [contenteditable="true"]');
    if (chatInput) {
      const chatBox = await chatInput.boundingBox();
      const isFull = chatBox && chatBox.width >= viewportWidth * 0.7;
      steps.push(
        testStep("Chat input full-width on mobile", isFull ? TestStatus.PASS : TestStatus.WARN, { width: chatBox?.width })
      );
    } else {
      steps.push(testStep("Chat input full-width on mobile", TestStatus.SKIP));
    }

    // Step 9: Verify canvas is hidden or collapsed on mobile
    const canvasVisible = await session.page.evaluate(() => {
      const canvas = document.querySelector('[class*="canvas"], [class*="Canvas"], [class*="SimpleCanvasGrid"]');
      if (!canvas) return false;
      const rect = canvas.getBoundingClientRect();
      return rect.width > 50 && rect.height > 50;
    });
    steps.push(
      testStep("Canvas hidden/collapsed on mobile", !canvasVisible ? TestStatus.PASS : TestStatus.WARN, { canvasVisible })
    );

    // Step 10: Settings page on mobile
    const settingsLoadTime = await session.navigate(`${baseUrl}/settings`);
    steps.push(
      testStep("Settings page loads (mobile)", settingsLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${settingsLoadTime}ms` })
    );
    await session.screenshot("mobile-settings");

    // Step 11: No horizontal overflow on settings
    const settingsBodyWidth = await session.page.evaluate(() => document.body.scrollWidth);
    steps.push(
      testStep("No horizontal overflow (settings)", settingsBodyWidth <= viewportWidth + 5 ? TestStatus.PASS : TestStatus.WARN, { bodyWidth: settingsBodyWidth })
    );

    // Step 12: Pricing page on mobile
    const pricingLoadTime = await session.navigate(`${baseUrl}/pricing`);
    steps.push(
      testStep("Pricing page loads (mobile)", pricingLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${pricingLoadTime}ms` })
    );
    await session.screenshot("mobile-pricing");

    // Step 13: No horizontal overflow on pricing
    const pricingBodyWidth = await session.page.evaluate(() => document.body.scrollWidth);
    steps.push(
      testStep("No horizontal overflow (pricing)", pricingBodyWidth <= viewportWidth + 5 ? TestStatus.PASS : TestStatus.WARN, { bodyWidth: pricingBodyWidth })
    );

    // Step 14: Marketplace on mobile
    const marketplaceLoadTime = await session.navigate(`${baseUrl}/marketplace`);
    steps.push(
      testStep("Marketplace loads (mobile)", marketplaceLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${marketplaceLoadTime}ms` })
    );
    await session.screenshot("mobile-marketplace");

    // Step 15: Touch targets >= 44px across all visited pages
    await session.navigate(baseUrl);
    await session.page.waitForTimeout(2000);
    const smallButtons = await session.page.evaluate(() => {
      const buttons = document.querySelectorAll("button, a, [role='button']");
      let tooSmall = 0;
      let total = 0;
      buttons.forEach((b) => {
        const rect = b.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          total++;
          if (rect.width < 44 || rect.height < 44) tooSmall++;
        }
      });
      return { total, tooSmall };
    });
    steps.push(
      testStep("Touch targets >= 44px", smallButtons.tooSmall <= 3 ? TestStatus.PASS : TestStatus.WARN, { tooSmall: smallButtons.tooSmall, total: smallButtons.total })
    );

    // Step 16: Font sizes readable (>= 14px)
    const smallFonts = await session.page.evaluate(() => {
      const elements = document.querySelectorAll("p, span, a, li, td, label, button");
      let tooSmall = 0;
      let total = 0;
      elements.forEach((el) => {
        const style = window.getComputedStyle(el);
        const fontSize = parseFloat(style.fontSize);
        if (fontSize > 0) {
          total++;
          if (fontSize < 14) tooSmall++;
        }
      });
      return { total, tooSmall };
    });
    steps.push(
      testStep("Font sizes readable (>= 14px)", smallFonts.tooSmall <= 5 ? TestStatus.PASS : TestStatus.WARN, { tooSmall: smallFonts.tooSmall, total: smallFonts.total })
    );

    // Step 17: Form inputs full-width on mobile
    const formInputCheck = await session.page.evaluate(() => {
      const inputs = document.querySelectorAll("input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea, select");
      let total = 0;
      let narrow = 0;
      inputs.forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0) {
          total++;
          if (rect.width < 200) narrow++;
        }
      });
      return { total, narrow };
    });
    steps.push(
      testStep("Form inputs adequately wide on mobile", formInputCheck.narrow === 0 ? TestStatus.PASS : TestStatus.WARN, formInputCheck)
    );

    // Step 18: No overlapping elements
    const overlapCheck = await session.page.evaluate(() => {
      const elements = document.querySelectorAll("button, a, input, select, textarea");
      const rects = Array.from(elements).map((el) => el.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
      let overlaps = 0;
      for (let i = 0; i < rects.length && i < 50; i++) {
        for (let j = i + 1; j < rects.length && j < 50; j++) {
          const a = rects[i], b = rects[j];
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
            const overlapArea = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
              Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
            if (overlapArea > 100) overlaps++;
          }
        }
      }
      return overlaps;
    });
    steps.push(
      testStep("No significantly overlapping elements", overlapCheck <= 2 ? TestStatus.PASS : TestStatus.WARN, { overlaps: overlapCheck })
    );

    // Step 19: About page on mobile
    const aboutLoadTime = await session.navigate(`${baseUrl}/about`);
    steps.push(
      testStep("About page loads (mobile)", aboutLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${aboutLoadTime}ms` })
    );
    await session.screenshot("mobile-about");

    // Step 20: Onboarding wizard on mobile
    const wizardLoadTime = await session.navigate(`${baseUrl}/onboarding/new`);
    steps.push(
      testStep("Onboarding wizard loads (mobile)", wizardLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${wizardLoadTime}ms` })
    );
    await session.screenshot("mobile-wizard");

    // Step 21: No console errors on mobile
    const errors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors (mobile)", errors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { count: errors.length })
    );

    // Step 22: No server errors
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
    persona: "Mobile User",
    description: "Mobile viewport testing across key flows",
    steps,
    browser: session.getReport(),
  };
}
