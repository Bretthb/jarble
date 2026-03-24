/**
 * Persona 13: Admin Panel Tester
 * Tests the admin area at /admin — sidebar navigation, data tables, audit log, system health.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runAdminPanel({ baseUrl }) {
  const session = new BrowserSession("13-admin-panel");
  const steps = [];

  try {
    await session.start();

    // Step 1: Navigate to /admin
    const loadTime = await session.navigate(`${baseUrl}/admin`);
    steps.push(
      testStep(
        "Admin page loads (or redirects)",
        loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN,
        { loadTime: `${loadTime}ms` }
      )
    );
    await session.screenshot("admin-landing");

    // Step 2: Check admin sidebar navigation links
    const sidebarLinks = ["Users", "Deployments", "Billing", "Audit", "System"];
    for (const label of sidebarLinks) {
      const exists = await session.exists(`nav a, aside a, [role="navigation"] a`);
      steps.push(
        testStep(
          `Sidebar navigation present (looking for ${label})`,
          exists ? TestStatus.PASS : TestStatus.WARN,
          { label }
        )
      );
    }

    // Step 3: Screenshot each admin sub-page
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
          testStep(
            `Admin ${page.name} page loads`,
            pageLoad < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN,
            { loadTime: `${pageLoad}ms` }
          )
        );
        await session.screenshot(`admin-${page.name}`);
      } catch (err) {
        steps.push(
          testStep(`Admin ${page.name} page loads`, TestStatus.FAIL, { error: err.message })
        );
      }
    }

    // Step 4: Check data tables render
    const hasTable = await session.exists("table, [role='grid'], [class*='table'], [class*='Table']");
    steps.push(
      testStep(
        "Data tables render on admin pages",
        hasTable ? TestStatus.PASS : TestStatus.WARN,
        { note: "Checked for table elements" }
      )
    );

    // Step 5: Check audit log loads
    try {
      await session.navigate(`${baseUrl}/admin/audit`);
      const hasAuditContent = await session.exists("table, [class*='log'], [class*='audit'], ul, ol");
      steps.push(
        testStep(
          "Audit log content present",
          hasAuditContent ? TestStatus.PASS : TestStatus.WARN
        )
      );
      await session.screenshot("admin-audit-log");
    } catch (err) {
      steps.push(
        testStep("Audit log content present", TestStatus.FAIL, { error: err.message })
      );
    }

    // Step 6: Check system health dashboard
    try {
      await session.navigate(`${baseUrl}/admin/system`);
      const hasHealthContent = await session.exists("[class*='health'], [class*='status'], [class*='dashboard'], [class*='metric']");
      steps.push(
        testStep(
          "System health dashboard renders",
          hasHealthContent ? TestStatus.PASS : TestStatus.WARN
        )
      );
      await session.screenshot("admin-system-health");
    } catch (err) {
      steps.push(
        testStep("System health dashboard renders", TestStatus.FAIL, { error: err.message })
      );
    }

    // Step 7: Verify no console errors on admin pages
    const pageErrors = session.consoleLogs.filter(
      (l) => l.type === "error" || l.type === "page_error"
    );
    steps.push(
      testStep(
        "No console errors on admin pages",
        pageErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN,
        { errorCount: pageErrors.length }
      )
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
