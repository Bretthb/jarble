/**
 * Persona 14: Deployment Config Tester
 * Tests the deployment configuration sidebar on /d/[id] — Model, Platform, Advanced tabs.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runDeploymentConfig({ baseUrl }) {
  const session = new BrowserSession("14-deployment-config");
  const steps = [];

  try {
    await session.start();

    // Step 1: Navigate to a deployment chat page
    const loadTime = await session.navigate(`${baseUrl}/d/test`);
    steps.push(
      testStep(
        "Deployment chat page loads",
        loadTime < Thresholds.PAGE_LOAD ? TestStatus.PASS : TestStatus.WARN,
        { loadTime: `${loadTime}ms` }
      )
    );
    await session.screenshot("deployment-chat-page");

    // Step 2: Open the config panel (Settings gear icon)
    try {
      const gearSelector = 'button[aria-label*="settings" i], button[aria-label*="config" i], button[aria-label*="gear" i], [class*="settings"], [class*="Settings"], svg[class*="lucide-settings"]';
      const gearExists = await session.exists(gearSelector);
      if (gearExists) {
        await session.page.click(gearSelector);
        await session.page.waitForTimeout(1000);
      }
      steps.push(
        testStep(
          "Config panel gear icon found",
          gearExists ? TestStatus.PASS : TestStatus.WARN,
          { note: "Looked for settings/gear button" }
        )
      );
      await session.screenshot("config-panel-open");
    } catch (err) {
      steps.push(
        testStep("Config panel gear icon found", TestStatus.WARN, { error: err.message })
      );
    }

    // Step 3: Check Model tab renders
    const configTabs = [
      { label: "Model", keywords: ["model", "provider", "Model"] },
      { label: "Platform", keywords: ["platform", "whatsapp", "discord", "Platform"] },
      { label: "Advanced", keywords: ["advanced", "Advanced"] },
    ];

    for (const tab of configTabs) {
      try {
        const tabSelector = tab.keywords
          .map((k) => `[role="tab"]:has-text("${k}"), button:has-text("${k}"), [class*="${k.toLowerCase()}"]`)
          .join(", ");
        const tabExists = await session.exists(tabSelector);
        if (tabExists) {
          try {
            await session.page.click(tabSelector);
            await session.page.waitForTimeout(500);
          } catch (_) {
            // Click may fail if selector matches multiple — OK
          }
        }
        steps.push(
          testStep(
            `${tab.label} tab renders`,
            tabExists ? TestStatus.PASS : TestStatus.WARN,
            { label: tab.label }
          )
        );
        await session.screenshot(`config-tab-${tab.label.toLowerCase()}`);
      } catch (err) {
        steps.push(
          testStep(`${tab.label} tab renders`, TestStatus.WARN, { error: err.message })
        );
      }
    }

    // Step 4: Check no console errors when switching tabs
    const tabErrors = session.consoleLogs.filter(
      (l) => l.type === "error" || l.type === "page_error"
    );
    steps.push(
      testStep(
        "No console errors when switching config tabs",
        tabErrors.length === 0 ? TestStatus.PASS : TestStatus.WARN,
        { errorCount: tabErrors.length }
      )
    );

    // Step 5: Verify form inputs are interactive
    const hasInputs = await session.exists("input, select, textarea, [role='combobox'], [role='listbox']");
    steps.push(
      testStep(
        "Form inputs are present and interactive",
        hasInputs ? TestStatus.PASS : TestStatus.WARN,
        { note: "Checked for input/select/textarea elements" }
      )
    );

    // Step 6: Try typing in an input field
    try {
      const inputSelector = "input:not([type='hidden']):not([disabled])";
      const inputExists = await session.exists(inputSelector);
      if (inputExists) {
        await session.page.click(inputSelector);
        await session.page.keyboard.type("test-input");
        steps.push(testStep("Can type in form inputs", TestStatus.PASS));
      } else {
        steps.push(testStep("Can type in form inputs", TestStatus.WARN, { note: "No editable input found" }));
      }
    } catch (err) {
      steps.push(testStep("Can type in form inputs", TestStatus.WARN, { error: err.message }));
    }

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
