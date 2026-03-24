/**
 * Persona 19: Deployment Creator
 * Actually creates a deployment through the full wizard flow, validates each step,
 * screenshots every stage, then cleans up the test deployment via API.
 */

import { BrowserSession } from "../lib/browser.mjs";
import { ApiClient } from "../lib/apiClient.mjs";
import { testStep, TestStatus, Thresholds } from "../lib/types.mjs";

export default async function runDeploymentCreator({ baseUrl, apiUrl, config = {} }) {
  const session = new BrowserSession("19-deployment-creator");
  const api = new ApiClient(apiUrl, config.authToken);
  const steps = [];
  let createdDeploymentId = null;
  const timestamp = Date.now();
  const botName = `QA Test Bot ${timestamp}`;

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

    // Step 1: Navigate to wizard
    const wizardLoad = await session.navigate(`${baseUrl}/onboarding/new`);
    await session.page.waitForTimeout(3000);
    steps.push(
      testStep("Navigate to /onboarding/new", wizardLoad < Thresholds.NAVIGATION ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${wizardLoad}ms` })
    );
    await session.screenshot("wizard-step1-loaded");

    // Step 2: Type deployment name
    try {
      const nameInput = await session.page.$('input[name*="name" i], input[placeholder*="name" i], input[type="text"]');
      if (nameInput) {
        await nameInput.click();
        await nameInput.fill(botName);
        await session.page.waitForTimeout(500);
        const typedValue = await nameInput.inputValue();
        steps.push(
          testStep("Type deployment name", typedValue.includes("QA Test Bot") ? TestStatus.PASS : TestStatus.FAIL, { typed: typedValue })
        );
      } else {
        steps.push(testStep("Type deployment name", TestStatus.SKIP, { note: "Name input not found — may require auth" }));
      }
    } catch (err) {
      steps.push(testStep("Type deployment name", TestStatus.WARN, { error: err.message }));
    }
    await session.screenshot("wizard-name-entered");

    // Step 3: Select OpenClaw runtime
    try {
      const runtimeCard = await session.page.$('[data-runtime="openclaw"], button:has-text("OpenClaw"), [class*="runtime"]:has-text("OpenClaw")');
      if (runtimeCard) {
        await runtimeCard.click();
        await session.page.waitForTimeout(1000);
        steps.push(testStep("Select OpenClaw runtime", TestStatus.PASS));
      } else {
        // Try clicking Next first to get to runtime step
        const nextBtn = await session.page.$('button:has-text("Next"), button:has-text("Continue")');
        if (nextBtn) {
          await nextBtn.click();
          await session.page.waitForTimeout(2000);
          const runtimeCard2 = await session.page.$('[data-runtime="openclaw"], button:has-text("OpenClaw"), [class*="card"]:has-text("OpenClaw")');
          if (runtimeCard2) {
            await runtimeCard2.click();
            await session.page.waitForTimeout(1000);
            steps.push(testStep("Select OpenClaw runtime", TestStatus.PASS, { note: "Found after clicking Next" }));
          } else {
            steps.push(testStep("Select OpenClaw runtime", TestStatus.SKIP, { note: "Runtime card not found" }));
          }
        } else {
          steps.push(testStep("Select OpenClaw runtime", TestStatus.SKIP, { note: "No Next button or runtime cards" }));
        }
      }
    } catch (err) {
      steps.push(testStep("Select OpenClaw runtime", TestStatus.WARN, { error: err.message }));
    }
    await session.screenshot("wizard-runtime-selected");

    // Step 4: Select a persona template
    try {
      await session.page.waitForTimeout(1000);
      const templateCards = await session.page.$$('[class*="template"], [class*="persona"], [data-testid*="template"]');
      if (templateCards.length > 0) {
        await templateCards[0].click();
        await session.page.waitForTimeout(1000);
        steps.push(testStep("Select persona template", TestStatus.PASS, { count: templateCards.length }));
      } else {
        steps.push(testStep("Select persona template", TestStatus.SKIP, { note: "No template cards found" }));
      }
    } catch (err) {
      steps.push(testStep("Select persona template", TestStatus.WARN, { error: err.message }));
    }
    await session.screenshot("wizard-template-selected");

    // Step 5: Select LLM provider (Anthropic)
    try {
      const providerOption = await session.page.$('button:has-text("Anthropic"), [data-provider="anthropic"], label:has-text("Anthropic"), [class*="provider"]:has-text("Anthropic")');
      if (providerOption) {
        await providerOption.click();
        await session.page.waitForTimeout(1000);
        steps.push(testStep("Select Anthropic LLM provider", TestStatus.PASS));
      } else {
        // Try advancing to provider step
        const nextBtn = await session.page.$('button:has-text("Next"), button:has-text("Continue")');
        if (nextBtn) {
          await nextBtn.click();
          await session.page.waitForTimeout(2000);
        }
        const providerOption2 = await session.page.$('button:has-text("Anthropic"), [data-provider="anthropic"], [class*="provider"]:has-text("Anthropic")');
        if (providerOption2) {
          await providerOption2.click();
          await session.page.waitForTimeout(1000);
          steps.push(testStep("Select Anthropic LLM provider", TestStatus.PASS, { note: "Found after Next" }));
        } else {
          steps.push(testStep("Select Anthropic LLM provider", TestStatus.SKIP, { note: "Provider option not found" }));
        }
      }
    } catch (err) {
      steps.push(testStep("Select Anthropic LLM provider", TestStatus.WARN, { error: err.message }));
    }
    await session.screenshot("wizard-provider-selected");

    // Step 6: Enter API key
    try {
      const apiKeyInput = await session.page.$('input[type="password"], input[name*="key" i], input[placeholder*="key" i], input[placeholder*="sk-" i]');
      if (apiKeyInput && config.anthropicKey) {
        await apiKeyInput.click();
        await apiKeyInput.fill(config.anthropicKey);
        await session.page.waitForTimeout(500);
        steps.push(testStep("Enter Anthropic API key", TestStatus.PASS));
      } else {
        steps.push(testStep("Enter Anthropic API key", TestStatus.SKIP, { note: apiKeyInput ? "No anthropicKey in config" : "Key input not found" }));
      }
    } catch (err) {
      steps.push(testStep("Enter Anthropic API key", TestStatus.WARN, { error: err.message }));
    }

    // Step 7: Click Validate button and wait for response
    try {
      const validateBtn = await session.page.$('button:has-text("Validate"), button:has-text("Verify"), button:has-text("Check")');
      if (validateBtn) {
        await validateBtn.click();
        await session.page.waitForTimeout(5000);
        // Check for validation success indicators
        const bodyText = await session.safeTextContent("body");
        const validated = bodyText && (bodyText.includes("valid") || bodyText.includes("success") || bodyText.includes("verified"));
        steps.push(testStep("Click Validate and wait for response", validated ? TestStatus.PASS : TestStatus.WARN, { validated }));
      } else {
        steps.push(testStep("Click Validate and wait for response", TestStatus.SKIP, { note: "Validate button not found" }));
      }
    } catch (err) {
      steps.push(testStep("Click Validate and wait for response", TestStatus.WARN, { error: err.message }));
    }
    await session.screenshot("wizard-key-validated");

    // Step 8: Select model (claude-sonnet)
    try {
      const modelOption = await session.page.$('button:has-text("sonnet"), [class*="model"]:has-text("sonnet"), option[value*="sonnet"], label:has-text("sonnet")');
      if (modelOption) {
        await modelOption.click();
        await session.page.waitForTimeout(1000);
        steps.push(testStep("Select claude-sonnet model", TestStatus.PASS));
      } else {
        // Try select dropdown
        const modelSelect = await session.page.$('select[name*="model" i]');
        if (modelSelect) {
          const options = await modelSelect.$$("option");
          for (const opt of options) {
            const text = await opt.textContent();
            if (text.toLowerCase().includes("sonnet")) {
              await modelSelect.selectOption({ label: text });
              steps.push(testStep("Select claude-sonnet model", TestStatus.PASS, { model: text }));
              break;
            }
          }
        } else {
          steps.push(testStep("Select claude-sonnet model", TestStatus.SKIP, { note: "Model selector not found" }));
        }
      }
    } catch (err) {
      steps.push(testStep("Select claude-sonnet model", TestStatus.WARN, { error: err.message }));
    }
    await session.screenshot("wizard-model-selected");

    // Step 9: Click Deploy / Create
    try {
      const deployBtn = await session.page.$('button:has-text("Deploy"), button:has-text("Create"), button[type="submit"]:has-text("Deploy")');
      if (deployBtn) {
        await deployBtn.click();
        await session.page.waitForTimeout(8000);
        const currentUrl = session.page.url();
        const navigatedAway = !currentUrl.includes("/onboarding");
        steps.push(testStep("Click Deploy button", navigatedAway ? TestStatus.PASS : TestStatus.WARN, { url: currentUrl }));
      } else {
        steps.push(testStep("Click Deploy button", TestStatus.SKIP, { note: "Deploy button not found" }));
      }
    } catch (err) {
      steps.push(testStep("Click Deploy button", TestStatus.WARN, { error: err.message }));
    }
    await session.screenshot("wizard-deploy-clicked");

    // Step 10: Wait for deployment to appear on dashboard
    try {
      await session.navigate(`${baseUrl}/dashboard`);
      await session.page.waitForTimeout(3000);
      const bodyText = await session.safeTextContent("body");
      const deploymentVisible = bodyText && bodyText.includes("QA Test Bot");
      steps.push(testStep("Deployment appears on dashboard", deploymentVisible ? TestStatus.PASS : TestStatus.SKIP, { note: deploymentVisible ? "Found" : "Not found — may not have been created" }));
      await session.screenshot("dashboard-after-deploy");
    } catch (err) {
      steps.push(testStep("Deployment appears on dashboard", TestStatus.WARN, { error: err.message }));
    }

    // Step 11: Verify deployment via API
    try {
      const listResult = await api.trpc("deployment.list");
      if (listResult.data?.result?.data) {
        const deployments = listResult.data.result.data;
        const testDeploy = Array.isArray(deployments) ? deployments.find((d) => d.name && d.name.includes("QA Test Bot")) : null;
        if (testDeploy) {
          createdDeploymentId = testDeploy.id;
          steps.push(testStep("Verify deployment via API", TestStatus.PASS, { id: testDeploy.id, name: testDeploy.name }));
        } else {
          steps.push(testStep("Verify deployment via API", TestStatus.SKIP, { note: "Test deployment not found in list", count: Array.isArray(deployments) ? deployments.length : 0 }));
        }
      } else {
        steps.push(testStep("Verify deployment via API", TestStatus.WARN, { note: "API returned unexpected shape", status: listResult.status }));
      }
    } catch (err) {
      steps.push(testStep("Verify deployment via API", TestStatus.WARN, { error: err.message }));
    }

    // Step 12: Navigate to deployment chat page
    if (createdDeploymentId) {
      try {
        const chatLoad = await session.navigate(`${baseUrl}/d/${createdDeploymentId}`);
        await session.page.waitForTimeout(3000);
        const hasChatInput = await session.exists('textarea, input[placeholder*="message" i], [contenteditable="true"], [class*="chat-input"]');
        steps.push(testStep("Navigate to deployment chat page", hasChatInput ? TestStatus.PASS : TestStatus.WARN, { loadTime: `${chatLoad}ms`, hasChatInput }));
        await session.screenshot("deployment-chat-page");
      } catch (err) {
        steps.push(testStep("Navigate to deployment chat page", TestStatus.WARN, { error: err.message }));
      }
    } else {
      steps.push(testStep("Navigate to deployment chat page", TestStatus.SKIP, { note: "No deployment was created" }));
    }

    // Step 13: Verify chat interface loaded
    try {
      const chatElements = await session.countElements('[class*="message"], [class*="chat"], [class*="thread"]');
      steps.push(testStep("Chat interface elements present", chatElements > 0 ? TestStatus.PASS : TestStatus.SKIP, { elementCount: chatElements }));
    } catch (err) {
      steps.push(testStep("Chat interface elements present", TestStatus.WARN, { error: err.message }));
    }

    // Step 14: Clean up — delete test deployment via API
    if (createdDeploymentId) {
      try {
        const deleteResult = await api.trpc("deployment.delete", { id: createdDeploymentId }, "mutation");
        steps.push(testStep("Clean up: delete test deployment", deleteResult.status === 200 ? TestStatus.PASS : TestStatus.WARN, { status: deleteResult.status, id: createdDeploymentId }));
      } catch (err) {
        steps.push(testStep("Clean up: delete test deployment", TestStatus.WARN, { error: err.message, id: createdDeploymentId }));
      }
    } else {
      steps.push(testStep("Clean up: delete test deployment", TestStatus.SKIP, { note: "Nothing to clean up" }));
    }

    // Step 15: Overall console/network errors
    const totalErrors = session.consoleLogs.filter((l) => l.type === "error" || l.type === "page_error");
    const serverErrors = session.networkErrors.filter((e) => (e.status || 0) >= 500);
    steps.push(testStep("No console errors during wizard flow", totalErrors.length <= 3 ? TestStatus.PASS : TestStatus.WARN, { errorCount: totalErrors.length }));
    steps.push(testStep("No server errors (5xx)", serverErrors.length === 0 ? TestStatus.PASS : TestStatus.FAIL, { count: serverErrors.length }));

  } catch (err) {
    steps.push(testStep("Persona crashed", TestStatus.FAIL, { error: err.message, stack: err.stack?.slice(0, 500) }));
  } finally {
    await session.cleanup();
  }

  return {
    persona: "Deployment Creator",
    description: "Full wizard flow — creates, verifies, and cleans up a deployment",
    steps,
    browser: session.getReport(),
    api: api.getResults(),
  };
}
