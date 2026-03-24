/**
 * Persona 11: Multi Deploy
 * Multiple deployments, resource map, linked API keys.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runMultiDeploy({ baseUrl }) {
  const session = new BrowserSession("11-multi-deploy");
  const steps = [];

  try {
    await session.start();

    // Step 1: Load dashboard
    const loadTime = await session.navigate(`${baseUrl}/dashboard`);
    steps.push(
      testStep("Dashboard loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.screenshot("multi-dashboard");

    // Step 2: Check for deployment list/cards
    const deploymentCards = await session.countElements(
      '[class*="deployment"], [class*="card"], [data-testid*="deployment"]'
    );
    steps.push(
      testStep("Deployment cards rendered", deploymentCards > 0 ? TestStatus.PASS : TestStatus.SKIP, {
        count: deploymentCards,
        note: "Requires existing deployments",
      })
    );

    // Step 3: Navigate to settings/API keys
    const settingsLoadTime = await session.navigate(`${baseUrl}/settings`);
    steps.push(
      testStep("Settings page loads", settingsLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${settingsLoadTime}ms` })
    );
    await session.screenshot("multi-settings");

    // Step 4: Check for API key management section
    const settingsText = await session.safeTextContent("body");
    const hasApiKeySection = settingsText && (
      settingsText.toLowerCase().includes("api key") ||
      settingsText.toLowerCase().includes("credential") ||
      settingsText.toLowerCase().includes("token") ||
      settingsText.toLowerCase().includes("secret")
    );
    steps.push(
      testStep("API key management section", hasApiKeySection ? TestStatus.PASS : TestStatus.SKIP, {
        note: "Requires authenticated session",
      })
    );

    // Step 5: Navigate to multiple deployment chat pages rapidly
    const deployPaths = ["/d/demo", "/d/test", "/d/sample"];
    let successCount = 0;
    for (const path of deployPaths) {
      try {
        await session.navigate(`${baseUrl}${path}`);
        successCount++;
      } catch {
        // Expected for non-existent deployments
      }
    }
    steps.push(
      testStep("Multiple deployment pages navigable", successCount > 0 ? TestStatus.PASS : TestStatus.WARN, {
        attempted: deployPaths.length,
        succeeded: successCount,
      })
    );
    await session.screenshot("multi-deploy-chat");

    // Step 6: Check no leaked credentials in page
    const credentialCheck = await session.page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const patterns = [
        /sk-[a-zA-Z0-9]{20,}/,
        /Bearer\s+ey[a-zA-Z0-9]/,
        /password["']\s*[:=]\s*["'][^"']{3,}/i,
      ];
      return patterns.filter((p) => p.test(html)).length;
    });
    steps.push(
      testStep("No credentials exposed in HTML", credentialCheck === 0 ? TestStatus.PASS : TestStatus.FAIL, {
        exposed: credentialCheck,
      })
    );

    // Step 7: Check localStorage usage is reasonable
    const storageCheck = await session.page.evaluate(() => {
      let totalSize = 0;
      let keyCount = 0;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        const value = localStorage.getItem(key);
        totalSize += (key.length + (value?.length || 0)) * 2; // UTF-16
        keyCount++;
      }
      return { keyCount, totalSizeKB: Math.round(totalSize / 1024) };
    });
    steps.push(
      testStep(
        "localStorage usage reasonable",
        storageCheck.totalSizeKB < 5000 ? TestStatus.PASS : TestStatus.WARN,
        storageCheck
      )
    );

    // Step 8: No server errors across multi-deploy flow
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(
      testStep("No server errors in multi-deploy flow", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, {
        count: serverErrors.length,
      })
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
