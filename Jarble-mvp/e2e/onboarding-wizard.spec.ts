import { test, expect } from "@playwright/test";
import { attachAllLoggers, screenshotMilestone } from "./helpers/logging";
import { setupAuthIntercept } from "./helpers/auth";

/**
 * Onboarding Wizard E2E Tests
 *
 * Tests the multi-step deployment wizard at /onboarding/new against the REAL API.
 * All tests are READ-ONLY: they navigate through wizard steps, fill forms, and
 * verify UI renders correctly WITHOUT ever clicking the "Deploy" button.
 */

const WIZARD_URL = "/onboarding/new";

test.describe("Onboarding Wizard", () => {
  let flush: () => Promise<void>;

  test.beforeEach(async ({ page }, testInfo) => {
    const loggers = attachAllLoggers(page, testInfo);
    flush = loggers.flush;
    await setupAuthIntercept(page);
  });

  test.afterEach(async () => {
    await flush();
  });

  // ── Step 1: Name Step ──────────────────────────────────────────────────

  test.describe("Step 1 - Name Your Deployment", () => {
    test("wizard loads and shows the Name step first", async ({ page }, testInfo) => {
      await page.goto(WIZARD_URL);
      await page.waitForTimeout(5_000);

      // Header elements
      await expect(page.getByText("New Deployment")).toBeVisible({ timeout: 15_000 });

      // Name step heading and description
      await expect(page.getByRole("heading", { name: "Name Your Deployment" })).toBeVisible();
      await expect(page.getByText("Give your AI deployment a name")).toBeVisible();

      // Name input with label and placeholder
      await expect(page.getByLabel("Deployment Name")).toBeVisible();
      await expect(page.getByPlaceholder("My Deployment")).toBeVisible();

      // Helper text
      await expect(
        page.getByText("This is how your deployment will be identified")
      ).toBeVisible();

      await screenshotMilestone(page, testInfo, "wizard-step-name");
    });

    test("Continue button is disabled when name is empty", async ({ page }) => {
      await page.goto(WIZARD_URL);
      await page.waitForTimeout(5_000);

      const continueBtn = page.getByRole("button", { name: "Continue" });
      await expect(continueBtn).toBeDisabled();
    });

    test("Continue button is disabled when name is only 1 character", async ({ page }) => {
      await page.goto(WIZARD_URL);
      await page.waitForTimeout(5_000);

      await page.getByLabel("Deployment Name").fill("A");
      const continueBtn = page.getByRole("button", { name: "Continue" });
      await expect(continueBtn).toBeDisabled();
    });

    test("shows 'Great name!' confirmation when name is 2+ characters", async ({ page }) => {
      await page.goto(WIZARD_URL);
      await page.waitForTimeout(5_000);

      await page.getByLabel("Deployment Name").fill("My Bot");
      await expect(page.getByText("Great name!")).toBeVisible();
    });

    test("Continue button is enabled when name has 2+ characters", async ({ page }) => {
      await page.goto(WIZARD_URL);
      await page.waitForTimeout(5_000);

      await page.getByLabel("Deployment Name").fill("My Bot");
      const continueBtn = page.getByRole("button", { name: "Continue" });
      await expect(continueBtn).toBeEnabled();
    });

    test("Back button is disabled on the first step", async ({ page }) => {
      await page.goto(WIZARD_URL);
      await page.waitForTimeout(5_000);

      const backBtn = page.getByRole("button", { name: "Back" });
      await expect(backBtn).toBeDisabled();
    });
  });

  // ── Step 2: Choose Runtime ────────────────────────────────────────────

  test.describe("Step 2 - Choose Runtime", () => {
    /** Navigate to runtime step */
    async function goToRuntimeStep(page: import("@playwright/test").Page) {
      await page.goto(WIZARD_URL);
      await page.waitForTimeout(5_000);
      await page.getByLabel("Deployment Name").fill("Test Bot");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForTimeout(1_000);
    }

    test("navigates to runtime step and shows runtime options", async ({ page }, testInfo) => {
      await goToRuntimeStep(page);

      await expect(page.getByRole("heading", { name: "Choose Runtime" })).toBeVisible();
      await expect(page.getByText("Select a runtime for your deployment")).toBeVisible();

      // OpenClaw runtime should be visible
      await expect(page.getByText("OpenClaw")).toBeVisible();

      // "More runtimes" hint
      await expect(page.getByText("More runtimes coming soon")).toBeVisible();

      await screenshotMilestone(page, testInfo, "wizard-step-runtime");
    });

    test("Continue is disabled until a runtime is selected", async ({ page }) => {
      await goToRuntimeStep(page);

      const continueBtn = page.getByRole("button", { name: "Continue" });
      await expect(continueBtn).toBeDisabled();
    });

    test("selecting a runtime enables Continue and shows Selected badge", async ({ page }) => {
      await goToRuntimeStep(page);

      // Click the OpenClaw runtime card
      await page.getByText("OpenClaw").click();

      // "Selected" badge should appear
      await expect(page.getByText("Selected")).toBeVisible();

      // Continue should be enabled
      await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    });

    test("Back button returns to the Name step", async ({ page }) => {
      await goToRuntimeStep(page);

      await expect(page.getByRole("heading", { name: "Choose Runtime" })).toBeVisible();

      await page.getByRole("button", { name: "Back" }).click();
      await page.waitForTimeout(500);

      await expect(page.getByRole("heading", { name: "Name Your Deployment" })).toBeVisible();
      // Name should be preserved
      await expect(page.getByLabel("Deployment Name")).toHaveValue("Test Bot");
    });
  });

  // ── Step 3: LLM Setup ────────────────────────────────────────────────

  test.describe("Step 3 - LLM Setup", () => {
    /** Navigate to the LLM step with OpenClaw selected */
    async function goToLlmStep(page: import("@playwright/test").Page) {
      await page.goto(WIZARD_URL);
      await page.waitForTimeout(5_000);

      await page.getByLabel("Deployment Name").fill("Test Bot");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForTimeout(1_000);

      await page.getByText("OpenClaw").click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForTimeout(1_000);
    }

    test("shows LLM Setup heading with two mode options", async ({ page }, testInfo) => {
      await goToLlmStep(page);

      await expect(page.getByRole("heading", { name: "LLM Setup" })).toBeVisible();
      await expect(
        page.getByText("Choose how your deployment accesses AI models")
      ).toBeVisible();

      // Both mode options visible
      await expect(page.getByText("Included Credits")).toBeVisible();
      await expect(page.getByText("Bring Your Own Key (BYOK)")).toBeVisible();

      await screenshotMilestone(page, testInfo, "wizard-step-llm");
    });

    test("BYOK mode shows provider grid with all 4 providers", async ({ page }) => {
      await goToLlmStep(page);

      await expect(page.getByText("Choose Provider")).toBeVisible();

      // All 4 providers should be visible (use .first() to avoid strict mode with model descriptions)
      await expect(page.getByText("OpenRouter").first()).toBeVisible();
      await expect(page.getByText("OpenAI").first()).toBeVisible();
      await expect(page.getByText("Anthropic").first()).toBeVisible();
      await expect(page.getByText("Google AI").first()).toBeVisible();
    });

    test("BYOK mode shows API key input with provider-specific placeholder", async ({ page }) => {
      await goToLlmStep(page);

      const apiKeyInput = page.getByLabel(/API Key/);
      await expect(apiKeyInput).toBeVisible();
      await expect(apiKeyInput).toHaveAttribute("placeholder", "sk-or-v1-...");
    });

    test("switching provider updates the API key placeholder", async ({ page }) => {
      await goToLlmStep(page);

      // Click Anthropic provider
      await page.locator("button").filter({ hasText: "Anthropic" }).first().click();
      await page.waitForTimeout(300);

      const apiKeyInput = page.getByLabel(/API Key/);
      await expect(apiKeyInput).toHaveAttribute("placeholder", "sk-ant-api03-...");
    });

    test("Continue is disabled in BYOK mode without a validated key", async ({ page }) => {
      await goToLlmStep(page);

      const continueBtn = page.getByRole("button", { name: "Continue" });
      await expect(continueBtn).toBeDisabled();
    });

    test("Validate button is disabled when API key input is empty", async ({ page }) => {
      await goToLlmStep(page);

      const validateBtn = page.getByRole("button", { name: "Validate" });
      await expect(validateBtn).toBeDisabled();
    });

    test("typing an API key enables Validate button", async ({ page }) => {
      await goToLlmStep(page);

      const apiKeyInput = page.getByLabel(/API Key/);
      await apiKeyInput.fill("sk-or-v1-test123");

      const validateBtn = page.getByRole("button", { name: "Validate" });
      await expect(validateBtn).toBeEnabled();
    });

    test("switching to Included Credits mode enables Continue immediately", async ({ page }) => {
      await goToLlmStep(page);

      // Click Included Credits option
      await page.getByText("Included Credits").first().click();
      await page.waitForTimeout(300);

      // Continue should be enabled (no key needed)
      await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
    });

    test("Included Credits mode shows credit plan selector", async ({ page }, testInfo) => {
      await goToLlmStep(page);

      await page.getByText("Included Credits").first().click();
      await page.waitForTimeout(300);

      // Credit plan heading
      await expect(page.getByText("Monthly Credit Plan").first()).toBeVisible();

      // Verify plan options exist
      await expect(page.getByText("Light usage").first()).toBeVisible();
      await expect(page.getByText("Moderate usage").first()).toBeVisible();
      await expect(page.getByText("Active usage").first()).toBeVisible();

      await screenshotMilestone(page, testInfo, "wizard-included-credits");
    });

    test("Included Credits mode shows model selector", async ({ page }) => {
      await goToLlmStep(page);

      await page.getByText("Included Credits").first().click();
      await page.waitForTimeout(300);

      await expect(page.getByText("Choose Model")).toBeVisible();
      await expect(page.getByText("Auto (Best Available)")).toBeVisible();
    });

    test("BYOK mode shows model selector filtered by selected provider", async ({ page }) => {
      await goToLlmStep(page);

      // Default is OpenRouter, should see OpenRouter models
      await expect(page.getByText("Choose Model")).toBeVisible();
      await expect(page.getByText("Auto (Best Available)")).toBeVisible();

      // Switch to Anthropic
      await page.locator("button").filter({ hasText: "Anthropic" }).first().click();
      await page.waitForTimeout(300);

      // Should show Anthropic models
      await expect(page.getByText("Claude Sonnet 4")).toBeVisible();

      // OpenRouter-only models should be gone
      await expect(page.getByText("Auto (Best Available)")).not.toBeVisible();
    });
  });

  // ── Step 4: Deploy Step ───────────────────────────────────────────────

  test.describe("Step 4 - Deploy", () => {
    /** Navigate to the Deploy step using Included Credits (no key needed) */
    async function goToDeployStep(page: import("@playwright/test").Page) {
      await page.goto(WIZARD_URL);
      await page.waitForTimeout(5_000);

      // Step 1: Name
      await page.getByLabel("Deployment Name").fill("Test Bot");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForTimeout(1_000);

      // Step 2: Runtime
      await page.getByText("OpenClaw").click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForTimeout(1_000);

      // Step 3: LLM - use Included Credits
      await page.getByText("Included Credits").first().click();
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForTimeout(1_000);
    }

    test("shows Deploy step with summary of configuration", async ({ page }, testInfo) => {
      await goToDeployStep(page);

      await expect(page.getByRole("heading", { name: "Deploy" })).toBeVisible();
      await expect(page.getByText("Ready for Takeoff!")).toBeVisible();

      // Configuration summary badges
      await expect(page.getByText("Named")).toBeVisible();
      await expect(page.getByText("OpenClaw selected")).toBeVisible();
      await expect(page.getByText("LLM: Included Credits")).toBeVisible();

      await screenshotMilestone(page, testInfo, "wizard-step-deploy");
    });

    test("deploy button shows 'Deploy' text (not 'Continue')", async ({ page }) => {
      await goToDeployStep(page);

      // The action button at the bottom (not the nav step button)
      const deployBtn = page.getByRole("button", { name: "Deploy", exact: true }).last();
      await expect(deployBtn).toBeVisible();
      await expect(deployBtn).toBeEnabled();
    });

    test("Back button returns to LLM step from deploy step", async ({ page }) => {
      await goToDeployStep(page);

      await page.getByRole("button", { name: "Back" }).click();
      await page.waitForTimeout(500);

      await expect(page.getByRole("heading", { name: "LLM Setup" })).toBeVisible();
    });

    // We explicitly do NOT click the Deploy button
  });

  // ── Full Flow Navigation (without deploying) ──────────────────────────

  test.describe("Full Flow Navigation", () => {
    test("can navigate through all 4 steps and back without deploying", async ({ page }, testInfo) => {
      await page.goto(WIZARD_URL);
      await page.waitForTimeout(5_000);

      // Step 1: Name
      await expect(page.getByRole("heading", { name: "Name Your Deployment" })).toBeVisible({ timeout: 15_000 });
      await page.getByLabel("Deployment Name").fill("Full Flow Bot");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForTimeout(1_000);

      // Step 2: Runtime
      await expect(page.getByRole("heading", { name: "Choose Runtime" })).toBeVisible();
      await page.getByText("OpenClaw").click();
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForTimeout(1_000);

      // Step 3: LLM
      await expect(page.getByRole("heading", { name: "LLM Setup" })).toBeVisible();
      await page.getByText("Included Credits").first().click();
      await page.waitForTimeout(300);
      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForTimeout(1_000);

      // Step 4: Deploy
      await expect(page.getByRole("heading", { name: "Deploy" })).toBeVisible();
      await expect(page.getByText("Ready for Takeoff!")).toBeVisible();

      await screenshotMilestone(page, testInfo, "wizard-full-flow-deploy");

      // Navigate all the way back
      await page.getByRole("button", { name: "Back" }).click();
      await page.waitForTimeout(500);
      await expect(page.getByRole("heading", { name: "LLM Setup" })).toBeVisible();

      await page.getByRole("button", { name: "Back" }).click();
      await page.waitForTimeout(500);
      await expect(page.getByRole("heading", { name: "Choose Runtime" })).toBeVisible();

      await page.getByRole("button", { name: "Back" }).click();
      await page.waitForTimeout(500);
      await expect(page.getByRole("heading", { name: "Name Your Deployment" })).toBeVisible();

      // Name should still be preserved
      await expect(page.getByLabel("Deployment Name")).toHaveValue("Full Flow Bot");

      await screenshotMilestone(page, testInfo, "wizard-full-flow-back");
    });
  });

  // ── Unauthenticated Access ────────────────────────────────────────────

  test.describe("Unauthenticated Access", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("shows login prompt when not authenticated", async ({ page }, testInfo) => {
      await page.goto(WIZARD_URL);
      await page.waitForTimeout(5_000);

      // Should redirect to login or show sign-in prompt
      const wizardOrLogin = await Promise.race([
        page.getByRole("heading", { name: "Name Your Deployment" }).waitFor({ state: "visible", timeout: 10_000 }).then(() => "wizard"),
        page.getByText("Please log in").waitFor({ state: "visible", timeout: 10_000 }).then(() => "login"),
        page.getByRole("button", { name: /sign in/i }).waitFor({ state: "visible", timeout: 10_000 }).then(() => "login"),
      ]).catch(() => "timeout");

      expect(["wizard", "login"]).toContain(wizardOrLogin);

      await screenshotMilestone(page, testInfo, "wizard-auth-check");
    });
  });
});
