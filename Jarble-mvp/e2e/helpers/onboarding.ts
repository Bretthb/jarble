import type { Page } from "@playwright/test";

// ── Mock data fixtures ────────────────────────────────────────────────────

export const MOCK_RUNTIMES = [
  {
    id: 1,
    slug: "openclaw",
    name: "OpenClaw",
    description: "AI multi-platform bot runtime with LLM support.",
    category: "ai",
    cpuLimit: "2.0",
    memoryMb: 2048,
    storageMb: 30,
    monthlyPriceCents: 1000,
  },
  {
    id: 2,
    slug: "zeroclaw",
    name: "ZeroClaw",
    description: "Lightweight chatbot runtime for simple use cases.",
    category: "chatbot",
    cpuLimit: "1",
    memoryMb: 512,
    storageMb: 20,
    monthlyPriceCents: 500,
  },
];

export const MOCK_CAN_DEPLOY = {
  freeUsed: false,
  canDeploy: true,
};

export const MOCK_CAN_DEPLOY_NO_FREE = {
  freeUsed: true,
  canDeploy: true,
};

export const MOCK_LINKABLE_DEPLOYMENTS: Array<{
  id: string;
  name: string;
  runtime: string;
  llmCreditLimitDollars: number | null;
}> = [];

// ── tRPC route interception helpers ──────────────────────────────────────

/**
 * Intercept runtimeCatalog.list tRPC query and return mock runtimes.
 */
export async function mockRuntimeList(
  page: Page,
  runtimes = MOCK_RUNTIMES,
) {
  await page.route("**/trpc/runtimeCatalog.list*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: runtimes },
      }),
    });
  });
}

/**
 * Intercept deployment.canDeploy tRPC query.
 */
export async function mockCanDeploy(
  page: Page,
  data = MOCK_CAN_DEPLOY,
) {
  await page.route("**/trpc/deployment.canDeploy*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data },
      }),
    });
  });
}

/**
 * Intercept deployment.listLinkableDeployments tRPC query.
 */
export async function mockLinkableDeployments(
  page: Page,
  data = MOCK_LINKABLE_DEPLOYMENTS,
) {
  await page.route("**/trpc/deployment.listLinkableDeployments*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data },
      }),
    });
  });
}

/**
 * Intercept openrouter.validateProviderKey mutation with a valid response.
 */
export async function mockKeyValidationSuccess(page: Page) {
  await page.route("**/trpc/openrouter.validateProviderKey*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: { valid: true } },
      }),
    });
  });
}

/**
 * Intercept openrouter.validateProviderKey mutation with an invalid response.
 */
export async function mockKeyValidationFailure(page: Page) {
  await page.route("**/trpc/openrouter.validateProviderKey*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: { valid: false } },
      }),
    });
  });
}

/**
 * Set up all mock routes needed for the wizard flow.
 * Call this before navigating to the onboarding page.
 */
export async function setupWizardMocks(page: Page) {
  await mockRuntimeList(page);
  await mockCanDeploy(page);
  await mockLinkableDeployments(page);
}
