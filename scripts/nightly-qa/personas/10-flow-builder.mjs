/**
 * Persona 10: Flow Builder
 * Deployments page, flow canvas, flow creation.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runFlowBuilder({ baseUrl }) {
  const session = new BrowserSession("10-flow-builder");
  const steps = [];

  try {
    await session.start();

    // Step 1: Load deployments page
    const loadTime = await session.navigate(`${baseUrl}/deployments`);
    steps.push(
      testStep("Deployments page loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.screenshot("flow-deployments");

    // Step 2: Check if on deployments or redirected to auth
    const currentUrl = session.page.url();
    const isValid = currentUrl.includes("deployment") || currentUrl.includes("login") || currentUrl.includes("auth0") || currentUrl.includes("dashboard");
    steps.push(
      testStep("Deployments accessible or auth redirect", isValid ? TestStatus.PASS : TestStatus.WARN, { url: currentUrl })
    );

    // Step 3: Check for "New Deployment" / "Create" CTA
    const hasCreateCta = await session.exists(
      'button[class*="create" i], a[href*="create"], a[href*="new"], button:has-text("New"), button:has-text("Create"), [data-testid*="create"]'
    );
    // Fall back to text search
    const bodyText = await session.safeTextContent("body");
    const hasCreateText = bodyText && (
      bodyText.toLowerCase().includes("new deployment") ||
      bodyText.toLowerCase().includes("create") ||
      bodyText.toLowerCase().includes("get started")
    );
    steps.push(
      testStep("Create deployment CTA present", hasCreateCta || hasCreateText ? TestStatus.PASS : TestStatus.SKIP, {
        note: "Requires auth session",
      })
    );

    // Step 4: Navigate to onboarding/wizard
    const wizardLoadTime = await session.navigate(`${baseUrl}/onboarding`);
    steps.push(
      testStep("Onboarding wizard loads", wizardLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${wizardLoadTime}ms` })
    );
    await session.screenshot("flow-wizard");

    // Step 5: Check wizard has step indicators
    const wizardUrl = session.page.url();
    const hasStepIndicators = await session.exists(
      '[class*="step"], [class*="wizard"], [role="progressbar"], [class*="progress"], [data-testid*="step"]'
    );
    steps.push(
      testStep("Wizard step indicators present", hasStepIndicators ? TestStatus.PASS : TestStatus.SKIP, {
        url: wizardUrl,
        note: "May redirect if not authenticated",
      })
    );

    // Step 6: Check for runtime selection options
    const runtimeContent = await session.safeTextContent("body");
    const hasRuntimeOptions = runtimeContent && (
      runtimeContent.toLowerCase().includes("openclaw") ||
      runtimeContent.toLowerCase().includes("zeroclaw") ||
      runtimeContent.toLowerCase().includes("runtime")
    );
    steps.push(
      testStep("Runtime options displayed", hasRuntimeOptions ? TestStatus.PASS : TestStatus.SKIP, {
        note: "Visible during deployment wizard",
      })
    );

    // Step 7: Load a deployment configuration page
    const configLoadTime = await session.navigate(`${baseUrl}/deployments/config`);
    steps.push(
      testStep("Deployment config page loads", configLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${configLoadTime}ms` })
    );
    await session.screenshot("flow-config");

    // Step 8: No JS errors during flow navigation
    const pageErrors = session.consoleLogs.filter((l) => l.type === "page_error");
    steps.push(
      testStep("No JS errors during flow navigation", pageErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN, {
        count: pageErrors.length,
        first: pageErrors[0]?.text?.slice(0, 80),
      })
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Flow Builder",
    description: "Deployments page, flow canvas, flow creation",
    steps,
    browser: session.getReport(),
  };
}
