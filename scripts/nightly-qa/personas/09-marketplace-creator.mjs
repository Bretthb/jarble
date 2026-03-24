/**
 * Persona 09: Marketplace Creator
 * Marketplace browse, component details, service details.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runMarketplaceCreator({ baseUrl }) {
  const session = new BrowserSession("09-marketplace-creator");
  const steps = [];

  try {
    await session.start();

    // Step 1: Load marketplace page
    const loadTime = await session.navigate(`${baseUrl}/marketplace`);
    steps.push(
      testStep("Marketplace page loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.screenshot("marketplace-browse");

    // Step 2: Check marketplace has content (components or services listed)
    const marketplaceUrl = session.page.url();
    const isOnMarketplace = marketplaceUrl.includes("marketplace");
    const bodyText = await session.safeTextContent("body");
    const hasMarketplaceContent = bodyText && (
      bodyText.toLowerCase().includes("component") ||
      bodyText.toLowerCase().includes("service") ||
      bodyText.toLowerCase().includes("marketplace") ||
      bodyText.toLowerCase().includes("template")
    );
    steps.push(
      testStep(
        "Marketplace content visible",
        isOnMarketplace && hasMarketplaceContent ? TestStatus.PASS : TestStatus.WARN,
        { url: marketplaceUrl }
      )
    );

    // Step 3: Check for component cards or listings
    const listingCount = await session.countElements(
      '[class*="card"], [class*="listing"], [class*="item"], [data-testid*="component"], [data-testid*="service"]'
    );
    steps.push(
      testStep("Marketplace listings rendered", listingCount > 0 ? TestStatus.PASS : TestStatus.SKIP, {
        count: listingCount,
        note: "May require seeded data",
      })
    );

    // Step 4: Navigate to services marketplace
    const servicesLoadTime = await session.navigate(`${baseUrl}/marketplace/services`);
    steps.push(
      testStep("Services marketplace loads", servicesLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${servicesLoadTime}ms` })
    );
    await session.screenshot("marketplace-services");

    // Step 5: Navigate to components marketplace
    const componentsLoadTime = await session.navigate(`${baseUrl}/marketplace/components`);
    steps.push(
      testStep("Components marketplace loads", componentsLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${componentsLoadTime}ms` })
    );
    await session.screenshot("marketplace-components");

    // Step 6: Check search/filter functionality exists
    const hasSearch = await session.exists(
      'input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i], [data-testid*="search"]'
    );
    steps.push(
      testStep("Search/filter available", hasSearch ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 7: Check for category navigation
    const hasCategoryNav = await session.exists(
      'nav, [role="tablist"], [class*="category"], [class*="filter"], [class*="tab"]'
    );
    steps.push(
      testStep("Category navigation present", hasCategoryNav ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 8: No console errors on marketplace pages
    const errors = session.consoleLogs.filter(
      (l) => l.type === "error" || l.type === "page_error"
    );
    steps.push(
      testStep("No console errors on marketplace", errors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { count: errors.length })
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Marketplace Creator",
    description: "Browse marketplace, component and service details",
    steps,
    browser: session.getReport(),
  };
}
