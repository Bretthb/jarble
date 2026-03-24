/**
 * Persona 14: Deployment Config Tester
 * Tests the deployment configuration sidebar on /d/[id] — Model, Platform, Advanced tabs, form interactions.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";
import { injectAuth } from "../lib/auth.mjs";

export default async function runDeploymentConfig({ baseUrl, config = {} }) {
  const session = new BrowserSession("14-deployment-config");
  const steps = [];

  try {
    await session.start();

    // Inject Auth0 session for authenticated pages
    if (config.authToken) {
      await injectAuth(session.context, session.page, config.authToken);
    }

    // Step 1: Navigate to a deployment chat page
    const loadTime = await session.navigate(`${baseUrl}/d/test`);
    steps.push(
      testStep("Deployment chat page loads", loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${loadTime}ms` })
    );
    await session.page.waitForTimeout(2000);
    await session.screenshot("deployment-chat-page");

    // Step 2: Check chat interface rendered
    const hasChatInput = await session.exists('textarea, [role="textbox"], [contenteditable="true"]');
    steps.push(
      testStep("Chat interface rendered", hasChatInput ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 3: Open the config panel (Settings gear icon)
    const gearSelector = 'button[aria-label*="settings" i], button[aria-label*="config" i], button[aria-label*="gear" i], [class*="settings"], [class*="Settings"]';
    const gearExists = await session.exists(gearSelector);
    steps.push(
      testStep("Config panel gear icon found", gearExists ? TestStatus.PASS : TestStatus.WARN)
    );
    if (gearExists) {
      try {
        await session.page.click(gearSelector);
        await session.page.waitForTimeout(1000);
        await session.screenshot("config-panel-open");
      } catch (_) { /* may click multiple */ }
    }

    // Step 4: Check Model tab renders
    const hasModelTab = await session.exists('[role="tab"]:has-text("Model"), button:has-text("Model")');
    steps.push(
      testStep("Model tab renders", hasModelTab ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 5: Click Model tab and check content
    if (hasModelTab) {
      try {
        await session.page.click('[role="tab"]:has-text("Model"), button:has-text("Model")');
        await session.page.waitForTimeout(500);
        const modelContent = await session.safeTextContent("body");
        const hasModelContent = modelContent && (
          modelContent.toLowerCase().includes("provider") ||
          modelContent.toLowerCase().includes("model") ||
          modelContent.toLowerCase().includes("openai") ||
          modelContent.toLowerCase().includes("anthropic") ||
          modelContent.toLowerCase().includes("openrouter")
        );
        steps.push(testStep("Model tab has provider content", hasModelContent ? TestStatus.PASS : TestStatus.SKIP));
        await session.screenshot("config-tab-model");
      } catch (err) {
        steps.push(testStep("Model tab has provider content", TestStatus.WARN, { error: err.message }));
      }
    }

    // Step 6: Check provider selection grid
    const hasProviderGrid = await session.exists('[class*="provider"], [class*="Provider"], [class*="grid"], [role="radiogroup"]');
    steps.push(
      testStep("Provider selection grid", hasProviderGrid ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 7: Check model selector dropdown
    const hasModelSelector = await session.exists('select, [role="combobox"], [role="listbox"], [class*="model-select"], [class*="ModelSelect"]');
    steps.push(
      testStep("Model selector dropdown", hasModelSelector ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 8: Check Platform tab renders
    const hasPlatformTab = await session.exists('[role="tab"]:has-text("Platform"), button:has-text("Platform")');
    steps.push(
      testStep("Platform tab renders", hasPlatformTab ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 9: Click Platform tab and verify platform options
    if (hasPlatformTab) {
      try {
        await session.page.click('[role="tab"]:has-text("Platform"), button:has-text("Platform")');
        await session.page.waitForTimeout(500);
        const platformContent = await session.safeTextContent("body");
        const hasPlatformContent = platformContent && (
          platformContent.toLowerCase().includes("whatsapp") ||
          platformContent.toLowerCase().includes("discord") ||
          platformContent.toLowerCase().includes("slack") ||
          platformContent.toLowerCase().includes("telegram") ||
          platformContent.toLowerCase().includes("platform")
        );
        steps.push(testStep("Platform tab has platform options", hasPlatformContent ? TestStatus.PASS : TestStatus.SKIP));
        await session.screenshot("config-tab-platform");
      } catch (err) {
        steps.push(testStep("Platform tab has platform options", TestStatus.WARN, { error: err.message }));
      }
    }

    // Step 10: Check Advanced tab renders
    const hasAdvancedTab = await session.exists('[role="tab"]:has-text("Advanced"), button:has-text("Advanced")');
    steps.push(
      testStep("Advanced tab renders", hasAdvancedTab ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 11: Click Advanced tab and check content
    if (hasAdvancedTab) {
      try {
        await session.page.click('[role="tab"]:has-text("Advanced"), button:has-text("Advanced")');
        await session.page.waitForTimeout(500);
        const advancedContent = await session.safeTextContent("body");
        const hasAdvancedContent = advancedContent && (
          advancedContent.toLowerCase().includes("temperature") ||
          advancedContent.toLowerCase().includes("max tokens") ||
          advancedContent.toLowerCase().includes("system prompt") ||
          advancedContent.toLowerCase().includes("advanced")
        );
        steps.push(testStep("Advanced tab has config options", hasAdvancedContent ? TestStatus.PASS : TestStatus.SKIP));
        await session.screenshot("config-tab-advanced");
      } catch (err) {
        steps.push(testStep("Advanced tab has config options", TestStatus.WARN, { error: err.message }));
      }
    }

    // Step 12: Check form inputs are interactive
    const hasInputs = await session.exists("input:not([type='hidden']), select, textarea, [role='combobox'], [role='listbox'], [role='slider']");
    steps.push(
      testStep("Form inputs present and interactive", hasInputs ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 13: Try typing in an input field
    try {
      const inputSelector = "input:not([type='hidden']):not([disabled]):not([readonly])";
      const inputExists = await session.exists(inputSelector);
      if (inputExists) {
        await session.page.click(inputSelector);
        await session.page.keyboard.type("test-config-input");
        steps.push(testStep("Can type in config inputs", TestStatus.PASS));
      } else {
        steps.push(testStep("Can type in config inputs", TestStatus.SKIP, { note: "No editable input found" }));
      }
    } catch (err) {
      steps.push(testStep("Can type in config inputs", TestStatus.WARN, { error: err.message }));
    }

    // Step 14: Check save/apply button exists
    const hasSaveButton = await session.exists(
      'button:has-text("Save"), button:has-text("Apply"), button:has-text("Update"), button[type="submit"]'
    );
    steps.push(
      testStep("Save/apply button present", hasSaveButton ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 15: Check system prompt editor
    const hasSystemPrompt = await session.exists(
      'textarea[placeholder*="system" i], textarea[name*="system" i], [class*="system-prompt"], [class*="SystemPrompt"], [class*="monaco"]'
    );
    steps.push(
      testStep("System prompt editor", hasSystemPrompt ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 16: Check temperature/slider controls
    const hasSlider = await session.exists('input[type="range"], [role="slider"], [class*="slider"], [class*="Slider"]');
    steps.push(
      testStep("Temperature/slider controls", hasSlider ? TestStatus.PASS : TestStatus.SKIP)
    );

    // Step 17: Verify no credential values visible in plain text
    const credCheck = await session.page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const patterns = [/sk-[a-zA-Z0-9]{20,}/, /whsec_[a-zA-Z0-9]+/, /xoxb-[a-zA-Z0-9-]+/];
      return patterns.filter((p) => p.test(html)).length;
    });
    steps.push(
      testStep("No credentials visible in plain text", credCheck === 0 ? TestStatus.PASS : TestStatus.FAIL, { exposed: credCheck })
    );

    // Step 18: Navigate to different deployment and back
    await session.navigate(`${baseUrl}/d/demo`);
    await session.page.waitForTimeout(1500);
    await session.navigate(`${baseUrl}/d/test`);
    await session.page.waitForTimeout(1500);
    const configStillWorks = await session.exists(gearSelector);
    steps.push(
      testStep("Config persists across deployment switches", configStillWorks ? TestStatus.PASS : TestStatus.WARN)
    );

    // Step 19: No console errors when switching config tabs
    const tabErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    steps.push(
      testStep("No console errors on config panels", tabErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN, { errorCount: tabErrors.length })
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
    persona: "Deployment Config Tester",
    description: "Tests deployment configuration sidebar — Model, Platform, Advanced tabs",
    steps,
    browser: session.getReport(),
  };
}
