/**
 * Persona 08: Billing User
 * Pricing page, checkout flow, billing overview.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runBillingUser({ baseUrl }) {
  const session = new BrowserSession("08-billing-user");
  const steps = [];

  try {
    await session.start();

    // Step 1: Load pricing page
    const loadTime = await session.navigate(`${baseUrl}/pricing`);
    steps.push(
      testStep("Pricing page loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.screenshot("billing-pricing");

    // Step 2: Check pricing tiers are displayed
    const pricingContent = await session.safeTextContent("body");
    const hasTiers = pricingContent && (
      pricingContent.toLowerCase().includes("free") ||
      pricingContent.toLowerCase().includes("pro") ||
      pricingContent.toLowerCase().includes("enterprise") ||
      pricingContent.toLowerCase().includes("plan") ||
      pricingContent.toLowerCase().includes("month")
    );
    steps.push(
      testStep("Pricing tiers displayed", hasTiers ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 3: Check pricing has CTA buttons
    const ctaButtons = await session.countElements(
      'button, a[href*="checkout"], a[href*="billing"], a[href*="subscribe"], a[href*="signup"]'
    );
    steps.push(
      testStep("Pricing CTA buttons present", ctaButtons > 0 ? TestStatus.PASS : TestStatus.WARN, { count: ctaButtons })
    );

    // Step 4: Navigate to billing/account page
    const billingLoadTime = await session.navigate(`${baseUrl}/billing`);
    steps.push(
      testStep("Billing page loads", billingLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${billingLoadTime}ms` })
    );
    await session.screenshot("billing-page");

    // Step 5: Check billing page has relevant content or redirects to auth
    const billingUrl = session.page.url();
    const isBillingOrAuth = billingUrl.includes("billing") || billingUrl.includes("login") || billingUrl.includes("auth0") || billingUrl.includes("pricing");
    steps.push(
      testStep("Billing accessible or auth redirect", isBillingOrAuth ? TestStatus.PASS : TestStatus.WARN, { url: billingUrl })
    );

    // Step 6: Check for Stripe integration markers
    const hasStripeRef = await session.page.evaluate(() => {
      const bodyText = document.body.innerText.toLowerCase();
      const hasStripeScript = !!document.querySelector('script[src*="stripe"]');
      const hasStripeText = bodyText.includes("stripe") || bodyText.includes("payment") || bodyText.includes("card");
      return { hasStripeScript, hasStripeText };
    });
    steps.push(
      testStep(
        "Payment integration references",
        hasStripeRef.hasStripeScript || hasStripeRef.hasStripeText ? TestStatus.PASS : TestStatus.SKIP,
        hasStripeRef
      )
    );

    // Step 7: Check no financial data exposed in page source
    const sensitiveCheck = await session.page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const patterns = [
        /sk_live_[a-zA-Z0-9]+/,
        /sk_test_[a-zA-Z0-9]+/,
        /whsec_[a-zA-Z0-9]+/,
        /credit.?card.?number/i,
      ];
      const found = patterns.filter((p) => p.test(html));
      return found.length;
    });
    steps.push(
      testStep("No sensitive keys in page source", sensitiveCheck === 0 ? TestStatus.PASS : TestStatus.FAIL, {
        exposedPatterns: sensitiveCheck,
      })
    );

    // Step 8: Check no 5xx errors during billing flow
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors in billing flow", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, {
        count: serverErrors.length,
      })
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
