import type { Page } from "@playwright/test";

// ── Mock data fixtures ────────────────────────────────────────────────────

export const MOCK_DEPLOYMENT_RUNNING = {
  id: "3vt3ej3hj1oi",
  name: "test1",
  status: "running",
  runtime: "openclaw",
  description: "Test deployment 1",
  monthlyPriceCents: 500,
  llmMode: "included",
  llmApiKeyId: null,
  llmApiKeySourceDeploymentId: null,
  llmCreditLimitDollars: 10,
  cancelledAt: null,
  cancelAtPeriodEnd: null,
};

export const MOCK_DEPLOYMENT_RUNNING_2 = {
  id: "42puqb1asrdx",
  name: "test2",
  status: "running",
  runtime: "openclaw",
  description: "Test deployment 2",
  monthlyPriceCents: 500,
  llmMode: "byok",
  llmApiKeyId: null,
  llmApiKeySourceDeploymentId: null,
  llmCreditLimitDollars: null,
  cancelledAt: null,
  cancelAtPeriodEnd: null,
};

export const MOCK_DEPLOYMENT_STOPPED = {
  ...MOCK_DEPLOYMENT_RUNNING,
  id: "stopped-001",
  name: "stopped-bot",
  status: "stopped",
  description: "A stopped deployment",
};

export const MOCK_DEPLOYMENT_PENDING = {
  ...MOCK_DEPLOYMENT_RUNNING,
  id: "pending-001",
  name: "pending-bot",
  status: "pending",
  description: null,
};

export const MOCK_DEPLOYMENT_CREATING = {
  ...MOCK_DEPLOYMENT_RUNNING,
  id: "creating-001",
  name: "creating-bot",
  status: "creating",
};

export const MOCK_DEPLOYMENT_FAILED = {
  ...MOCK_DEPLOYMENT_RUNNING,
  id: "failed-001",
  name: "failed-bot",
  status: "failed",
  description: "A failed deployment",
};

export const MOCK_DEPLOYMENT_LINKED = {
  ...MOCK_DEPLOYMENT_RUNNING,
  id: "linked-001",
  name: "linked-bot",
  llmMode: "linked",
  llmApiKeySourceDeploymentId: MOCK_DEPLOYMENT_RUNNING.id,
};

export const MOCK_RUNTIME_CATALOG = [
  {
    id: "rt-001",
    slug: "openclaw",
    name: "OpenClaw",
    description: "OpenClaw runtime",
    hwTier: "standard",
    monthlyPriceCents: 500,
  },
];

export const ALL_STATUS_DEPLOYMENTS = [
  MOCK_DEPLOYMENT_RUNNING,
  MOCK_DEPLOYMENT_RUNNING_2,
  MOCK_DEPLOYMENT_STOPPED,
  MOCK_DEPLOYMENT_PENDING,
  MOCK_DEPLOYMENT_CREATING,
  MOCK_DEPLOYMENT_FAILED,
];

// ── tRPC route interception helpers ─────────────────────────────────────

/**
 * Intercept deployment.list tRPC query and return mock deployments.
 */
export async function mockDeploymentList(
  page: Page,
  deployments: Record<string, unknown>[] = [
    MOCK_DEPLOYMENT_RUNNING,
    MOCK_DEPLOYMENT_RUNNING_2,
  ],
) {
  await page.route("**/trpc/deployment.list*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: deployments },
      }),
    });
  });
}

/**
 * Intercept runtimeCatalog.list tRPC query and return mock runtimes.
 */
export async function mockRuntimeCatalog(
  page: Page,
  runtimes: Record<string, unknown>[] = MOCK_RUNTIME_CATALOG,
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
 * Intercept deployment.getStorageUsage tRPC query and return mock storage data.
 */
export async function mockStorageUsage(
  page: Page,
  usage: { usedGb: number; totalGb: number; percentUsed: number } = {
    usedGb: 2.5,
    totalGb: 20,
    percentUsed: 12.5,
  },
) {
  await page.route("**/trpc/deployment.getStorageUsage*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: usage },
      }),
    });
  });
}

/**
 * Intercept deployment.list to return an error response.
 */
export async function mockDeploymentListError(page: Page) {
  await page.route("**/trpc/deployment.list*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          message: "Failed to fetch deployments",
          code: "INTERNAL_SERVER_ERROR",
          data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
        },
      }),
    });
  });
}

/**
 * Intercept the SSE status stream endpoint.
 */
export async function mockStatusStream(
  page: Page,
  events: Array<{ deploymentId: string; status: string }> = [],
) {
  await page.route("**/trpc/deployment.statusStream*", async (route) => {
    const sseData = events
      .map((e) => `data: ${JSON.stringify(e)}\n\n`)
      .join("");
    await route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: sseData,
    });
  });
}
