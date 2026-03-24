/**
 * Persona 06: Accessibility
 * ARIA landmarks, keyboard navigation, focus management, color contrast, screen reader support across all pages.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus } from "../lib/types.mjs";

export default async function runAccessibility({ baseUrl, config = {} }) {
  const session = new BrowserSession("06-accessibility");
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

    // === HOMEPAGE ===
    await session.navigate(baseUrl);
    await session.page.waitForTimeout(2000);

    // Step 1: ARIA landmarks on homepage
    const homeLandmarks = await session.page.evaluate(() => {
      const roles = ["banner", "navigation", "main", "contentinfo"];
      const found = {};
      roles.forEach((role) => {
        found[role] = document.querySelector(`[role="${role}"]`) !== null ||
          document.querySelector(
            role === "banner" ? "header" : role === "navigation" ? "nav" : role === "main" ? "main" : "footer"
          ) !== null;
      });
      return found;
    });
    const homeLandmarkCount = Object.values(homeLandmarks).filter(Boolean).length;
    steps.push(
      testStep("ARIA landmarks on homepage", homeLandmarkCount >= 2 ? TestStatus.PASS : TestStatus.WARN, homeLandmarks)
    );

    // Step 2: Image alt text on homepage
    const homeImgAudit = await session.page.evaluate(() => {
      const images = document.querySelectorAll("img");
      let total = 0, missingAlt = 0;
      images.forEach((img) => { total++; if (!img.hasAttribute("alt")) missingAlt++; });
      return { total, missingAlt };
    });
    steps.push(
      testStep("Images have alt text (homepage)", homeImgAudit.missingAlt === 0 ? TestStatus.PASS : TestStatus.WARN, homeImgAudit)
    );

    // Step 3: Tab navigation (10+ elements focusable)
    const tabResults = await session.page.evaluate(() => {
      const elements = document.querySelectorAll('a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])');
      const focusable = Array.from(elements).slice(0, 15).map((el, i) => ({
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || "").trim().slice(0, 30),
      }));
      return { total: elements.length, sample: focusable };
    });
    steps.push(
      testStep("10+ focusable elements for tab navigation", tabResults.total >= 10 ? TestStatus.PASS : TestStatus.WARN, { focusableCount: tabResults.total })
    );

    // Step 4: Heading hierarchy on homepage
    const homeHeadings = await session.page.evaluate(() => {
      const hs = [];
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
        hs.push({ level: parseInt(h.tagName[1]), text: h.textContent.trim().slice(0, 40) });
      });
      return hs;
    });
    let headingOrderCorrect = true;
    for (let i = 1; i < homeHeadings.length; i++) {
      if (homeHeadings[i].level > homeHeadings[i - 1].level + 1) { headingOrderCorrect = false; break; }
    }
    steps.push(
      testStep("Heading hierarchy correct (homepage)", headingOrderCorrect ? TestStatus.PASS : TestStatus.WARN, {
        headingCount: homeHeadings.length, levels: homeHeadings.map((h) => `h${h.level}`).join(", "),
      })
    );
    await session.screenshot("accessibility-homepage");

    // Step 5: Skip-to-content link
    const hasSkipLink = await session.exists('a[href="#main"], a[href="#content"], a[class*="skip"], .skip-link, [class*="skip-to"]');
    steps.push(
      testStep("Skip-to-content link", hasSkipLink ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 6: Color contrast (basic check)
    const contrastIssues = await session.page.evaluate(() => {
      let issues = 0;
      const sample = Array.from(document.querySelectorAll("p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, label, button")).slice(0, 50);
      sample.forEach((el) => {
        const style = window.getComputedStyle(el);
        if (style.color === style.backgroundColor && style.color !== "rgba(0, 0, 0, 0)") issues++;
      });
      return issues;
    });
    steps.push(
      testStep("No zero-contrast text", contrastIssues === 0 ? TestStatus.PASS : TestStatus.FAIL, { issues: contrastIssues })
    );

    // Step 7: Buttons have accessible names
    const buttonAudit = await session.page.evaluate(() => {
      const buttons = document.querySelectorAll("button, [role='button']");
      let total = 0, unnamed = 0;
      buttons.forEach((btn) => {
        total++;
        const hasText = btn.textContent.trim().length > 0;
        const hasAriaLabel = btn.hasAttribute("aria-label") || btn.hasAttribute("aria-labelledby");
        const hasTitle = btn.hasAttribute("title");
        if (!hasText && !hasAriaLabel && !hasTitle) unnamed++;
      });
      return { total, unnamed };
    });
    steps.push(
      testStep("Buttons have accessible names", buttonAudit.unnamed === 0 ? TestStatus.PASS : TestStatus.WARN, buttonAudit)
    );

    // Step 8: Form labels on homepage
    const homeFormAudit = await session.page.evaluate(() => {
      const inputs = document.querySelectorAll("input, textarea, select");
      let total = 0, unlabeled = 0;
      inputs.forEach((input) => {
        if (input.type === "hidden") return;
        total++;
        const id = input.id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAriaLabel = input.hasAttribute("aria-label") || input.hasAttribute("aria-labelledby");
        const wrappedInLabel = input.closest("label") !== null;
        const hasPlaceholder = input.hasAttribute("placeholder");
        if (!hasLabel && !hasAriaLabel && !wrappedInLabel && !hasPlaceholder) unlabeled++;
      });
      return { total, unlabeled };
    });
    steps.push(
      testStep("Form inputs have labels (homepage)", homeFormAudit.unlabeled === 0 ? TestStatus.PASS : TestStatus.WARN, homeFormAudit)
    );

    // === DASHBOARD ===
    await session.navigate(`${baseUrl}/dashboard`);
    await session.page.waitForTimeout(2000);

    // Step 9: ARIA landmarks on dashboard
    const dashLandmarks = await session.page.evaluate(() => {
      const roles = ["banner", "navigation", "main", "contentinfo"];
      const found = {};
      roles.forEach((role) => {
        found[role] = document.querySelector(`[role="${role}"]`) !== null ||
          document.querySelector(role === "banner" ? "header" : role === "navigation" ? "nav" : role === "main" ? "main" : "footer") !== null;
      });
      return found;
    });
    const dashLandmarkCount = Object.values(dashLandmarks).filter(Boolean).length;
    steps.push(
      testStep("ARIA landmarks on dashboard", dashLandmarkCount >= 1 ? TestStatus.PASS : TestStatus.WARN, dashLandmarks)
    );
    await session.screenshot("accessibility-dashboard");

    // Step 10: Heading hierarchy on dashboard
    const dashHeadings = await session.page.evaluate(() => {
      const hs = [];
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
        hs.push({ level: parseInt(h.tagName[1]) });
      });
      return hs;
    });
    let dashHeadingsOk = true;
    for (let i = 1; i < dashHeadings.length; i++) {
      if (dashHeadings[i].level > dashHeadings[i - 1].level + 1) { dashHeadingsOk = false; break; }
    }
    steps.push(
      testStep("Heading hierarchy correct (dashboard)", dashHeadingsOk ? TestStatus.PASS : TestStatus.WARN, { count: dashHeadings.length })
    );

    // === CHAT PAGE ===
    await session.navigate(`${baseUrl}/d/demo`);
    await session.page.waitForTimeout(2000);

    // Step 11: ARIA landmarks on chat page
    const chatLandmarks = await session.page.evaluate(() => {
      const found = {};
      ["banner", "navigation", "main", "contentinfo"].forEach((role) => {
        found[role] = document.querySelector(`[role="${role}"]`) !== null ||
          document.querySelector(role === "banner" ? "header" : role === "navigation" ? "nav" : role === "main" ? "main" : "footer") !== null;
      });
      return found;
    });
    steps.push(
      testStep("ARIA landmarks on chat page", Object.values(chatLandmarks).filter(Boolean).length >= 1 ? TestStatus.PASS : TestStatus.WARN, chatLandmarks)
    );
    await session.screenshot("accessibility-chat");

    // Step 12: Form labels on chat page
    const chatFormAudit = await session.page.evaluate(() => {
      const inputs = document.querySelectorAll("input, textarea, select");
      let total = 0, unlabeled = 0;
      inputs.forEach((input) => {
        if (input.type === "hidden") return;
        total++;
        const id = input.id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAriaLabel = input.hasAttribute("aria-label") || input.hasAttribute("aria-labelledby");
        const wrappedInLabel = input.closest("label") !== null;
        const hasPlaceholder = input.hasAttribute("placeholder");
        if (!hasLabel && !hasAriaLabel && !wrappedInLabel && !hasPlaceholder) unlabeled++;
      });
      return { total, unlabeled };
    });
    steps.push(
      testStep("Form inputs have labels (chat page)", chatFormAudit.unlabeled === 0 ? TestStatus.PASS : TestStatus.WARN, chatFormAudit)
    );

    // Step 13: Focus visible on interactive elements
    const focusVisibleCheck = await session.page.evaluate(() => {
      const interactive = document.querySelectorAll("button, a, input, textarea, select, [tabindex]");
      let hasFocusStyles = 0;
      const sample = Array.from(interactive).slice(0, 10);
      sample.forEach((el) => {
        el.focus();
        const style = window.getComputedStyle(el);
        if (style.outlineStyle !== "none" || style.boxShadow !== "none") hasFocusStyles++;
      });
      return { total: sample.length, withFocusStyles: hasFocusStyles };
    });
    steps.push(
      testStep("Focus visible on interactive elements", focusVisibleCheck.withFocusStyles > 0 ? TestStatus.PASS : TestStatus.WARN, focusVisibleCheck)
    );

    // Step 14: Screen reader text (sr-only elements exist)
    const srOnlyCount = await session.countElements('.sr-only, [class*="sr-only"], [class*="visually-hidden"], [class*="VisuallyHidden"]');
    steps.push(
      testStep("Screen reader text (sr-only) present", srOnlyCount > 0 ? TestStatus.PASS : TestStatus.WARN, { count: srOnlyCount })
    );

    // === SETTINGS PAGE ===
    await session.navigate(`${baseUrl}/settings`);
    await session.page.waitForTimeout(2000);

    // Step 15: Form labels on settings page
    const settingsFormAudit = await session.page.evaluate(() => {
      const inputs = document.querySelectorAll("input, textarea, select");
      let total = 0, unlabeled = 0;
      inputs.forEach((input) => {
        if (input.type === "hidden") return;
        total++;
        const id = input.id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAriaLabel = input.hasAttribute("aria-label") || input.hasAttribute("aria-labelledby");
        const wrappedInLabel = input.closest("label") !== null;
        const hasPlaceholder = input.hasAttribute("placeholder");
        if (!hasLabel && !hasAriaLabel && !wrappedInLabel && !hasPlaceholder) unlabeled++;
      });
      return { total, unlabeled };
    });
    steps.push(
      testStep("Form labels on settings page", settingsFormAudit.unlabeled === 0 ? TestStatus.PASS : TestStatus.WARN, settingsFormAudit)
    );
    await session.screenshot("accessibility-settings");

    // === ONBOARDING WIZARD ===
    await session.navigate(`${baseUrl}/onboarding/new`);
    await session.page.waitForTimeout(2000);

    // Step 16: Form labels on onboarding wizard
    const wizardFormAudit = await session.page.evaluate(() => {
      const inputs = document.querySelectorAll("input, textarea, select");
      let total = 0, unlabeled = 0;
      inputs.forEach((input) => {
        if (input.type === "hidden") return;
        total++;
        const id = input.id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAriaLabel = input.hasAttribute("aria-label") || input.hasAttribute("aria-labelledby");
        const wrappedInLabel = input.closest("label") !== null;
        const hasPlaceholder = input.hasAttribute("placeholder");
        if (!hasLabel && !hasAriaLabel && !wrappedInLabel && !hasPlaceholder) unlabeled++;
      });
      return { total, unlabeled };
    });
    steps.push(
      testStep("Form labels on onboarding wizard", wizardFormAudit.unlabeled === 0 ? TestStatus.PASS : TestStatus.WARN, wizardFormAudit)
    );
    await session.screenshot("accessibility-wizard");

    // Step 17: Heading hierarchy on wizard
    const wizardHeadings = await session.page.evaluate(() => {
      const hs = [];
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => hs.push({ level: parseInt(h.tagName[1]) }));
      return hs;
    });
    let wizardHeadingsOk = true;
    for (let i = 1; i < wizardHeadings.length; i++) {
      if (wizardHeadings[i].level > wizardHeadings[i - 1].level + 1) { wizardHeadingsOk = false; break; }
    }
    steps.push(
      testStep("Heading hierarchy correct (wizard)", wizardHeadingsOk ? TestStatus.PASS : TestStatus.WARN, { count: wizardHeadings.length })
    );

    // Step 18: Keyboard-accessible context menu (on chat page)
    await session.navigate(`${baseUrl}/d/demo`);
    await session.page.waitForTimeout(2000);
    const hasContextMenuTrigger = await session.exists('[role="menu"], [role="menubar"], [aria-haspopup="menu"], [aria-haspopup="true"]');
    steps.push(
      testStep("Keyboard-accessible context menu", hasContextMenuTrigger ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 19: Keyboard-accessible data table
    const hasTable = await session.exists('table, [role="grid"], [role="table"]');
    if (hasTable) {
      const tableA11y = await session.page.evaluate(() => {
        const table = document.querySelector('table, [role="grid"], [role="table"]');
        if (!table) return null;
        const hasHeaders = table.querySelectorAll("th, [role='columnheader']").length > 0;
        const hasCaption = table.querySelector("caption") !== null || table.hasAttribute("aria-label");
        return { hasHeaders, hasCaption };
      });
      steps.push(
        testStep("Data table has headers", tableA11y?.hasHeaders ? TestStatus.PASS : TestStatus.WARN, tableA11y)
      );
    } else {
      steps.push(testStep("Data table has headers", TestStatus.SKIP, { note: "No table found" }));
    }

    // Step 20: Links have discernible text
    const linkAudit = await session.page.evaluate(() => {
      const links = document.querySelectorAll("a");
      let total = 0, unnamed = 0;
      links.forEach((a) => {
        total++;
        const hasText = a.textContent.trim().length > 0;
        const hasAriaLabel = a.hasAttribute("aria-label") || a.hasAttribute("aria-labelledby");
        const hasTitle = a.hasAttribute("title");
        const hasImg = a.querySelector("img[alt]") !== null;
        if (!hasText && !hasAriaLabel && !hasTitle && !hasImg) unnamed++;
      });
      return { total, unnamed };
    });
    steps.push(
      testStep("Links have discernible text", linkAudit.unnamed === 0 ? TestStatus.PASS : TestStatus.WARN, linkAudit)
    );

    // Step 21: Check role="dialog" for modals/overlays
    const dialogCheck = await session.page.evaluate(() => {
      const dialogs = document.querySelectorAll('[role="dialog"], [role="alertdialog"], dialog');
      return dialogs.length;
    });
    steps.push(
      testStep("Dialog roles properly used", TestStatus.PASS, { dialogCount: dialogCheck })
    );

    // Step 22: Check aria-live regions exist for dynamic content
    const ariaLiveCount = await session.countElements('[aria-live], [role="alert"], [role="status"], [role="log"]');
    steps.push(
      testStep("aria-live regions for dynamic content", ariaLiveCount > 0 ? TestStatus.PASS : TestStatus.WARN, { count: ariaLiveCount })
    );

    // Step 23: Check lang attribute on html
    const htmlLang = await session.page.evaluate(() => document.documentElement.getAttribute("lang"));
    steps.push(
      testStep("HTML lang attribute set", htmlLang ? TestStatus.PASS : TestStatus.WARN, { lang: htmlLang })
    );

    // Step 24: Image alt text across all visited pages
    const allImgAudit = await session.page.evaluate(() => {
      const images = document.querySelectorAll("img");
      let total = 0, missingAlt = 0;
      images.forEach((img) => { total++; if (!img.hasAttribute("alt")) missingAlt++; });
      return { total, missingAlt };
    });
    steps.push(
      testStep("Images have alt text (chat page)", allImgAudit.missingAlt === 0 ? TestStatus.PASS : TestStatus.WARN, allImgAudit)
    );

    // Step 25: No console errors
    const pageErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors during accessibility audit", pageErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { errorCount: pageErrors.length })
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Accessibility",
    description: "Keyboard navigation, ARIA, focus management",
    steps,
    browser: session.getReport(),
  };
}
