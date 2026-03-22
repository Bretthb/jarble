import type { Page } from "@playwright/test";

// ── Mock data fixtures ────────────────────────────────────────────────────

export const MOCK_COMPONENT = {
  id: "comp-test-001",
  name: "test-chart",
  displayName: "Test Chart Component",
  description: "A test chart component for E2E testing purposes.",
  tier: "template" as const,
  category: "chart",
  tags: ["test", "chart"],
  totalInstalls: 142,
  averageRating: 420,
  ratingCount: 12,
  pricingModel: "free" as const,
  priceUsdCents: 0,
  creatorId: "creator-001",
  status: "approved",
  createdAt: "2025-12-01T00:00:00.000Z",
  updatedAt: "2026-01-15T00:00:00.000Z",
  creator: {
    id: "creator-001",
    displayName: "Test Creator",
    bio: "Test creator bio",
    websiteUrl: "https://example.com",
  },
  versions: [
    {
      id: "ver-001",
      version: "1.2.0",
      changelog: "Added new features",
      createdAt: "2026-01-15T00:00:00.000Z",
    },
  ],
  reviewSummary: {
    averageRating: 420,
    count: 12,
    distribution: { 1: 0, 2: 1, 3: 2, 4: 4, 5: 5 },
  },
  propsSchema: '{"type":"object","properties":{"title":{"type":"string"}}}',
  examplePrompts: ["Show me a chart of sales data"],
};

export const MOCK_COMPONENT_BROWSE_ITEM = {
  id: MOCK_COMPONENT.id,
  name: MOCK_COMPONENT.name,
  displayName: MOCK_COMPONENT.displayName,
  description: MOCK_COMPONENT.description,
  tier: MOCK_COMPONENT.tier,
  category: MOCK_COMPONENT.category,
  totalInstalls: MOCK_COMPONENT.totalInstalls,
  averageRating: MOCK_COMPONENT.averageRating,
  ratingCount: MOCK_COMPONENT.ratingCount,
  pricingModel: MOCK_COMPONENT.pricingModel,
  priceUsdCents: MOCK_COMPONENT.priceUsdCents,
  creator: {
    id: MOCK_COMPONENT.creator.id,
    displayName: MOCK_COMPONENT.creator.displayName,
  },
};

export const MOCK_SERVICE = {
  id: "pkg-test-001",
  name: "test-analytics-service",
  displayName: "Test Analytics Service",
  description: "A test analytics service for E2E testing.",
  hostingModel: "self_hosted",
  status: "approved",
  pricingModel: "free",
  priceUsdCents: 0,
  totalInstalls: 87,
  avgRating: 380,
  remoteHealth: null,
  remoteApiEndpoint: null,
  instructionSnippet: "When asked about analytics, use the test chart component.",
  componentCount: 2,
  skillCount: 1,
  creator: {
    id: "creator-001",
    displayName: "Test Creator",
    bio: "Test creator bio",
  },
  createdAt: "2026-01-10T00:00:00.000Z",
  components: [
    {
      id: "comp-test-001",
      name: "test-chart",
      displayName: "Test Chart",
      description: "A test chart component",
      tier: "template",
      category: "chart",
    },
    {
      id: "comp-test-002",
      name: "test-table",
      displayName: "Test Table",
      description: "A test table component",
      tier: "template",
      category: "dashboard",
    },
  ],
  skills: [
    {
      id: "skill-test-001",
      name: "Web Search",
      description: "Search the web for information",
    },
  ],
};

export const MOCK_SERVICE_LIST_ITEM = {
  id: MOCK_SERVICE.id,
  name: MOCK_SERVICE.name,
  displayName: MOCK_SERVICE.displayName,
  description: MOCK_SERVICE.description,
  hostingModel: MOCK_SERVICE.hostingModel,
  status: MOCK_SERVICE.status,
  pricingModel: MOCK_SERVICE.pricingModel,
  priceUsdCents: MOCK_SERVICE.priceUsdCents,
  totalInstalls: MOCK_SERVICE.totalInstalls,
  avgRating: MOCK_SERVICE.avgRating,
  remoteHealth: MOCK_SERVICE.remoteHealth,
  componentCount: MOCK_SERVICE.componentCount,
  skillCount: MOCK_SERVICE.skillCount,
  creator: MOCK_SERVICE.creator,
  createdAt: MOCK_SERVICE.createdAt,
};

export const MOCK_REMOTE_SERVICE = {
  ...MOCK_SERVICE,
  id: "pkg-test-002",
  name: "test-remote-service",
  displayName: "Test Remote Service",
  hostingModel: "remote",
  remoteHealth: "healthy",
  remoteApiEndpoint: "https://api.example.com/v1",
};

// ── tRPC route interception helpers ────────────────────────────────────────

/**
 * Intercept marketplace.browse tRPC query and return mock component items.
 */
export async function mockComponentBrowse(
  page: Page,
  items: typeof MOCK_COMPONENT_BROWSE_ITEM[] = [MOCK_COMPONENT_BROWSE_ITEM],
  nextCursor: string | null = null,
) {
  await page.route("**/trpc/marketplace.browse*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: { items, nextCursor } },
      }),
    });
  });
}

/**
 * Intercept services.list tRPC query and return mock service items.
 */
export async function mockServicesList(
  page: Page,
  items: typeof MOCK_SERVICE_LIST_ITEM[] = [MOCK_SERVICE_LIST_ITEM],
  nextCursor: string | null = null,
) {
  await page.route("**/trpc/services.list*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: { items, nextCursor } },
      }),
    });
  });
}

/**
 * Intercept marketplace.getById tRPC query and return a mock component.
 */
export async function mockComponentDetail(
  page: Page,
  component: typeof MOCK_COMPONENT = MOCK_COMPONENT,
) {
  await page.route("**/trpc/marketplace.getById*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: component },
      }),
    });
  });
}

/**
 * Intercept marketplace.getReviews tRPC query and return mock reviews.
 */
export async function mockComponentReviews(
  page: Page,
  items: Array<{
    id: string;
    rating: number;
    title: string | null;
    body: string | null;
    createdAt: string;
    user: { id: string; name: string } | null;
  }> = [],
) {
  await page.route("**/trpc/marketplace.getReviews*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          data: {
            items,
            nextCursor: undefined,
            summary: { averageRating: 0, count: items.length },
          },
        },
      }),
    });
  });
}

/**
 * Intercept services.get tRPC query and return a mock service.
 */
export async function mockServiceDetail(
  page: Page,
  pkg: Record<string, unknown> = MOCK_SERVICE,
) {
  await page.route("**/trpc/services.get*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: pkg },
      }),
    });
  });
}

/**
 * Intercept services.publish tRPC mutation and return success.
 */
export async function mockPublishService(page: Page) {
  await page.route("**/trpc/services.publish*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: { id: "pkg-new-001", name: "test-service" } },
      }),
    });
  });
}

/**
 * Intercept marketplace.install tRPC mutation and return success.
 */
export async function mockInstallComponent(page: Page) {
  await page.route("**/trpc/marketplace.install*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: { success: true } },
      }),
    });
  });
}

/**
 * Intercept services.install tRPC mutation and return success.
 */
export async function mockInstallService(page: Page) {
  await page.route("**/trpc/services.install*", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        result: { data: { success: true } },
      }),
    });
  });
}

/**
 * Click a marketplace tab by name (Components, Services, Publish).
 */
export async function switchToTab(page: Page, tabName: string) {
  await page.getByRole("tab", { name: tabName }).click();
}
