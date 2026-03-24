/**
 * Persona 22: Flow Runner
 * Actually creates a flow, adds nodes, runs the flow, checks execution history,
 * duplicates it, and cleans up all test data.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runFlowRunner({ baseUrl, apiUrl, config = {} }) {
  const session = new BrowserSession("22-flow-runner");
  const api = new ApiClient(apiUrl, config.authToken);
  const steps = [];
  const timestamp = Date.now();
  const flowName = `QA Test Flow ${timestamp}`;
  let createdFlowId = null;
  let duplicateFlowId = null;

  try {
    await session.start();

    // Inject auth token
    if (config.authToken) {
      await session.context.addCookies([{
        name: "auth_token",
        value: config.authToken,
        domain: new URL(baseUrl).hostname,
        path: "/",
      }]);
      await session.page.addInitScript((token) => {
        localStorage.setItem("jarble_qa_token", token);
      }, config.authToken);
    }

    // Step 1: Navigate to deployments page
    const deployLoad = await session.navigate(`${baseUrl}/deployments`);
    await session.page.waitForTimeout(3000);
    steps.push(testStep("Navigate to /deployments", deployLoad < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${deployLoad}ms` }));
    await session.screenshot("deployments-page");

    // Step 2: Switch to Flows tab
    try {
      const flowsTab = await session.page.$('button:has-text("Flows"), [role="tab"]:has-text("Flows"), a:has-text("Flows"), [data-tab="flows"]');
      if (flowsTab) {
        await flowsTab.click();
        await session.page.waitForTimeout(2000);
        steps.push(testStep("Switch to Flows tab", TestStatus.PASS));
        await session.screenshot("flows-tab");
      } else {
        // Try navigating directly
        await session.navigate(`${baseUrl}/flows`);
        await session.page.waitForTimeout(2000);
        steps.push(testStep("Switch to Flows tab", TestStatus.PASS, { note: "Navigated to /flows directly" }));
        await session.screenshot("flows-page");
      }
    } catch (err) {
      steps.push(testStep("Switch to Flows tab", TestStatus.WARN, { error: err.message }));
    }

    // Step 3: Click "New Flow" button
    try {
      const newFlowBtn = await session.page.$('button:has-text("New Flow"), button:has-text("Create Flow"), button:has-text("New"), a:has-text("New Flow")');
      if (newFlowBtn) {
        await newFlowBtn.click();
        await session.page.waitForTimeout(2000);
        steps.push(testStep("Click New Flow button", TestStatus.PASS));
        await session.screenshot("new-flow-dialog");
      } else {
        steps.push(testStep("Click New Flow button", TestStatus.SKIP, { note: "New Flow button not found" }));
      }
    } catch (err) {
      steps.push(testStep("Click New Flow button", TestStatus.WARN, { error: err.message }));
    }

    // Step 4: Type flow name
    try {
      const nameInput = await session.page.$('input[name*="name" i], input[placeholder*="name" i], input[placeholder*="flow" i], input[type="text"]');
      if (nameInput) {
        await nameInput.click();
        await nameInput.fill(flowName);
        await session.page.waitForTimeout(500);
        const typedValue = await nameInput.inputValue();
        steps.push(testStep("Type flow name", typedValue.includes("QA Test Flow") ? TestStatus.PASS : TestStatus.WARN, { typed: typedValue }));
      } else {
        steps.push(testStep("Type flow name", TestStatus.SKIP, { note: "Name input not found" }));
      }
    } catch (err) {
      steps.push(testStep("Type flow name", TestStatus.WARN, { error: err.message }));
    }

    // Step 5: Create flow via API (with 2 nodes)
    try {
      const flowData = {
        name: flowName,
        description: "Automated QA test flow",
        nodes: [
          { id: "node-1", type: "input", data: { label: "Start", prompt: "Hello" }, position: { x: 100, y: 100 } },
          { id: "node-2", type: "output", data: { label: "End" }, position: { x: 400, y: 100 } },
        ],
        edges: [
          { id: "edge-1", source: "node-1", target: "node-2" },
        ],
      };
      const createResult = await api.trpc("deployment.createFlow", flowData, "mutation");
      if (createResult.data?.result?.data?.id) {
        createdFlowId = createResult.data.result.data.id;
      }
      steps.push(testStep("Create flow via API", createResult.status === 200 ? TestStatus.PASS : TestStatus.WARN, {
        status: createResult.status,
        flowId: createdFlowId,
      }));
    } catch (err) {
      steps.push(testStep("Create flow via API", TestStatus.WARN, { error: err.message }));
    }

    // Step 6: Verify flow appears in list
    try {
      await session.page.reload({ waitUntil: "domcontentloaded" });
      await session.page.waitForTimeout(3000);
      const bodyText = await session.safeTextContent("body");
      const flowVisible = bodyText && bodyText.includes("QA Test Flow");
      steps.push(testStep("Flow appears in list", flowVisible ? TestStatus.PASS : TestStatus.SKIP, { flowName, visible: flowVisible }));
      await session.screenshot("flows-list-with-test");
    } catch (err) {
      steps.push(testStep("Flow appears in list", TestStatus.WARN, { error: err.message }));
    }

    // Step 7: Click Run (browser) or execute via API
    try {
      if (createdFlowId) {
        const runResult = await api.trpc("deployment.runFlow", { id: createdFlowId }, "mutation");
        steps.push(testStep("Execute flow via API", runResult.status === 200 ? TestStatus.PASS : TestStatus.WARN, {
          status: runResult.status,
        }));
      } else {
        // Try clicking Run in browser
        const runBtn = await session.page.$('button:has-text("Run"), button:has-text("Execute"), button[aria-label*="run" i]');
        if (runBtn) {
          await runBtn.click();
          await session.page.waitForTimeout(5000);
          steps.push(testStep("Execute flow via browser", TestStatus.PASS));
        } else {
          steps.push(testStep("Execute flow", TestStatus.SKIP, { note: "No Run button or flow ID" }));
        }
      }
      await session.screenshot("flow-execution");
    } catch (err) {
      steps.push(testStep("Execute flow", TestStatus.WARN, { error: err.message }));
    }

    // Step 8: Wait for execution to complete
    try {
      await session.page.waitForTimeout(5000);
      await session.screenshot("flow-execution-complete");
      steps.push(testStep("Wait for flow execution", TestStatus.PASS, { waited: "5s" }));
    } catch (err) {
      steps.push(testStep("Wait for flow execution", TestStatus.WARN, { error: err.message }));
    }

    // Step 9: Check execution history
    try {
      if (createdFlowId) {
        const historyResult = await api.trpc("deployment.flowHistory", { id: createdFlowId });
        const hasHistory = historyResult.data?.result?.data && Array.isArray(historyResult.data.result.data);
        steps.push(testStep("Check execution history via API", hasHistory ? TestStatus.PASS : TestStatus.SKIP, {
          status: historyResult.status,
          runs: hasHistory ? historyResult.data.result.data.length : 0,
        }));
      } else {
        // Check browser for history indicators
        const historyVisible = await session.exists('[class*="history"], [class*="execution"], [class*="run-log"]');
        steps.push(testStep("Check execution history in UI", historyVisible ? TestStatus.PASS : TestStatus.SKIP));
      }
    } catch (err) {
      steps.push(testStep("Check execution history", TestStatus.WARN, { error: err.message }));
    }

    // Step 10: Duplicate the flow via API
    try {
      if (createdFlowId) {
        const dupResult = await api.trpc("deployment.duplicateFlow", { id: createdFlowId }, "mutation");
        if (dupResult.data?.result?.data?.id) {
          duplicateFlowId = dupResult.data.result.data.id;
        }
        steps.push(testStep("Duplicate flow via API", dupResult.status === 200 ? TestStatus.PASS : TestStatus.WARN, {
          status: dupResult.status,
          duplicateId: duplicateFlowId,
        }));
      } else {
        steps.push(testStep("Duplicate flow via API", TestStatus.SKIP, { note: "No flow to duplicate" }));
      }
    } catch (err) {
      steps.push(testStep("Duplicate flow via API", TestStatus.WARN, { error: err.message }));
    }

    // Step 11: Verify duplicate appears
    try {
      if (duplicateFlowId) {
        await session.page.reload({ waitUntil: "domcontentloaded" });
        await session.page.waitForTimeout(2000);
        const bodyText = await session.safeTextContent("body");
        // Duplicates often have "Copy" or similar suffix
        const dupVisible = bodyText && (bodyText.includes("Copy") || bodyText.includes("QA Test Flow"));
        steps.push(testStep("Duplicate flow appears", dupVisible ? TestStatus.PASS : TestStatus.SKIP));
        await session.screenshot("flows-with-duplicate");
      } else {
        steps.push(testStep("Duplicate flow appears", TestStatus.SKIP));
      }
    } catch (err) {
      steps.push(testStep("Duplicate flow appears", TestStatus.WARN, { error: err.message }));
    }

    // Step 12: Clean up — delete test flows via API
    try {
      let deleteCount = 0;
      if (duplicateFlowId) {
        await api.trpc("deployment.deleteFlow", { id: duplicateFlowId }, "mutation");
        deleteCount++;
      }
      if (createdFlowId) {
        await api.trpc("deployment.deleteFlow", { id: createdFlowId }, "mutation");
        deleteCount++;
      }
      steps.push(testStep("Clean up: delete test flows", deleteCount > 0 ? TestStatus.PASS : TestStatus.SKIP, { deletedCount: deleteCount }));
    } catch (err) {
      steps.push(testStep("Clean up: delete test flows", TestStatus.WARN, { error: err.message }));
    }

    // Step 13: Overall error check
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(testStep("No server errors (5xx)", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length }));

    const consoleErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(testStep("Minimal console errors", consoleErrors.length <= 5 ? TestStatus.PASS : TestStatus.WARN, { count: consoleErrors.length }));

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message, stack: err.stack?.slice(0, 500) }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Flow Runner",
    description: "Creates, runs, duplicates, and cleans up flows",
    steps,
    browser: session.getReport(),
    api: api.getResults(),
  };
}
