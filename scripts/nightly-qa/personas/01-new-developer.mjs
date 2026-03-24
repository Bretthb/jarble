/**
 * Persona 01: New Developer
 * First-time user discovering the platform — homepage, login, first deployment wizard.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runNewDeveloper({ baseUrl }) {
  const session = new BrowserSession("01-new-developer");
  const steps = [];

  try {
    await session.start();

    // Step 1: Load homepage
    const loadTime = await session.navigate(baseUrl);
    steps.push(
      testStep(
        "Homepage loads",
        loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN,
        { loadTime: `${loadTime}ms` }
      )
    );
    await session.screenshot("homepage");

    // Step 2: Check hero content
    const heroText = await session.safeTextContent("h1");
    steps.push(
      testStep(
        "Hero heading visible",
        heroText && heroText.trim().length > 0 ? TestStatus.PASS : TestStatus.FAIL,
        { text: heroText?.slice(0, 80) }
      )
    );

    // Step 3: Check for primary CTA button
    const ctaExists = await session.exists('a[href*="login"], a[href*="signup"], button');
    steps.push(
      testStep(
        "Primary CTA button exists",
        ctaExists ? TestStatus.PASS : TestStatus.FAIL
      )
    );

    // Step 4: Navigate to login
    try {
      await session.page.click('a[href*="login"], a[href*="signup"]');
      await session.page.waitForTimeout(3000);
      steps.push(testStep("Login/signup navigation", TestStatus.PASS));
      await session.screenshot("login-page");
    } catch (err) {
      steps.push(
        testStep("Login/signup navigation", TestStatus.FAIL, { error: err.message })
      );
    }

    // Step 5: Check login page has form elements
    const hasInput = await session.exists('input[type="email"], input[type="text"], input');
    steps.push(
      testStep(
        "Login form inputs present",
        hasInput ? TestStatus.PASS : TestStatus.WARN,
        { note: "Auth0 may redirect externally" }
      )
    );

    // Step 6: Check for no console errors on homepage
    const pageErrors = session.consoleLogs.filter(
      (l) => l.type === "error" || l.type === "page_error"
    );
    steps.push(
      testStep(
        "No critical console errors",
        pageErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN,
        { errorCount: pageErrors.length }
      )
    );

    // Step 7: Check page title
    const title = await session.page.title();
    steps.push(
      testStep(
        "Page has a title",
        title && title.length > 0 ? TestStatus.PASS : TestStatus.WARN,
        { title }
      )
    );

    // Step 8: Check meta viewport
    const hasViewport = await session.exists('meta[name="viewport"]');
    steps.push(
      testStep(
        "Meta viewport tag present",
        hasViewport ? TestStatus.PASS : TestStatus.WARN
      )
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "New Developer",
    description: "First-time user discovering the platform",
    steps,
    browser: session.getReport(),
  };
}
