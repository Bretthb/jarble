/**
 * Persona 01: New Developer
 * First-time user discovering the platform — homepage, login, wizard, settings, all public pages.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";
import { runVisualHealthCheck } from "../lib/visualChecks.mjs";

export default async function runNewDeveloper({ baseUrl, config = {} }) {
  const session = new BrowserSession("01-new-developer");
  const steps = [];
  const consoleErrorsByPage = {};

  function trackErrors(pageName) {
    const errs = session.consoleLogs.filter(
      (l) => (l.type === "error" || l.type === "page_error") && !consoleErrorsByPage[l.timestamp]
    );
    errs.forEach((e) => (consoleErrorsByPage[e.timestamp] = pageName));
    return errs.length;
  }

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Load homepage
    const loadTime = await session.navigate(baseUrl);
    steps.push(
      testStep("Homepage loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.page.waitForTimeout(3000);
    await session.screenshot("homepage");

    // Visual health check: Homepage
    const { step: homepageVisual } = await runVisualHealthCheck(session, "Homepage");
    steps.push(homepageVisual);

    // Step 2: Check hero heading
    const heroText = await session.safeTextContent("h2");
    steps.push(
      testStep("Hero heading visible", heroText && heroText.trim().length > 0 ? TestStatus.PASS : TestStatus.FAIL, { text: heroText?.slice(0, 80) })
    );

    // Step 3: Check primary CTA button
    const ctaExists = await session.exists('[data-tour="hero-cta"], button');
    steps.push(
      testStep("Primary CTA button exists", ctaExists ? TestStatus.PASS : TestStatus.FAIL)
    );

    // Step 4: Check nav links present
    const navLinks = await session.page.evaluate(() => {
      const links = document.querySelectorAll("nav a, header a");
      return Array.from(links).map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim().slice(0, 30) })).slice(0, 10);
    });
    steps.push(
      testStep("Navigation links present", navLinks.length > 0 ? TestStatus.PASS : TestStatus.WARN, { count: navLinks.length, links: navLinks.slice(0, 5) })
    );

    // Step 5: Console errors on homepage
    const homeErrors = trackErrors("homepage");
    steps.push(
      testStep("No console errors on homepage", homeErrors === 0 ? TestStatus.PASS : TestStatus.WARN, { errorCount: homeErrors })
    );

    // Step 6: Navigate to /pricing
    const pricingLoadTime = await session.navigate(`${baseUrl}/pricing`);
    steps.push(
      testStep("Pricing page loads", pricingLoadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${pricingLoadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("pricing-page");

    // Visual health check: Pricing
    const { step: pricingVisual } = await runVisualHealthCheck(session, "Pricing");
    steps.push(pricingVisual);

    // Step 7: Verify pricing tiers render
    const pricingText = await session.safeTextContent("body");
    const hasTiers = pricingText && (
      pricingText.toLowerCase().includes("free") ||
      pricingText.toLowerCase().includes("pro") ||
      pricingText.toLowerCase().includes("enterprise") ||
      pricingText.toLowerCase().includes("plan")
    );
    steps.push(
      testStep("Pricing tiers render", hasTiers ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 8: Navigate to /about
    const aboutLoadTime = await session.navigate(`${baseUrl}/about`);
    steps.push(
      testStep("About page loads", aboutLoadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${aboutLoadTime}ms` })
    );
    await session.screenshot("about-page");

    // Visual health check: About
    const { step: aboutVisual } = await runVisualHealthCheck(session, "About");
    steps.push(aboutVisual);

    // Step 9: Verify about content
    const aboutText = await session.safeTextContent("body");
    const hasAboutContent = aboutText && aboutText.length > 100;
    steps.push(
      testStep("About page has content", hasAboutContent ? TestStatus.PASS : TestStatus.WARN, { textLength: aboutText?.length })
    );

    // Step 10: Navigate to /login — verify Auth0 redirect or login form
    try {
      const loginLink = await session.exists('a[href*="login"]');
      if (loginLink) {
        await session.page.click('a[href*="login"]');
      } else {
        await session.navigate(baseUrl + "/login");
      }
      await session.page.waitForTimeout(3000);
      const loginUrl = session.page.url();
      const isLoginOrAuth = loginUrl.includes("login") || loginUrl.includes("auth0") || loginUrl.includes("authorize");
      steps.push(
        testStep("Login page or Auth0 redirect", isLoginOrAuth ? TestStatus.PASS : TestStatus.WARN, { url: loginUrl })
      );
      await session.screenshot("login-page");
    } catch (err) {
      steps.push(testStep("Login page navigation", TestStatus.WARN, { error: err.message }));
    }

    // Step 11: Navigate to /dashboard (with auth)
    const dashLoadTime = await session.navigate(`${baseUrl}/dashboard`);
    steps.push(
      testStep("Dashboard page loads", dashLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${dashLoadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("dashboard");

    // Visual health check: Dashboard
    const { step: dashboardVisual } = await runVisualHealthCheck(session, "Dashboard");
    steps.push(dashboardVisual);

    // Step 12: Check dashboard content or auth redirect
    const dashUrl = session.page.url();
    const onDashboard = dashUrl.includes("dashboard");
    const redirectedToAuth = dashUrl.includes("login") || dashUrl.includes("auth0");
    steps.push(
      testStep("Dashboard accessible or auth redirect", onDashboard || redirectedToAuth ? TestStatus.PASS : TestStatus.FAIL, { url: dashUrl })
    );

    // Step 13: Check deployment cards on dashboard
    const deployCards = await session.countElements('[class*="deployment"], [class*="card"], [data-testid*="deployment"]');
    steps.push(
      testStep("Deployment cards rendered", deployCards > 0 ? TestStatus.PASS : TestStatus.SKIP, { count: deployCards, note: "Requires existing deployments" })
    );

    // Step 14: Navigate to /onboarding/new — wizard step 1
    const wizardLoadTime = await session.navigate(`${baseUrl}/onboarding/new`);
    steps.push(
      testStep("Onboarding wizard loads", wizardLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${wizardLoadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("wizard-step1");

    // Step 15: Verify wizard step 1 — name input
    const hasNameInput = await session.exists('input[name*="name" i], input[placeholder*="name" i], input[type="text"]');
    steps.push(
      testStep("Wizard step 1: name input present", hasNameInput ? TestStatus.PASS : TestStatus.SKIP, { note: "May redirect if unauthenticated" })
    );

    // Step 16: Check wizard step indicators / progress
    const hasStepIndicators = await session.exists('[class*="step"], [class*="wizard"], [role="progressbar"], [class*="progress"]');
    steps.push(
      testStep("Wizard step indicators visible", hasStepIndicators ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 17: Check wizard for runtime selection (openclaw/zeroclaw)
    const wizardBody = await session.safeTextContent("body");
    const hasRuntimeOptions = wizardBody && (
      wizardBody.toLowerCase().includes("openclaw") ||
      wizardBody.toLowerCase().includes("zeroclaw") ||
      wizardBody.toLowerCase().includes("runtime")
    );
    steps.push(
      testStep("Wizard mentions runtimes", hasRuntimeOptions ? TestStatus.PASS : TestStatus.SKIP, { note: "May only show on step 2" })
    );

    // Step 18: Navigate to /settings
    const settingsLoadTime = await session.navigate(`${baseUrl}/settings`);
    steps.push(
      testStep("Settings page loads", settingsLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${settingsLoadTime}ms` })
    );
    await session.screenshot("settings-page");

    // Visual health check: Settings
    const { step: settingsVisual } = await runVisualHealthCheck(session, "Settings");
    steps.push(settingsVisual);

    // Step 19: Verify settings page has user info
    const settingsText = await session.safeTextContent("body");
    const hasUserInfo = settingsText && (
      settingsText.toLowerCase().includes("profile") ||
      settingsText.toLowerCase().includes("email") ||
      settingsText.toLowerCase().includes("settings") ||
      settingsText.toLowerCase().includes("account")
    );
    steps.push(
      testStep("Settings page has user info", hasUserInfo ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 20: Check footer links
    const footerLinks = await session.page.evaluate(() => {
      const footer = document.querySelector("footer");
      if (!footer) return [];
      const links = footer.querySelectorAll("a");
      return Array.from(links).map((a) => ({ href: a.getAttribute("href"), text: a.textContent.trim().slice(0, 30) }));
    });
    steps.push(
      testStep("Footer links present", footerLinks.length > 0 ? TestStatus.PASS : TestStatus.WARN, { count: footerLinks.length })
    );

    // Step 21: Check mobile nav works (resize viewport)
    await session.page.setViewportSize({ width: 375, height: 812 });
    await session.navigate(baseUrl);
    await session.page.waitForTimeout(2000);
    const hasMobileNav = await session.exists(
      'button[aria-label*="menu"], button[aria-label*="nav"], [data-testid="mobile-menu"], button[class*="hamburger"], nav button'
    );
    steps.push(
      testStep("Mobile nav toggle accessible", hasMobileNav ? TestStatus.PASS : TestStatus.WARN)
    );
    await session.screenshot("mobile-nav");
    // Reset viewport
    await session.page.setViewportSize({ width: 1440, height: 900 });

    // Step 22: Performance — all pages < 5s
    const slowPages = session.performanceMetrics.filter((m) => m.name.startsWith("navigate:") && m.value > Thresholds.PAGE_LOAD);
    steps.push(
      testStep("All pages load < 5s", slowPages.length === 0 ? TestStatus.PASS : TestStatus.WARN, {
        slowPages: slowPages.map((p) => `${p.name} (${p.value}ms)`),
      })
    );

    // Step 23: Page title present
    const title = await session.page.title();
    steps.push(
      testStep("Page has a title", title && title.length > 0 ? TestStatus.PASS : TestStatus.WARN, { title })
    );

    // Step 24: Meta viewport tag
    const hasViewport = await session.exists('meta[name="viewport"]');
    steps.push(
      testStep("Meta viewport tag present", hasViewport ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 25: Overall console errors across all pages
    const totalErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("Minimal console errors across all pages", totalErrors.length <= 3 ? TestStatus.PASS : TestStatus.WARN, { errorCount: totalErrors.length })
    );

    // Step 26: No 5xx server errors
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors (5xx)", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length })
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
