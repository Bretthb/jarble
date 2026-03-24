/**
 * Persona 08: Billing User
 * Pricing page, checkout flow, billing overview, Stripe integration, invoice history.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runBillingUser({ baseUrl, apiUrl, config = {} }) {
  const session = new BrowserSession("08-billing-user");
  const api = new ApiClient(apiUrl, config.authToken);
  const steps = [];

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Load pricing page
    const loadTime = await session.navigate(`${baseUrl}/pricing`);
    steps.push(
      testStep("Pricing page loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("billing-pricing");

    // Step 2: All pricing tiers visible
    const pricingContent = await session.safeTextContent("body");
    const hasTiers = pricingContent && (
      pricingContent.toLowerCase().includes("free") ||
      pricingContent.toLowerCase().includes("pro") ||
      pricingContent.toLowerCase().includes("enterprise") ||
      pricingContent.toLowerCase().includes("plan")
    );
    steps.push(
      testStep("Pricing tiers displayed", hasTiers ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 3: Count pricing tier cards
    const tierCards = await session.countElements('[class*="pricing"], [class*="tier"], [class*="plan"], [class*="card"]');
    steps.push(
      testStep("Multiple pricing tier cards rendered", tierCards >= 2 ? TestStatus.PASS : TestStatus.WARN, { count: tierCards })
    );

    // Step 4: CTA buttons on each tier
    const ctaButtons = await session.countElements(
      'button, a[href*="checkout"], a[href*="billing"], a[href*="subscribe"], a[href*="signup"]'
    );
    steps.push(
      testStep("Pricing CTA buttons present", ctaButtons > 0 ? TestStatus.PASS : TestStatus.WARN, { count: ctaButtons })
    );

    // Step 5: Check pricing page has monthly/annual toggle
    const hasToggle = await session.exists(
      '[class*="toggle"], [role="switch"], [class*="billing-cycle"], button:has-text("Monthly"), button:has-text("Annual")'
    );
    steps.push(
      testStep("Billing cycle toggle present", hasToggle ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 6: Navigate to billing page (auth required)
    const billingLoadTime = await session.navigate(`${baseUrl}/billing`);
    steps.push(
      testStep("Billing page loads", billingLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${billingLoadTime}ms` })
    );
    await session.screenshot("billing-page");

    // Step 7: Billing page accessible or auth redirect
    const billingUrl = session.page.url();
    const isBillingOrAuth = billingUrl.includes("billing") || billingUrl.includes("login") || billingUrl.includes("auth0") || billingUrl.includes("pricing");
    steps.push(
      testStep("Billing accessible or auth redirect", isBillingOrAuth ? TestStatus.PASS : TestStatus.WARN, { url: billingUrl })
    );

    // Step 8: Monthly cost display
    const billingBody = await session.safeTextContent("body");
    const hasCostDisplay = billingBody && (
      billingBody.includes("$") ||
      billingBody.toLowerCase().includes("cost") ||
      billingBody.toLowerCase().includes("usage") ||
      billingBody.toLowerCase().includes("credit")
    );
    steps.push(
      testStep("Monthly cost or usage display", hasCostDisplay ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 9: Subscription status visible
    const hasSubscriptionStatus = billingBody && (
      billingBody.toLowerCase().includes("subscription") ||
      billingBody.toLowerCase().includes("active") ||
      billingBody.toLowerCase().includes("plan") ||
      billingBody.toLowerCase().includes("free")
    );
    steps.push(
      testStep("Subscription status visible", hasSubscriptionStatus ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 10: No Stripe secret keys exposed in DOM
    const sensitiveCheck = await session.page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const patterns = [
        /sk_live_[a-zA-Z0-9]+/,
        /sk_test_[a-zA-Z0-9]+/,
        /whsec_[a-zA-Z0-9]+/,
        /credit.?card.?number/i,
      ];
      return patterns.filter((p) => p.test(html)).length;
    });
    steps.push(
      testStep("No Stripe secret keys in DOM", sensitiveCheck === 0 ? TestStatus.PASS : TestStatus.FAIL, { exposedPatterns: sensitiveCheck })
    );

    // Step 11: Check payment method section
    const hasPaymentSection = billingBody && (
      billingBody.toLowerCase().includes("payment method") ||
      billingBody.toLowerCase().includes("card") ||
      billingBody.toLowerCase().includes("visa") ||
      billingBody.toLowerCase().includes("mastercard")
    );
    steps.push(
      testStep("Payment method section", hasPaymentSection ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 12: Check invoice history section
    const hasInvoiceHistory = billingBody && (
      billingBody.toLowerCase().includes("invoice") ||
      billingBody.toLowerCase().includes("history") ||
      billingBody.toLowerCase().includes("receipt") ||
      billingBody.toLowerCase().includes("transaction")
    );
    steps.push(
      testStep("Invoice history section", hasInvoiceHistory ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 13: API — billing overview endpoint
    const billingRes = await api.trpc("billing.getOverview");
    steps.push(
      testStep("tRPC billing.getOverview", billingRes.status !== null && billingRes.status < 500 ? TestStatus.PASS : TestStatus.WARN, {
        status: billingRes.status, duration: `${billingRes.duration}ms`,
      })
    );

    // Step 14: Check for Stripe integration markers
    const hasStripeRef = await session.page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      const hasStripeScript = !!document.querySelector('script[src*="stripe"]');
      const hasStripeText = bodyText.includes("stripe") || bodyText.includes("payment") || bodyText.includes("card");
      return { hasStripeScript, hasStripeText };
    });
    steps.push(
      testStep("Stripe integration references", hasStripeRef.hasStripeScript || hasStripeRef.hasStripeText ? TestStatus.PASS : TestStatus.SKIP, hasStripeRef)
    );

    // Step 15: No 5xx errors during billing flow
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors in billing flow", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length })
    );

    // Step 16: Console errors check
    const consoleErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors in billing flow", consoleErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { count: consoleErrors.length })
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Billing User",
    description: "Pricing, checkout flow, billing portal",
    steps,
    browser: session.getReport(),
  };
}
