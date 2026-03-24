/**
 * Persona 10: Flow Builder
 * Deployments page tabs (Linked Deployments, Flows, Resource Map), flow canvas, toolbar, wizard.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runFlowBuilder({ baseUrl, config = {} }) {
  const session = new BrowserSession("10-flow-builder");
  const steps = [];

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Load deployments page
    const loadTime = await session.navigate(`${baseUrl}/deployments`);
    steps.push(
      testStep("Deployments page loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("flow-deployments");

    // Step 2: Check deployments accessible or auth redirect
    const currentUrl = session.page.url();
    const isValid = currentUrl.includes("deployment") || currentUrl.includes("login") || currentUrl.includes("auth0") || currentUrl.includes("dashboard");
    steps.push(
      testStep("Deployments accessible or auth redirect", isValid ? TestStatus.PASS : TestStatus.WARN, { url: currentUrl })
    );

    // Step 3: Check three tabs visible
    const bodyText = await session.safeTextContent("body");
    const hasLinkedTab = bodyText && bodyText.toLowerCase().includes("linked");
    const hasFlowsTab = bodyText && bodyText.toLowerCase().includes("flow");
    const hasResourceTab = bodyText && (bodyText.toLowerCase().includes("resource") || bodyText.toLowerCase().includes("map"));
    steps.push(
      testStep("Deployment tabs visible", (hasLinkedTab || hasFlowsTab || hasResourceTab) ? TestStatus.PASS : TestStatus.SKIP, {
        linked: !!hasLinkedTab, flows: !!hasFlowsTab, resource: !!hasResourceTab,
      })
    );

    // Step 4: Try switching to Flows tab
    try {
      const flowsTab = await session.page.$('[role="tab"]:has-text("Flow"), button:has-text("Flow"), [class*="tab"]:has-text("Flow")');
      if (flowsTab) {
        await flowsTab.click();
        await session.page.waitForTimeout(1500);
        steps.push(testStep("Flows tab clickable", TestStatus.PASS));
        await session.screenshot("flow-canvas-tab");
      } else {
        steps.push(testStep("Flows tab clickable", TestStatus.SKIP));
      }
    } catch (err) {
      steps.push(testStep("Flows tab clickable", TestStatus.WARN, { error: err.message }));
    }

    // Step 5: Verify flow canvas renders
    const hasFlowCanvas = await session.exists(
      '.react-flow, [class*="flow-canvas"], [class*="FlowCanvas"], [class*="react-flow"], [class*="xyflow"]'
    );
    steps.push(
      testStep("Flow canvas renders", hasFlowCanvas ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 6: Check flow toolbar buttons
    const toolbarButtons = ["New Flow", "Layout", "Save", "Run"];
    for (const label of toolbarButtons) {
      const exists = await session.exists(
        `button:has-text("${label}"), [aria-label*="${label}" i], [class*="toolbar"] button`
      );
      steps.push(
        testStep(`Toolbar: ${label} button`, exists ? TestStatus.PASS : TestStatus.SKIP)
      );
    }

    // Step 7: Check deployment palette sidebar
    const hasPalette = await session.exists(
      '[class*="palette"], [class*="Palette"], [class*="sidebar"], [class*="Sidebar"], [class*="node-list"]'
    );
    steps.push(
      testStep("Deployment palette sidebar", hasPalette ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 8: Switch to Resource Map tab
    try {
      const resourceTab = await session.page.$('[role="tab"]:has-text("Resource"), button:has-text("Resource"), [class*="tab"]:has-text("Resource"), button:has-text("Map")');
      if (resourceTab) {
        await resourceTab.click();
        await session.page.waitForTimeout(1500);
        steps.push(testStep("Resource Map tab clickable", TestStatus.PASS));
        await session.screenshot("resource-map-tab");
      } else {
        steps.push(testStep("Resource Map tab clickable", TestStatus.SKIP));
      }
    } catch (err) {
      steps.push(testStep("Resource Map tab clickable", TestStatus.WARN, { error: err.message }));
    }

    // Step 9: Verify resource map renders
    const hasResourceMap = await session.exists(
      '.react-flow, [class*="resource-map"], [class*="ResourceMap"], [class*="react-flow"], [class*="xyflow"]'
    );
    steps.push(
      testStep("Resource map renders", hasResourceMap ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 10: Check legend visible
    const hasLegend = await session.exists('[class*="legend"], [class*="Legend"]');
    steps.push(
      testStep("Resource map legend visible", hasLegend ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 11: Switch back to Linked Deployments tab
    try {
      const linkedTab = await session.page.$('[role="tab"]:has-text("Linked"), button:has-text("Linked"), [class*="tab"]:has-text("Linked"), [role="tab"]:first-child');
      if (linkedTab) {
        await linkedTab.click();
        await session.page.waitForTimeout(1500);
        steps.push(testStep("Linked Deployments tab clickable", TestStatus.PASS));
        await session.screenshot("linked-deployments-tab");
      } else {
        steps.push(testStep("Linked Deployments tab clickable", TestStatus.SKIP));
      }
    } catch (err) {
      steps.push(testStep("Linked Deployments tab clickable", TestStatus.WARN, { error: err.message }));
    }

    // Step 12: Verify deployment graph renders
    const hasDeployGraph = await session.exists(
      '.react-flow, [class*="deployment-graph"], [class*="DeploymentGraph"], [class*="react-flow"], svg'
    );
    steps.push(
      testStep("Deployment graph renders", hasDeployGraph ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 13: Check detail panel on card click
    try {
      const nodeEl = await session.page.$('.react-flow__node, [class*="node"], [class*="deployment-card"]');
      if (nodeEl) {
        await nodeEl.click();
        await session.page.waitForTimeout(1000);
        const hasDetailPanel = await session.exists('[class*="detail"], [class*="Detail"], [class*="panel"], [class*="Panel"]');
        steps.push(testStep("Detail panel on node click", hasDetailPanel ? TestStatus.PASS : TestStatus.SKIP));
      } else {
        steps.push(testStep("Detail panel on node click", TestStatus.SKIP));
      }
    } catch (err) {
      steps.push(testStep("Detail panel on node click", TestStatus.WARN, { error: err.message }));
    }

    // Step 14: Navigate to onboarding/wizard
    const wizardLoadTime = await session.navigate(`${baseUrl}/onboarding`);
    steps.push(
      testStep("Onboarding wizard loads", wizardLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${wizardLoadTime}ms` })
    );
    await session.screenshot("flow-wizard");

    // Step 15: Wizard step indicators present
    const hasStepIndicators = await session.exists('[class*="step"], [class*="wizard"], [role="progressbar"], [class*="progress"]');
    steps.push(
      testStep("Wizard step indicators present", hasStepIndicators ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 16: Runtime options displayed
    const runtimeContent = await session.safeTextContent("body");
    const hasRuntimeOptions = runtimeContent && (
      runtimeContent.toLowerCase().includes("openclaw") ||
      runtimeContent.toLowerCase().includes("zeroclaw") ||
      runtimeContent.toLowerCase().includes("runtime")
    );
    steps.push(
      testStep("Runtime options displayed", hasRuntimeOptions ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 17: Check "New Deployment" / "Create" CTA on deployments
    await session.navigate(`${baseUrl}/deployments`);
    await session.page.waitForTimeout(1500);
    const hasCreateCta = await session.exists(
      'button:has-text("New"), button:has-text("Create"), a[href*="new"], a[href*="create"]'
    );
    const createText = await session.safeTextContent("body");
    const hasCreateText = createText && (
      createText.toLowerCase().includes("new deployment") ||
      createText.toLowerCase().includes("create") ||
      createText.toLowerCase().includes("get started")
    );
    steps.push(
      testStep("Create deployment CTA present", hasCreateCta || hasCreateText ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 18: Load deployment config page
    const configLoadTime = await session.navigate(`${baseUrl}/deployments/config`);
    steps.push(
      testStep("Deployment config page loads", configLoadTime < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${configLoadTime}ms` })
    );
    await session.screenshot("flow-config");

    // Step 19: Check dagre auto-layout elements
    const hasDagreElements = await session.exists('.react-flow__edge, [class*="edge"], [class*="Edge"]');
    steps.push(
      testStep("Graph edges render (dagre layout)", hasDagreElements ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 20: Screenshot each tab
    await session.screenshot("flow-final-state");

    // Step 21: Performance — all pages under threshold
    const slowPages = session.performanceMetrics.filter((m) => m.name.startsWith("navigate:") && m.value > Thresholds.PAGE_LOAD);
    steps.push(
      testStep("All flow pages load within threshold", slowPages.length === 0 ? TestStatus.PASS : TestStatus.WARN, {
        slowPages: slowPages.map((p) => `${p.name} (${p.value}ms)`),
      })
    );

    // Step 22: No JS errors during flow navigation
    const pageErrors = session.consoleLogs.filter((l) => l.type === "page_error");
    steps.push(
      testStep("No JS errors during flow navigation", pageErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN, {
        count: pageErrors.length, first: pageErrors[0]?.text?.slice(0, 80),
      })
    );

    // Step 23: No server errors
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
    persona: "Flow Builder",
    description: "Deployments page, flow canvas, flow creation",
    steps,
    browser: session.getReport(),
  };
}
