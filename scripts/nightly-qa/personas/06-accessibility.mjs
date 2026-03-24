/**
 * Persona 06: Accessibility
 * Keyboard navigation, ARIA landmarks, focus management, color contrast.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus } from "../lib/types.mjs";

export default async function runAccessibility({ baseUrl }) {
  const session = new BrowserSession("06-accessibility");
  const steps = [];

  try {
    await session.start();
    await session.navigate(baseUrl);

    // Step 1: Check ARIA landmarks
    const landmarks = await session.page.evaluate(() => {
      const roles = ["banner", "navigation", "main", "contentinfo"];
      const found = {};
      roles.forEach((role) => {
        found[role] =
          document.querySelector(`[role="${role}"]`) !== null ||
          document.querySelector(
            role === "banner" ? "header" :
            role === "navigation" ? "nav" :
            role === "main" ? "main" :
            "footer"
          ) !== null;
      });
      return found;
    });
    const landmarkCount = Object.values(landmarks).filter(Boolean).length;
    steps.push(
      testStep(
        "ARIA landmarks present",
        landmarkCount >= 2 ? TestStatus.PASS : landmarkCount >= 1 ? TestStatus.WARN : TestStatus.FAIL,
        landmarks
      )
    );

    // Step 2: Check all images have alt text
    const imgAudit = await session.page.evaluate(() => {
      const images = document.querySelectorAll("img");
      let total = 0;
      let missingAlt = 0;
      images.forEach((img) => {
        total++;
        if (!img.hasAttribute("alt")) missingAlt++;
      });
      return { total, missingAlt };
    });
    steps.push(
      testStep(
        "Images have alt text",
        imgAudit.missingAlt === 0 ? TestStatus.PASS : TestStatus.WARN,
        imgAudit
      )
    );

    // Step 3: Tab key navigation works
    const tabResults = await session.page.evaluate(() => {
      const focusable = [];
      // Simulate tab through first 10 focusable elements
      const elements = document.querySelectorAll(
        'a[href], button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
      );
      elements.forEach((el, i) => {
        if (i < 10) {
          focusable.push({
            tag: el.tagName.toLowerCase(),
            text: (el.textContent || "").trim().slice(0, 30),
            hasTabIndex: el.hasAttribute("tabindex"),
          });
        }
      });
      return { total: elements.length, sample: focusable };
    });
    steps.push(
      testStep(
        "Focusable elements exist for tab navigation",
        tabResults.total > 0 ? TestStatus.PASS : TestStatus.FAIL,
        { focusableCount: tabResults.total }
      )
    );

    // Step 4: Check heading hierarchy (h1 -> h2 -> h3, no skips)
    const headings = await session.page.evaluate(() => {
      const hs = [];
      document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
        hs.push({ level: parseInt(h.tagName[1]), text: h.textContent.trim().slice(0, 40) });
      });
      return hs;
    });
    let headingOrderCorrect = true;
    for (let i = 1; i < headings.length; i++) {
      if (headings[i].level > headings[i - 1].level + 1) {
        headingOrderCorrect = false;
        break;
      }
    }
    steps.push(
      testStep(
        "Heading hierarchy is correct",
        headingOrderCorrect ? TestStatus.PASS : TestStatus.WARN,
        { headingCount: headings.length, levels: headings.map((h) => `h${h.level}`).join(", ") }
      )
    );
    await session.screenshot("accessibility-homepage");

    // Step 5: Check form labels
    const formAudit = await session.page.evaluate(() => {
      const inputs = document.querySelectorAll("input, textarea, select");
      let total = 0;
      let unlabeled = 0;
      inputs.forEach((input) => {
        if (input.type === "hidden") return;
        total++;
        const id = input.id;
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const hasAriaLabel = input.hasAttribute("aria-label") || input.hasAttribute("aria-labelledby");
        const wrappedInLabel = input.closest("label") !== null;
        const hasPlaceholder = input.hasAttribute("placeholder");
        if (!hasLabel && !hasAriaLabel && !wrappedInLabel && !hasPlaceholder) {
          unlabeled++;
        }
      });
      return { total, unlabeled };
    });
    steps.push(
      testStep(
        "Form inputs have labels",
        formAudit.unlabeled === 0 ? TestStatus.PASS : TestStatus.WARN,
        formAudit
      )
    );

    // Step 6: Check color contrast (basic check for very low contrast text)
    const contrastIssues = await session.page.evaluate(() => {
      let issues = 0;
      const textElements = document.querySelectorAll("p, span, a, h1, h2, h3, h4, h5, h6, li, td, th, label, button");
      const sample = Array.from(textElements).slice(0, 50);
      sample.forEach((el) => {
        const style = window.getComputedStyle(el);
        const color = style.color;
        const bg = style.backgroundColor;
        // Very basic: flag if text color equals background color
        if (color === bg && color !== "rgba(0, 0, 0, 0)") {
          issues++;
        }
      });
      return issues;
    });
    steps.push(
      testStep(
        "No zero-contrast text",
        contrastIssues === 0 ? TestStatus.PASS : TestStatus.FAIL,
        { issues: contrastIssues }
      )
    );

    // Step 7: Check skip-to-content link
    const hasSkipLink = await session.exists(
      'a[href="#main"], a[href="#content"], a[class*="skip"], .skip-link, [class*="skip-to"]'
    );
    steps.push(
      testStep("Skip-to-content link", hasSkipLink ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 8: Check buttons have accessible names
    const buttonAudit = await session.page.evaluate(() => {
      const buttons = document.querySelectorAll("button, [role='button']");
      let total = 0;
      let unnamed = 0;
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
      testStep(
        "Buttons have accessible names",
        buttonAudit.unnamed === 0 ? TestStatus.PASS : TestStatus.WARN,
        buttonAudit
      )
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
