/**
 * Persona 02: Business User
 * Non-technical user exploring dashboards, billing page, and settings.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runBusinessUser({ baseUrl }) {
  const session = new BrowserSession("02-business-user");
  const steps = [];

  try {
    await session.start();

    // Step 1: Load homepage
    const loadTime = await session.navigate(baseUrl);
    steps.push(
      testStep("Homepage loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );

    // Step 2: Navigate to dashboard
    const dashLoadTime = await session.navigate(`${baseUrl}/dashboard`);
    steps.push(
      testStep("Dashboard page loads", dashLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${dashLoadTime}ms` })
    );
    await session.screenshot("dashboard");

    // Step 3: Check for dashboard content or login redirect
    const currentUrl = session.page.url();
    const onDashboard = currentUrl.includes("dashboard");
    const redirectedToLogin = currentUrl.includes("login") || currentUrl.includes("auth0");
    steps.push(
      testStep(
        "Dashboard accessible or auth redirect",
        onDashboard || redirectedToLogin ? TestStatus.PASS : TestStatus.FAIL,
        { url: currentUrl }
      )
    );

    // Step 4: Navigate to billing/pricing
    const billingLoadTime = await session.navigate(`${baseUrl}/pricing`);
    steps.push(
      testStep("Pricing page loads", billingLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${billingLoadTime}ms` })
    );
    await session.screenshot("pricing");

    // Step 5: Check pricing page content
    const pricingText = await session.safeTextContent("body");
    const hasPricingContent = pricingText && (
      pricingText.toLowerCase().includes("price") ||
      pricingText.toLowerCase().includes("plan") ||
      pricingText.toLowerCase().includes("billing") ||
      pricingText.toLowerCase().includes("free")
    );
    steps.push(
      testStep("Pricing page has relevant content", hasPricingContent ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 6: Navigate to settings
    const settingsLoadTime = await session.navigate(`${baseUrl}/settings`);
    steps.push(
      testStep("Settings page loads", settingsLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${settingsLoadTime}ms` })
    );
    await session.screenshot("settings");

    // Step 7: Check for HTTP 500 errors
    const serverErrors = session.networkErrors.filter((e) => e.status >= 500);
    steps.push(
      testStep(
        "No server errors (5xx)",
        serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL,
        { count: serverErrors.length }
      )
    );

    // Step 8: Check overall console errors
    const consoleErrors = session.consoleLogs.filter(
      (l) => l.type === "error" || l.type === "page_error"
    );
    steps.push(
      testStep(
        "Minimal console errors",
        consoleErrors.length <= 2 ? TestStatus.PASS : TestStatus.WARN,
        { count: consoleErrors.length }
      )
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Business User",
    description: "Non-technical user exploring dashboards and billing",
    steps,
    browser: session.getReport(),
  };
}
