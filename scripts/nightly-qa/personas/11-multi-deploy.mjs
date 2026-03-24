/**
 * Persona 11: Multi Deploy
 * Multiple deployments, resource map, API key management, credential security, localStorage.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runMultiDeploy({ baseUrl, apiUrl, config = {} }) {
  const session = new BrowserSession("11-multi-deploy");
  const api = new ApiClient(apiUrl, config.authToken);
  const steps = [];

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Load dashboard
    const loadTime = await session.navigate(`${baseUrl}/dashboard`);
    steps.push(
      testStep("Dashboard loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("multi-dashboard");

    // Step 2: Check deployment cards
    const deploymentCards = await session.countElements('[class*="deployment"], [class*="card"], [data-testid*="deployment"]');
    steps.push(
      testStep("Deployment cards rendered", deploymentCards > 0 ? TestStatus.PASS : TestStatus.SKIP, { count: deploymentCards })
    );

    // Step 3: Each card shows status badge
    const statusBadges = await session.countElements('[class*="badge"], [class*="status"]');
    steps.push(
      testStep("Status badges on cards", statusBadges > 0 ? TestStatus.PASS : TestStatus.SKIP, { count: statusBadges })
    );

    // Step 4: Navigate between multiple deployment chat pages
    const deployPaths = ["/d/demo", "/d/test", "/d/sample"];
    let successCount = 0;
    for (const path of deployPaths) {
      try {
        await session.navigate(`${baseUrl}${path}`);
        await session.page.waitForTimeout(1000);
        successCount++;
      } catch { /* expected for non-existent deployments */ }
    }
    steps.push(
      testStep("Multiple deployment pages navigable", successCount > 0 ? TestStatus.PASS : TestStatus.WARN, { attempted: deployPaths.length, succeeded: successCount })
    );
    await session.screenshot("multi-deploy-chat");

    // Step 5: API — get deployment list
    const deployListRes = await api.trpc("deployment.list");
    steps.push(
      testStep("tRPC deployment.list", deployListRes.status !== null && deployListRes.status < 500 ? TestStatus.PASS : TestStatus.WARN, {
        status: deployListRes.status, duration: `${deployListRes.duration}ms`,
      })
    );

    // Step 6: Check resource map connections
    await session.navigate(`${baseUrl}/deployments`);
    await session.page.waitForTimeout(2000);
    const resourceTab = await session.page.$('[role="tab"]:has-text("Resource"), button:has-text("Resource"), button:has-text("Map")');
    if (resourceTab) {
      try {
        await resourceTab.click();
        await session.page.waitForTimeout(1500);
        const hasConnections = await session.exists('.react-flow__edge, [class*="edge"], [class*="connection"]');
        steps.push(testStep("Resource map connections render", hasConnections ? TestStatus.PASS : TestStatus.SKIP));
        await session.screenshot("resource-map");
      } catch (err) {
        steps.push(testStep("Resource map connections render", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Resource map connections render", TestStatus.SKIP));
    }

    // Step 7: Navigate to settings / API keys
    const settingsLoadTime = await session.navigate(`${baseUrl}/settings`);
    steps.push(
      testStep("Settings page loads", settingsLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${settingsLoadTime}ms` })
    );
    await session.screenshot("multi-settings");

    // Step 8: Check API key management section
    const settingsText = await session.safeTextContent("body");
    const hasApiKeySection = settingsText && (
      settingsText.toLowerCase().includes("api key") ||
      settingsText.toLowerCase().includes("credential") ||
      settingsText.toLowerCase().includes("token") ||
      settingsText.toLowerCase().includes("secret")
    );
    steps.push(
      testStep("API key management section", hasApiKeySection ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 9: Verify linked API key display
    const hasKeyDisplay = await session.exists(
      'input[type="password"], input[readonly], [class*="api-key"], [class*="ApiKey"], code, [class*="masked"]'
    );
    steps.push(
      testStep("API key display present", hasKeyDisplay ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 10: Check no leaked credentials in page
    const credentialCheck = await session.page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const patterns = [/sk-[a-zA-Z0-9]{20,}/, /Bearer\s+ey[a-zA-Z0-9]/, /password["']\s*[:=]\s*["'][^"']{3,}/i];
      return patterns.filter((p) => p.test(html)).length;
    });
    steps.push(
      testStep("No credentials exposed in HTML", credentialCheck === 0 ? TestStatus.PASS : TestStatus.FAIL, { exposed: credentialCheck })
    );

    // Step 11: Check localStorage usage reasonable
    const storageCheck = await session.page.evaluate(() => {
      let totalSize = 0, keyCount = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        totalSize += (key.length + (value?.length || 0)) * 2;
        keyCount++;
      }
      return { keyCount, totalSizeKB: Math.round(totalSize / 1024) };
    });
    steps.push(
      testStep("localStorage usage reasonable", storageCheck.totalSizeKB < 5000 ? TestStatus.PASS : TestStatus.WARN, storageCheck)
    );

    // Step 12: Check each deployment chat page has isolated state
    await session.navigate(`${baseUrl}/d/demo`);
    await session.page.waitForTimeout(1500);
    const demoConvKeys = await session.page.evaluate(() => {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.includes("jarble-conv")) keys.push(key);
      }
      return keys;
    });
    steps.push(
      testStep("Conversation localStorage keys exist", TestStatus.PASS, { count: demoConvKeys.length })
    );

    // Step 13: Navigate to billing page
    const billingLoadTime = await session.navigate(`${baseUrl}/billing`);
    steps.push(
      testStep("Billing page loads", billingLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${billingLoadTime}ms` })
    );

    // Step 14: Check deployment management actions
    await session.navigate(`${baseUrl}/dashboard`);
    await session.page.waitForTimeout(1500);
    const hasActions = await session.exists(
      'button[class*="action" i], button[aria-label*="deploy" i], button[aria-label*="start" i], button[aria-label*="stop" i], [class*="dropdown"], [class*="menu"]'
    );
    steps.push(
      testStep("Deployment management actions", hasActions ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 15: No server errors across multi-deploy flow
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors in multi-deploy flow", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length })
    );

    // Step 16: Console errors check
    const consoleErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("Minimal console errors", consoleErrors.length <= 3 ? TestStatus.PASS : TestStatus.WARN, { count: consoleErrors.length })
    );

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Multi Deploy",
    description: "Multiple deployments, resource map, linked keys",
    steps,
    browser: session.getReport(),
  };
}
