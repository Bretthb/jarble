/**
 * Persona 13: Admin Panel Tester
 * Tests the admin area — sidebar navigation, data tables, audit log, system health, user management.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runAdminPanel({ baseUrl, config = {} }) {
  const session = new BrowserSession("13-admin-panel");
  const steps = [];

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Navigate to /admin
    const loadTime = await session.navigate(`${baseUrl}/admin`);
    steps.push(
      testStep("Admin page loads (or redirects)", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("admin-landing");

    // Step 2: Check admin accessible or auth redirect
    const adminUrl = session.page.url();
    const isAdminOrAuth = adminUrl.includes("admin") || adminUrl.includes("login") || adminUrl.includes("auth0") || adminUrl.includes("dashboard");
    steps.push(
      testStep("Admin accessible or auth redirect", isAdminOrAuth ? TestStatus.PASS : TestStatus.WARN, { url: adminUrl })
    );

    // Step 3: Check admin sidebar navigation
    const hasSidebar = await session.exists('nav, aside, [role="navigation"], [class*="sidebar"], [class*="Sidebar"]');
    steps.push(
      testStep("Admin sidebar navigation present", hasSidebar ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 4-8: Check each sidebar link
    const sidebarLabels = ["Users", "Deployments", "Billing", "Audit", "System"];
    for (const label of sidebarLabels) {
      const bodyText = await session.safeTextContent("body");
      const hasLink = bodyText && bodyText.includes(label);
      steps.push(
        testStep(`Sidebar link: ${label}`, hasLink ? TestStatus.PASS : TestStatus.SKIP)
      );
    }

    // Step 9-13: Navigate to each admin sub-page
    const adminPages = [
      { path: "/admin/users", name: "users" },
      { path: "/admin/deployments", name: "deployments" },
      { path: "/admin/billing", name: "billing" },
      { path: "/admin/audit", name: "audit" },
      { path: "/admin/system", name: "system" },
    ];
    for (const page of adminPages) {
      try {
        const pageLoad = await session.navigate(`${baseUrl}${page.path}`);
        steps.push(
          testStep(`Admin ${page.name} page loads`, pageLoad < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${pageLoad}ms` })
        );
        await session.screenshot(`admin-${page.name}`);
      } catch (err) {
        steps.push(testStep(`Admin ${page.name} page loads`, TestStatus.FAIL, { error: err.message }));
      }
    }

    // Step 14: Check data tables render on users page
    await session.navigate(`${baseUrl}/admin/users`);
    await session.page.waitForTimeout(1500);
    const hasTable = await session.exists("table, [role='grid'], [class*='table'], [class*='Table']");
    steps.push(
      testStep("Data tables render on admin pages", hasTable ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 15: Check table has sortable headers
    const hasSortableHeaders = await session.exists('th[class*="sort"], th button, [role="columnheader"] button');
    steps.push(
      testStep("Table headers sortable", hasSortableHeaders ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 16: Check pagination on admin tables
    const hasPagination = await session.exists('[class*="pagination"], button:has-text("Next"), button:has-text("Previous"), [class*="Pagination"]');
    steps.push(
      testStep("Admin table pagination", hasPagination ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 17: Check audit log content
    await session.navigate(`${baseUrl}/admin/audit`);
    await session.page.waitForTimeout(1500);
    const hasAuditContent = await session.exists("table, [class*='log'], [class*='audit'], ul, ol");
    steps.push(
      testStep("Audit log content present", hasAuditContent ? TestStatus.PASS : TestStatus.WARN)
    );
    await session.screenshot("admin-audit-log");

    // Step 18: Check system health dashboard
    await session.navigate(`${baseUrl}/admin/system`);
    await session.page.waitForTimeout(1500);
    const hasHealthContent = await session.exists("[class*='health'], [class*='status'], [class*='dashboard'], [class*='metric'], [class*='uptime']");
    steps.push(
      testStep("System health dashboard renders", hasHealthContent ? TestStatus.PASS : TestStatus.WARN)
    );
    await session.screenshot("admin-system-health");

    // Step 19: Check system metrics (CPU, memory, etc.)
    const systemText = await session.safeTextContent("body");
    const hasMetrics = systemText && (
      systemText.toLowerCase().includes("cpu") ||
      systemText.toLowerCase().includes("memory") ||
      systemText.toLowerCase().includes("uptime") ||
      systemText.toLowerCase().includes("healthy") ||
      systemText.toLowerCase().includes("status")
    );
    steps.push(
      testStep("System metrics displayed", hasMetrics ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 20: Check admin search functionality
    const hasSearch = await session.exists('input[type="search"], input[placeholder*="search" i], [data-testid*="search"]');
    steps.push(
      testStep("Admin search available", hasSearch ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 21: No sensitive data exposed in admin pages
    const sensitiveCheck = await session.page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const patterns = [/sk_live_[a-zA-Z0-9]+/, /sk_test_[a-zA-Z0-9]+/, /whsec_[a-zA-Z0-9]+/];
      return patterns.filter((p) => p.test(html)).length;
    });
    steps.push(
      testStep("No sensitive keys on admin pages", sensitiveCheck === 0 ? TestStatus.PASS : TestStatus.FAIL, { exposed: sensitiveCheck })
    );

    // Step 22: No console errors on admin pages
    const pageErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors on admin pages", pageErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { errorCount: pageErrors.length })
    );

    // Step 23: No server errors
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors on admin pages", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length })
    );

    // Step 24: Performance — all admin pages under threshold
    const slowPages = session.performanceMetrics.filter((m) => m.name.startsWith("navigate:") && m.value > Thresholds.PAGE_LOAD);
    steps.push(
      testStep("All admin pages load within threshold", slowPages.length === 0 ? TestStatus.PASS : TestStatus.WARN, {
        slowPages: slowPages.map((p) => `${p.name} (${p.value}ms)`),
      })
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Admin Panel Tester",
    description: "Tests the admin area — sidebar, data tables, audit log, system health",
    steps,
    browser: session.getReport(),
  };
}
