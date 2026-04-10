/**
 * Persona 26: Visual Regression
 * Visits key pages and runs automated visual health checks to detect layout
 * issues, broken images, overlapping elements, and other visual regressions.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { runVisualHealthCheck, formatVisualIssues } from "../lib/visualChecks.mjs";
import { injectAuth } from "../lib/auth.mjs";

/**
 * Pages to check. Each entry has a path (relative to baseUrl), a label,
 * and whether it requires authentication.
 */
const PAGES = [
  { path: "/",               label: "Homepage",     auth: false },
  { path: "/pricing",        label: "Pricing",      auth: false },
  { path: "/about",          label: "About",        auth: false },
  { path: "/dashboard",      label: "Dashboard",    auth: true  },
  { path: "/settings",       label: "Settings",     auth: true  },
  { path: "/marketplace",    label: "Marketplace",  auth: true  },
  { path: "/onboarding/new", label: "Onboarding",   auth: true  },
  // /d/{deploymentId} is added dynamically if a deployment exists
];

export default async function runVisualRegression({ baseUrl, apiUrl, config = {} }) {
  const session = new BrowserSession("26-visual-regression");
  const steps = [];
  const allIssues = {};

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Try to discover a deployment ID for the /d/[id] page
    let deploymentPath = null;
    if (apiUrl && config.authToken) {
      try {
        const resp = await session.page.evaluate(
          async ({ apiUrl, token }) => {
            const res = await fetch(`${apiUrl}/trpc/deployment.list`, {
              headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return null;
            const json = await res.json();
            const deployments = json?.result?.data || [];
            return deployments.length > 0 ? deployments[0].id : null;
          },
          { apiUrl, token: config.authToken }
        );
        if (resp) {
          deploymentPath = `/d/${resp}`;
        }
      } catch {
        // No deployment found; skip the deployment chat page
      }
    }

    // Build full page list
    const pages = [...PAGES];
    if (deploymentPath) {
      pages.push({ path: deploymentPath, label: "Deployment Chat", auth: true });
    } else {
      steps.push(
        testStep("Discover deployment for /d/[id]", TestStatus.SKIP, {
          note: "No deployment found or no auth token; skipping deployment chat page",
        })
      );
    }

    // Visit each page and run visual health checks
    for (const page of pages) {
      const url = `${baseUrl}${page.path}`;

      // Skip auth-required pages if no token
      if (page.auth && !config.authToken) {
        steps.push(
          testStep(`Navigate: ${page.label}`, TestStatus.SKIP, {
            note: "Auth required but no token provided",
          })
        );
        continue;
      }

      // Navigate
      try {
        const loadTime = await session.navigate(url);
        steps.push(
          testStep(
            `Navigate: ${page.label}`,
            loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN,
            { loadTime: `${loadTime}ms`, url }
          )
        );
      } catch (err) {
        steps.push(
          testStep(`Navigate: ${page.label}`, TestStatus.FAIL, {
            error: err.message,
            url,
          })
        );
        continue; // Can't check visual health if navigation failed
      }

      // Wait for page to settle (animations, lazy loading, etc.)
      await session.page.waitForTimeout(2000);

      // Run visual health check
      const { step, issues } = await runVisualHealthCheck(session, page.label);
      steps.push(step);
      if (issues.length > 0) {
        allIssues[page.label] = issues;
      }

      // Capture screenshot for the report
      await session.screenshot(`visual-${page.label.toLowerCase().replace(/\s+/g, "-")}`);

      // Check for JavaScript errors on this page
      const recentErrors = session.consoleLogs.filter(
        (l) =>
          (l.type === "error" || l.type === "page_error") &&
          l.url.includes(page.path)
      );
      if (recentErrors.length > 0) {
        steps.push(
          testStep(`Console errors: ${page.label}`, TestStatus.WARN, {
            errorCount: recentErrors.length,
            firstError: recentErrors[0]?.text?.slice(0, 100),
          })
        );
      }
    }

    // Summary step
    const totalIssues = Object.values(allIssues).reduce((sum, arr) => sum + arr.length, 0);
    const pagesWithIssues = Object.keys(allIssues).length;
    const highIssues = Object.values(allIssues)
      .flat()
      .filter((i) => i.severity === "high").length;

    steps.push(
      testStep(
        "Visual regression summary",
        highIssues > 0 ? TestStatus.FAIL : totalIssues > 0 ? TestStatus.WARN : TestStatus.PASS,
        {
          totalIssues,
          pagesWithIssues,
          highSeverity: highIssues,
          breakdown: Object.entries(allIssues).map(
            ([page, issues]) => `${page}: ${issues.length} issue(s)`
          ),
        }
      )
    );

    // Log formatted issues for verbose output
    if (totalIssues > 0) {
      for (const [page, issues] of Object.entries(allIssues)) {
        const formatted = formatVisualIssues(issues);
        steps.push(
          testStep(`Visual details: ${page}`, TestStatus.WARN, {
            report: formatted,
          })
        );
      }
    }

    // Check for 5xx server errors across all pages
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep(
        "No server errors (5xx) across all pages",
        serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL,
        { count: serverErrors.length }
      )
    );

  } catch (err) {
    steps.push(testStep("Visual regression persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Visual Regression",
    description: "Automated visual health checks across key pages",
    steps,
    browser: session.getReport(),
  };
}
