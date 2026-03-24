/**
 * Persona 02: Business User
 * Non-technical user exploring dashboards, billing, settings, deployment management.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runBusinessUser({ baseUrl, config = {} }) {
  const session = new BrowserSession("02-business-user");
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
    await session.page.waitForTimeout(2000);
    await session.screenshot("dashboard");

    // Step 3: Check dashboard accessible or auth redirect
    const dashUrl = session.page.url();
    const onDashboard = dashUrl.includes("dashboard");
    const redirectedToLogin = dashUrl.includes("login") || dashUrl.includes("auth0");
    steps.push(
      testStep("Dashboard accessible or auth redirect", onDashboard || redirectedToLogin ? TestStatus.PASS : TestStatus.FAIL, { url: dashUrl })
    );

    // Step 4: Check deployment cards and status badges
    const deploymentCards = await session.countElements('[class*="deployment"], [class*="card"], [data-testid*="deployment"]');
    steps.push(
      testStep("Deployment cards rendered", deploymentCards > 0 ? TestStatus.PASS : TestStatus.SKIP, { count: deploymentCards })
    );

    // Step 5: Check deployment status badges
    const statusBadges = await session.countElements('[class*="badge"], [class*="status"], [data-testid*="status"]');
    steps.push(
      testStep("Deployment status badges visible", statusBadges > 0 ? TestStatus.PASS : TestStatus.SKIP, { count: statusBadges })
    );

    // Step 6: Check deployment card actions (start/stop buttons)
    const actionButtons = await session.countElements('button[class*="start" i], button[class*="stop" i], button[class*="deploy" i], button[aria-label*="start" i], button[aria-label*="stop" i]');
    steps.push(
      testStep("Deployment action buttons present", actionButtons > 0 ? TestStatus.PASS : TestStatus.SKIP, { count: actionButtons })
    );

    // Step 7: Navigate to billing/pricing page
    const billingLoadTime = await session.navigate(`${baseUrl}/pricing`);
    steps.push(
      testStep("Pricing page loads", billingLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${billingLoadTime}ms` })
    );
    await session.screenshot("pricing");

    // Step 8: Verify billing overview content
    const pricingText = await session.safeTextContent("body");
    const hasBillingContent = pricingText && (
      pricingText.toLowerCase().includes("price") ||
      pricingText.toLowerCase().includes("plan") ||
      pricingText.toLowerCase().includes("billing") ||
      pricingText.toLowerCase().includes("free") ||
      pricingText.toLowerCase().includes("month")
    );
    steps.push(
      testStep("Pricing page has billing content", hasBillingContent ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 9: Navigate to /billing (authenticated)
    const billingPageTime = await session.navigate(`${baseUrl}/billing`);
    steps.push(
      testStep("Billing page loads", billingPageTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${billingPageTime}ms` })
    );
    await session.screenshot("billing-page");

    // Step 10: Check subscription details visible
    const billingBody = await session.safeTextContent("body");
    const hasSubscriptionInfo = billingBody && (
      billingBody.toLowerCase().includes("subscription") ||
      billingBody.toLowerCase().includes("plan") ||
      billingBody.toLowerCase().includes("credit") ||
      billingBody.toLowerCase().includes("usage")
    );
    steps.push(
      testStep("Subscription details visible", hasSubscriptionInfo ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 11: Navigate to settings
    const settingsLoadTime = await session.navigate(`${baseUrl}/settings`);
    steps.push(
      testStep("Settings page loads", settingsLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${settingsLoadTime}ms` })
    );
    await session.screenshot("settings");

    // Step 12: Verify user profile info
    const settingsText = await session.safeTextContent("body");
    const hasProfileInfo = settingsText && (
      settingsText.toLowerCase().includes("profile") ||
      settingsText.toLowerCase().includes("email") ||
      settingsText.toLowerCase().includes("name") ||
      settingsText.toLowerCase().includes("account")
    );
    steps.push(
      testStep("User profile info visible", hasProfileInfo ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 13: Check email verification status section
    const hasEmailVerification = settingsText && (
      settingsText.toLowerCase().includes("verified") ||
      settingsText.toLowerCase().includes("verify") ||
      settingsText.toLowerCase().includes("email")
    );
    steps.push(
      testStep("Email verification section", hasEmailVerification ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 14: Navigate to a deployment chat page
    const chatLoadTime = await session.navigate(`${baseUrl}/d/demo`);
    steps.push(
      testStep("Deployment chat page loads", chatLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${chatLoadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("chat-page");

    // Step 15: Verify chat interface loads
    const hasChatInput = await session.exists('textarea, input[type="text"], [contenteditable="true"], [role="textbox"]');
    steps.push(
      testStep("Chat input present", hasChatInput ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 16: Check sidebar panels available (config, marketplace, files)
    const panelButtons = await session.countElements(
      'button[aria-label*="settings" i], button[aria-label*="marketplace" i], button[aria-label*="file" i], button[aria-label*="knowledge" i]'
    );
    steps.push(
      testStep("Sidebar panel buttons present", panelButtons > 0 ? TestStatus.PASS : TestStatus.SKIP, { count: panelButtons })
    );

    // Step 17: Check the profile dropdown / avatar
    const hasProfileDropdown = await session.exists(
      'button[aria-label*="profile" i], button[aria-label*="account" i], [class*="avatar"], [class*="Avatar"], img[alt*="avatar" i], img[alt*="profile" i]'
    );
    steps.push(
      testStep("Profile dropdown/avatar present", hasProfileDropdown ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 18: Navigate to marketplace
    const marketplaceLoadTime = await session.navigate(`${baseUrl}/marketplace`);
    steps.push(
      testStep("Marketplace page loads", marketplaceLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${marketplaceLoadTime}ms` })
    );
    await session.screenshot("marketplace");

    // Step 19: Check no sensitive keys exposed in DOM
    const sensitiveCheck = await session.page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const patterns = [/sk_live_[a-zA-Z0-9]+/, /sk_test_[a-zA-Z0-9]+/, /whsec_[a-zA-Z0-9]+/];
      return patterns.filter((p) => p.test(html)).length;
    });
    steps.push(
      testStep("No sensitive keys in page source", sensitiveCheck === 0 ? TestStatus.PASS : TestStatus.FAIL, { exposedPatterns: sensitiveCheck })
    );

    // Step 20: Check no 5xx server errors
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors (5xx)", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length })
    );

    // Step 21: Overall console errors
    const consoleErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("Minimal console errors", consoleErrors.length <= 3 ? TestStatus.PASS : TestStatus.WARN, { count: consoleErrors.length })
    );

    // Step 22: Performance — all navigations under threshold
    const slowPages = session.performanceMetrics.filter((m) => m.name.startsWith("navigate:") && m.value > Thresholds.PAGE_LOAD);
    steps.push(
      testStep("All pages load within threshold", slowPages.length === 0 ? TestStatus.PASS : TestStatus.WARN, {
        slowPages: slowPages.map((p) => `${p.name} (${p.value}ms)`),
      })
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
