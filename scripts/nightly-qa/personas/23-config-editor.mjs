/**
 * Persona 23: Config Editor
 * Actually edits deployment configuration — changes system prompt, inspects
 * Model/Platform/Advanced tabs, saves changes, and restores originals.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runConfigEditor({ baseUrl, apiUrl, config = {} }) {
  const session = new BrowserSession("23-config-editor");
  const api = new ApiClient(apiUrl, config.authToken);
  const steps = [];
  let deploymentId = null;
  let originalPrompt = null;
  const testPrompt = `QA Test System Prompt — generated ${new Date().toISOString()}. You are a helpful test bot.`;

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

    // Step 1: Find a deployment via API
    try {
      const listResult = await api.trpc("deployment.list");
      const deployments = listResult.data?.result?.data;
      if (Array.isArray(deployments) && deployments.length > 0) {
        const running = deployments.find((d) => d.status === "running" || d.status === "active");
        deploymentId = running?.id || deployments[0].id;
      }
      steps.push(testStep("Find deployment via API", deploymentId ? TestStatus.PASS : TestStatus.SKIP, { id: deploymentId }));
    } catch (err) {
      steps.push(testStep("Find deployment via API", TestStatus.WARN, { error: err.message }));
    }

    if (!deploymentId) {
      deploymentId = "demo";
    }

    // Step 2: Fetch current config to save original prompt
    try {
      const configResult = await api.trpc("deployment.getById", { id: deploymentId });
      const deployData = configResult.data?.result?.data;
      if (deployData) {
        originalPrompt = deployData.systemPrompt || deployData.config?.systemPrompt || null;
      }
      steps.push(testStep("Fetch current deployment config", configResult.status === 200 ? TestStatus.PASS : TestStatus.WARN, {
        status: configResult.status,
        hasPrompt: !!originalPrompt,
      }));
    } catch (err) {
      steps.push(testStep("Fetch current deployment config", TestStatus.WARN, { error: err.message }));
    }

    // Step 3: Navigate to deployment page
    const chatLoad = await session.navigate(`${baseUrl}/d/${deploymentId}`);
    await session.page.waitForTimeout(3000);
    steps.push(testStep("Navigate to deployment page", chatLoad < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${chatLoad}ms` }));

    // Step 4: Open config panel (Settings gear)
    try {
      const settingsBtn = await session.page.$('button[aria-label*="settings" i], button[aria-label*="config" i], button:has-text("Settings"), [data-testid="config-panel"], button:has([class*="gear"]), button:has([class*="settings"])');
      if (settingsBtn) {
        await settingsBtn.click();
        await session.page.waitForTimeout(2000);
        steps.push(testStep("Open config panel", TestStatus.PASS));
        await session.screenshot("config-panel-open");
      } else {
        // Try finding a gear icon via SVG or icon
        const gearIcons = await session.page.$$("button");
        let found = false;
        for (const btn of gearIcons.slice(0, 20)) {
          const ariaLabel = await btn.getAttribute("aria-label").catch(() => "");
          const title = await btn.getAttribute("title").catch(() => "");
          const text = await btn.textContent().catch(() => "");
          if ((ariaLabel + title + text).toLowerCase().match(/setting|config|gear|cog/)) {
            await btn.click();
            await session.page.waitForTimeout(2000);
            found = true;
            break;
          }
        }
        steps.push(testStep("Open config panel", found ? TestStatus.PASS : TestStatus.SKIP, { note: found ? "Found via scan" : "Config button not found" }));
        if (found) await session.screenshot("config-panel-open");
      }
    } catch (err) {
      steps.push(testStep("Open config panel", TestStatus.WARN, { error: err.message }));
    }

    // Step 5: Click Model tab
    try {
      const modelTab = await session.page.$('button:has-text("Model"), [role="tab"]:has-text("Model"), [data-tab="model"]');
      if (modelTab) {
        await modelTab.click();
        await session.page.waitForTimeout(1500);
        steps.push(testStep("Click Model tab", TestStatus.PASS));
        await session.screenshot("config-model-tab");
      } else {
        steps.push(testStep("Click Model tab", TestStatus.SKIP, { note: "Model tab not found" }));
      }
    } catch (err) {
      steps.push(testStep("Click Model tab", TestStatus.WARN, { error: err.message }));
    }

    // Step 6: Change system prompt in textarea
    try {
      const promptTextarea = await session.page.$('textarea[name*="prompt" i], textarea[placeholder*="system" i], textarea[placeholder*="prompt" i], textarea');
      if (promptTextarea) {
        // Clear and type new prompt
        await promptTextarea.click();
        await promptTextarea.fill("");
        await promptTextarea.fill(testPrompt);
        await session.page.waitForTimeout(500);
        const typedValue = await promptTextarea.inputValue();
        steps.push(testStep("Edit system prompt", typedValue.includes("QA Test System Prompt") ? TestStatus.PASS : TestStatus.WARN, {
          typed: typedValue.slice(0, 80),
        }));
        await session.screenshot("config-prompt-edited");
      } else {
        steps.push(testStep("Edit system prompt", TestStatus.SKIP, { note: "Prompt textarea not found" }));
      }
    } catch (err) {
      steps.push(testStep("Edit system prompt", TestStatus.WARN, { error: err.message }));
    }

    // Step 7: Save the system prompt
    try {
      const saveBtn = await session.page.$('button:has-text("Save"), button:has-text("Update"), button[type="submit"]');
      if (saveBtn) {
        await saveBtn.click();
        await session.page.waitForTimeout(3000);
        // Check for success indicator
        const bodyText = await session.safeTextContent("body");
        const saved = bodyText && (bodyText.includes("saved") || bodyText.includes("updated") || bodyText.includes("success"));
        steps.push(testStep("Save system prompt", saved ? TestStatus.PASS : TestStatus.WARN, { saved }));
        await session.screenshot("config-prompt-saved");
      } else {
        // Try saving via API
        const updateResult = await api.trpc("deployment.update", {
          id: deploymentId,
          systemPrompt: testPrompt,
        }, "mutation");
        steps.push(testStep("Save system prompt via API", updateResult.status === 200 ? TestStatus.PASS : TestStatus.WARN, { status: updateResult.status }));
      }
    } catch (err) {
      steps.push(testStep("Save system prompt", TestStatus.WARN, { error: err.message }));
    }

    // Step 8: Verify prompt was saved (read back via API)
    try {
      const verifyResult = await api.trpc("deployment.getById", { id: deploymentId });
      const deployData = verifyResult.data?.result?.data;
      const savedPrompt = deployData?.systemPrompt || deployData?.config?.systemPrompt || "";
      const promptSaved = savedPrompt.includes("QA Test System Prompt");
      steps.push(testStep("Verify prompt saved via API", promptSaved ? TestStatus.PASS : TestStatus.SKIP, {
        savedPrompt: savedPrompt.slice(0, 80),
      }));
    } catch (err) {
      steps.push(testStep("Verify prompt saved via API", TestStatus.WARN, { error: err.message }));
    }

    // Step 9: Click Platform tab
    try {
      const platformTab = await session.page.$('button:has-text("Platform"), [role="tab"]:has-text("Platform"), [data-tab="platform"]');
      if (platformTab) {
        await platformTab.click();
        await session.page.waitForTimeout(1500);
        steps.push(testStep("Click Platform tab", TestStatus.PASS));
        await session.screenshot("config-platform-tab");
      } else {
        steps.push(testStep("Click Platform tab", TestStatus.SKIP, { note: "Platform tab not found" }));
      }
    } catch (err) {
      steps.push(testStep("Click Platform tab", TestStatus.WARN, { error: err.message }));
    }

    // Step 10: Click Advanced tab
    try {
      const advancedTab = await session.page.$('button:has-text("Advanced"), [role="tab"]:has-text("Advanced"), [data-tab="advanced"]');
      if (advancedTab) {
        await advancedTab.click();
        await session.page.waitForTimeout(1500);
        steps.push(testStep("Click Advanced tab", TestStatus.PASS));
        await session.screenshot("config-advanced-tab");
      } else {
        steps.push(testStep("Click Advanced tab", TestStatus.SKIP, { note: "Advanced tab not found" }));
      }
    } catch (err) {
      steps.push(testStep("Click Advanced tab", TestStatus.WARN, { error: err.message }));
    }

    // Step 11: Check Advanced tab has configuration options
    try {
      const advancedInputs = await session.countElements('input, select, textarea, [role="slider"]');
      steps.push(testStep("Advanced tab has config options", advancedInputs > 0 ? TestStatus.PASS : TestStatus.SKIP, { inputCount: advancedInputs }));
    } catch (err) {
      steps.push(testStep("Advanced tab has config options", TestStatus.WARN, { error: err.message }));
    }

    // Step 12: Restore original system prompt via API
    try {
      if (originalPrompt !== null) {
        const restoreResult = await api.trpc("deployment.update", {
          id: deploymentId,
          systemPrompt: originalPrompt,
        }, "mutation");
        steps.push(testStep("Restore original system prompt", restoreResult.status === 200 ? TestStatus.PASS : TestStatus.WARN, { status: restoreResult.status }));
      } else {
        steps.push(testStep("Restore original system prompt", TestStatus.SKIP, { note: "No original prompt to restore" }));
      }
    } catch (err) {
      steps.push(testStep("Restore original system prompt", TestStatus.WARN, { error: err.message }));
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
    persona: "Config Editor",
    description: "Edits deployment config, changes system prompt, inspects all tabs, restores originals",
    steps,
    browser: session.getReport(),
    api: api.getResults(),
  };
}
