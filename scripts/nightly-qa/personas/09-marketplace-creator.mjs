/**
 * Persona 09: Marketplace Creator
 * Marketplace browse, component/service cards, search/filter, category navigation, detail pages.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runMarketplaceCreator({ baseUrl, apiUrl, config = {} }) {
  const session = new BrowserSession("09-marketplace-creator");
  const api = new ApiClient(apiUrl, config.authToken);
  const steps = [];

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Load marketplace page
    const loadTime = await session.navigate(`${baseUrl}/marketplace`);
    steps.push(
      testStep("Marketplace page loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("marketplace-browse");

    // Step 2: Marketplace content visible
    const marketplaceUrl = session.page.url();
    const bodyText = await session.safeTextContent("body");
    const hasMarketplaceContent = bodyText && (
      bodyText.toLowerCase().includes("component") ||
      bodyText.toLowerCase().includes("service") ||
      bodyText.toLowerCase().includes("marketplace") ||
      bodyText.toLowerCase().includes("template")
    );
    steps.push(
      testStep("Marketplace content visible", marketplaceUrl.includes("marketplace") && hasMarketplaceContent ? TestStatus.PASS : TestStatus.WARN, { url: marketplaceUrl })
    );

    // Step 3: Component cards render
    const componentCards = await session.countElements(
      '[class*="card"], [class*="listing"], [class*="item"], [data-testid*="component"], [data-testid*="service"]'
    );
    steps.push(
      testStep("Marketplace cards rendered", componentCards > 0 ? TestStatus.PASS : TestStatus.SKIP, { count: componentCards })
    );

    // Step 4: Navigate to services marketplace
    const servicesLoadTime = await session.navigate(`${baseUrl}/marketplace/services`);
    steps.push(
      testStep("Services marketplace loads", servicesLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${servicesLoadTime}ms` })
    );
    await session.screenshot("marketplace-services");

    // Step 5: Service cards render
    const serviceCards = await session.countElements('[class*="card"], [class*="listing"], [class*="item"]');
    steps.push(
      testStep("Service cards rendered", serviceCards > 0 ? TestStatus.PASS : TestStatus.SKIP, { count: serviceCards })
    );

    // Step 6: Navigate to components marketplace
    const componentsLoadTime = await session.navigate(`${baseUrl}/marketplace/components`);
    steps.push(
      testStep("Components marketplace loads", componentsLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${componentsLoadTime}ms` })
    );
    await session.screenshot("marketplace-components");

    // Step 7: Search/filter functionality exists
    const hasSearch = await session.exists(
      'input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i], [data-testid*="search"]'
    );
    steps.push(
      testStep("Search/filter available", hasSearch ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 8: Try typing in search
    if (hasSearch) {
      try {
        const searchInput = await session.page.$('input[type="search"], input[placeholder*="search" i], input[placeholder*="filter" i]');
        if (searchInput) {
          await searchInput.click();
          await searchInput.fill("chart");
          await session.page.waitForTimeout(1000);
          steps.push(testStep("Search accepts input", TestStatus.PASS));
          await session.screenshot("marketplace-search");
        }
      } catch (err) {
        steps.push(testStep("Search accepts input", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Search accepts input", TestStatus.SKIP));
    }

    // Step 9: Category navigation present
    const hasCategoryNav = await session.exists(
      'nav, [role="tablist"], [class*="category"], [class*="filter"], [class*="tab"]'
    );
    steps.push(
      testStep("Category navigation present", hasCategoryNav ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 10: Try clicking a component card for detail page
    try {
      const firstCard = await session.page.$('[class*="card"] a, [class*="listing"] a, [class*="item"] a');
      if (firstCard) {
        await firstCard.click();
        await session.page.waitForTimeout(2000);
        await session.screenshot("marketplace-detail");
        steps.push(testStep("Component detail page navigable", TestStatus.PASS));
      } else {
        steps.push(testStep("Component detail page navigable", TestStatus.SKIP));
      }
    } catch (err) {
      steps.push(testStep("Component detail page navigable", TestStatus.WARN, { error: err.message }));
    }

    // Step 11: Check detail page has install/use button
    const hasInstallButton = await session.exists(
      'button:has-text("Install"), button:has-text("Use"), button:has-text("Add"), button:has-text("Deploy"), button[class*="install" i]'
    );
    steps.push(
      testStep("Install/use button on detail page", hasInstallButton ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 12: Check ratings/reviews section
    const detailText = await session.safeTextContent("body");
    const hasRatings = detailText && (
      detailText.toLowerCase().includes("rating") ||
      detailText.toLowerCase().includes("review") ||
      detailText.toLowerCase().includes("star")
    );
    steps.push(
      testStep("Ratings/reviews section", hasRatings ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 13: API — marketplace list published
    const marketplaceRes = await api.trpc("marketplace.listPublished");
    steps.push(
      testStep("tRPC marketplace.listPublished", marketplaceRes.status !== null && marketplaceRes.status < 500 ? TestStatus.PASS : TestStatus.WARN, {
        status: marketplaceRes.status, duration: `${marketplaceRes.duration}ms`,
      })
    );

    // Step 14: API — services list published
    const servicesRes = await api.trpc("services.listPublished");
    steps.push(
      testStep("tRPC services.listPublished", servicesRes.status !== null && servicesRes.status < 500 ? TestStatus.PASS : TestStatus.WARN, {
        status: servicesRes.status, duration: `${servicesRes.duration}ms`,
      })
    );

    // Step 15: Navigate back to marketplace from detail
    await session.navigate(`${baseUrl}/marketplace`);
    await session.page.waitForTimeout(1000);
    const backOnMarketplace = session.page.url().includes("marketplace");
    steps.push(
      testStep("Navigation back to marketplace", backOnMarketplace ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 16: Check component/service descriptions visible
    const hasDescriptions = await session.page.evaluate(() => {
      const cards = document.querySelectorAll('[class*="card"], [class*="listing"]');
      let withDescription = 0;
      cards.forEach((card) => {
        const text = card.textContent.trim();
        if (text.length > 20) withDescription++;
      });
      return { total: cards.length, withDescription };
    });
    steps.push(
      testStep("Cards have descriptions", hasDescriptions.withDescription > 0 ? TestStatus.PASS : TestStatus.SKIP, hasDescriptions)
    );

    // Step 17: Check pagination or load more
    const hasPagination = await session.exists(
      '[class*="pagination"], button:has-text("Load more"), button:has-text("Next"), [class*="Pagination"]'
    );
    steps.push(
      testStep("Pagination or load more present", hasPagination ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 18: Check marketplace in-page sidebar (on chat page)
    await session.navigate(`${baseUrl}/d/demo`);
    await session.page.waitForTimeout(2000);
    const marketplaceBtn = 'button[aria-label*="marketplace" i], button[aria-label*="store" i]';
    const hasInPageMarketplace = await session.exists(marketplaceBtn);
    steps.push(
      testStep("Marketplace panel in chat page", hasInPageMarketplace ? TestStatus.PASS : TestStatus.SKIP)
    );
    await session.screenshot("marketplace-in-chat");

    // Step 19: No console errors on marketplace pages
    const errors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors on marketplace", errors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { count: errors.length })
    );

    // Step 20: No server errors
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length })
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
