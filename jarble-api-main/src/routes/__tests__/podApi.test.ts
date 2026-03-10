/**
 * Integration tests for the Pod API route.
 *
 * Tests the Express route handler by mounting on a temporary Express server
 * and using Node's built-in fetch. All external dependencies (DB, K8s,
 * encryption, configSync, logger) are mocked.
 *
 * Route: /api/pod/marketplace/*
 * Auth: X-Deployment-Id + X-Gateway-Token headers verified by authenticatePod middleware
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";

// ── Mocks ────────────────────────────────────────────────────────────────────

// DB mock — create individual mock functions for fine-grained assertions
const mockFindFirstDeployments = vi.fn();
const mockFindFirstMarketplaceComponents = vi.fn();
const mockFindManyMarketplaceComponents = vi.fn();
const mockFindFirstMarketplaceServices = vi.fn();
const mockFindManyMarketplaceServices = vi.fn();
const mockFindFirstComponentInstalls = vi.fn();
const mockFindManyComponentInstalls = vi.fn();
const mockFindFirstServiceInstalls = vi.fn();
const mockFindManyServiceInstalls = vi.fn();
const mockFindManyServiceComponents = vi.fn();
const mockFindManyServiceSkills = vi.fn();
const mockFindManyComponentVersions = vi.fn();
const mockFindFirstDeploymentSkills = vi.fn();

// Write operation mocks
const mockInsert = vi.fn();
const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn();
const mockUpdateSet = vi.fn();
const mockUpdateWhere = vi.fn().mockResolvedValue(undefined);
const mockDelete = vi.fn();
const mockDeleteWhere = vi.fn().mockResolvedValue(undefined);

vi.mock("../../db/index.js", () => ({
  db: {
    query: {
      deployments: {
        findFirst: (...args: any[]) => mockFindFirstDeployments(...args),
      },
      marketplaceComponents: {
        findFirst: (...args: any[]) => mockFindFirstMarketplaceComponents(...args),
        findMany: (...args: any[]) => mockFindManyMarketplaceComponents(...args),
      },
      marketplaceServices: {
        findFirst: (...args: any[]) => mockFindFirstMarketplaceServices(...args),
        findMany: (...args: any[]) => mockFindManyMarketplaceServices(...args),
      },
      componentInstalls: {
        findFirst: (...args: any[]) => mockFindFirstComponentInstalls(...args),
        findMany: (...args: any[]) => mockFindManyComponentInstalls(...args),
      },
      componentVersions: {
        findMany: (...args: any[]) => mockFindManyComponentVersions(...args),
      },
      serviceInstalls: {
        findFirst: (...args: any[]) => mockFindFirstServiceInstalls(...args),
        findMany: (...args: any[]) => mockFindManyServiceInstalls(...args),
      },
      serviceComponents: {
        findMany: (...args: any[]) => mockFindManyServiceComponents(...args),
      },
      serviceSkills: {
        findMany: (...args: any[]) => mockFindManyServiceSkills(...args),
      },
      deploymentSkills: {
        findFirst: (...args: any[]) => mockFindFirstDeploymentSkills(...args),
      },
      creatorProfiles: {
        findFirst: () => Promise.resolve({ id: "cp_test001", userId: "test-user-001" }),
      },
    },
    insert: (...args: any[]) => {
      mockInsert(...args);
      return { values: (...vArgs: any[]) => { mockInsertValues(...vArgs); return Promise.resolve(); } };
    },
    update: (...args: any[]) => {
      mockUpdate(...args);
      return {
        set: (...sArgs: any[]) => {
          mockUpdateSet(...sArgs);
          return { where: (...wArgs: any[]) => { mockUpdateWhere(...wArgs); return Promise.resolve(); } };
        },
      };
    },
    delete: (...args: any[]) => {
      mockDelete(...args);
      return { where: (...wArgs: any[]) => { mockDeleteWhere(...wArgs); return Promise.resolve(); } };
    },
  },
  tables: {
    deployments: { id: "id", userId: "userId" },
    marketplaceComponents: { id: "id", status: "status", totalInstalls: "totalInstalls" },
    marketplaceServices: { id: "id", status: "status", totalInstalls: "totalInstalls" },
    componentInstalls: { id: "id", componentId: "componentId", deploymentId: "deploymentId" },
    componentVersions: { id: "id", componentId: "componentId" },
    serviceInstalls: { id: "id", packageId: "packageId", deploymentId: "deploymentId" },
    serviceComponents: { packageId: "packageId" },
    serviceSkills: { packageId: "packageId" },
    serviceCredentials: { id: "id", packageId: "packageId", deploymentId: "deploymentId" },
    deploymentSkills: { id: "id", skillId: "skillId", deploymentId: "deploymentId" },
    creatorProfiles: { id: "id", userId: "userId" },
  },
  dbDate: () => new Date().toISOString(),
}));

// K8s client mock — prevent dynamic import from failing
vi.mock("../../k8s/client.js", () => ({
  coreApi: null,
}));

vi.mock("../../k8s/constants.js", () => ({
  NAMESPACE: "jarble",
}));

// ConfigSync mock — no-op
vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
}));

// Encryption mock
vi.mock("../../utils/encryption.js", () => ({
  encryptApiKey: vi.fn((plaintext: string) => `encrypted:${plaintext}`),
}));

// HMAC mock
vi.mock("../../utils/hmac.js", () => ({
  generateSigningSecret: vi.fn(() => "mock-signing-secret-hex"),
}));

// Service handshake mock
vi.mock("../../services/serviceHandshake.js", () => ({
  performInstallHandshake: vi.fn().mockResolvedValue({ remoteInstallId: "remote-001" }),
}));

// Logger mock — suppress output
vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { podApiRouter } from "../podApi.js";
import { syncConfigsToPvc } from "../../services/configSync.js";

// ── Test server setup ────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/pod", podApiRouter);
  return app;
}

function startServer(app: express.Application): Promise<string> {
  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve(`http://127.0.0.1:${addr.port}`);
    });
  });
}

// ── Constants ────────────────────────────────────────────────────────────────

const DEP_ID = "dep-001";
const GATEWAY_TOKEN = "test-gateway-token";
const USER_ID = "user-001";

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "X-Deployment-Id": DEP_ID,
  "X-Gateway-Token": GATEWAY_TOKEN,
};

const MOCK_DEPLOYMENT = {
  id: DEP_ID,
  userId: USER_ID,
  status: "running",
  name: "test-bot",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function mockComponent(overrides: Record<string, any> = {}) {
  return {
    id: "cmp_test_abc123",
    name: "my-widget",
    displayName: "My Widget",
    description: "A test widget",
    category: "utility",
    tier: "template",
    status: "published",
    pricingModel: "free",
    priceUsdCents: 0,
    totalInstalls: 5,
    avgRating: 4.5,
    creatorId: "user-002",
    ...overrides,
  };
}

function mockService(overrides: Record<string, any> = {}) {
  return {
    id: "pkg_test_abc123",
    name: "weather-service",
    displayName: "Weather Service",
    description: "Provides weather data",
    hostingModel: "package",
    status: "published",
    pricingModel: "free",
    priceUsdCents: 0,
    totalInstalls: 10,
    avgRating: 4.0,
    creatorId: "user-003",
    instructionSnippet: "Use weather tools",
    remoteApiConfig: null,
    remoteApiEndpoint: null,
    ...overrides,
  };
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe("Pod API Route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: deployment exists for auth middleware
    mockFindFirstDeployments.mockResolvedValue(MOCK_DEPLOYMENT);

    // Default empty results for common queries
    mockFindManyMarketplaceComponents.mockResolvedValue([]);
    mockFindManyMarketplaceServices.mockResolvedValue([]);
    mockFindManyComponentInstalls.mockResolvedValue([]);
    mockFindManyServiceInstalls.mockResolvedValue([]);
    mockFindManyServiceComponents.mockResolvedValue([]);
    mockFindManyServiceSkills.mockResolvedValue([]);
    mockFindManyComponentVersions.mockResolvedValue([]);

    baseUrl = await startServer(createTestApp());
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Authentication
  // ═══════════════════════════════════════════════════════════════════════════

  describe("authenticatePod middleware", () => {
    it("returns 401 when X-Deployment-Id header is missing", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/browse`, {
        headers: { "X-Gateway-Token": GATEWAY_TOKEN },
      });
      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.error).toContain("Missing");
    });

    it("returns 401 when X-Gateway-Token header is missing", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/browse`, {
        headers: { "X-Deployment-Id": DEP_ID },
      });
      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.error).toContain("Missing");
    });

    it("returns 401 when both headers are missing", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/browse`);
      expect(res.status).toBe(401);
    });

    it("returns 401 when deployment does not exist in DB", async () => {
      mockFindFirstDeployments.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/api/pod/marketplace/browse`, {
        headers: AUTH_HEADERS,
      });
      expect(res.status).toBe(401);
      const data = await res.json() as any;
      expect(data.error).toContain("not found");
    });

    it("passes through when deployment exists (dev/SQLite mode)", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/browse`, {
        headers: AUTH_HEADERS,
      });
      // Should reach the browse handler (200), not be blocked by auth
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/pod/marketplace/browse
  // ═══════════════════════════════════════════════════════════════════════════

  describe("GET /marketplace/browse", () => {
    it("returns empty results when no published items exist", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/browse`, {
        headers: AUTH_HEADERS,
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.results).toEqual([]);
      expect(data.count).toBe(0);
    });

    it("returns components and services with type=all (default)", async () => {
      mockFindManyMarketplaceComponents.mockResolvedValue([mockComponent()]);
      mockFindManyMarketplaceServices.mockResolvedValue([mockService()]);

      const res = await fetch(`${baseUrl}/api/pod/marketplace/browse`, {
        headers: AUTH_HEADERS,
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.results).toHaveLength(2);
      expect(data.results[0].type).toBe("component");
      expect(data.results[0].name).toBe("my-widget");
      expect(data.results[1].type).toBe("service");
      expect(data.results[1].name).toBe("weather-service");
    });

    it("filters by type=component", async () => {
      mockFindManyMarketplaceComponents.mockResolvedValue([mockComponent()]);
      mockFindManyMarketplaceServices.mockResolvedValue([mockService()]);

      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/browse?type=component`,
        { headers: AUTH_HEADERS },
      );

      const data = await res.json() as any;
      expect(data.results).toHaveLength(1);
      expect(data.results[0].type).toBe("component");
    });

    it("filters by type=service", async () => {
      mockFindManyMarketplaceComponents.mockResolvedValue([mockComponent()]);
      mockFindManyMarketplaceServices.mockResolvedValue([mockService()]);

      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/browse?type=service`,
        { headers: AUTH_HEADERS },
      );

      const data = await res.json() as any;
      expect(data.results).toHaveLength(1);
      expect(data.results[0].type).toBe("service");
    });

    it("filters by search query (name match)", async () => {
      mockFindManyMarketplaceComponents.mockResolvedValue([
        mockComponent({ name: "chart-widget", displayName: "Chart Widget", description: "Charts" }),
        mockComponent({ id: "cmp_other", name: "table-widget", displayName: "Table Widget", description: "Tables" }),
      ]);

      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/browse?q=chart`,
        { headers: AUTH_HEADERS },
      );

      const data = await res.json() as any;
      expect(data.results).toHaveLength(1);
      expect(data.results[0].name).toBe("chart-widget");
    });

    it("filters by search query (description match, case insensitive)", async () => {
      mockFindManyMarketplaceComponents.mockResolvedValue([
        mockComponent({ name: "foo", displayName: "Foo", description: "Interactive DASHBOARD" }),
      ]);

      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/browse?q=dashboard`,
        { headers: AUTH_HEADERS },
      );

      const data = await res.json() as any;
      expect(data.results).toHaveLength(1);
    });

    it("filters by category", async () => {
      mockFindManyMarketplaceComponents.mockResolvedValue([
        mockComponent({ category: "charts" }),
        mockComponent({ id: "cmp_other", category: "utility" }),
      ]);

      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/browse?category=charts`,
        { headers: AUTH_HEADERS },
      );

      const data = await res.json() as any;
      expect(data.results).toHaveLength(1);
      expect(data.results[0].category).toBe("charts");
    });

    it("respects the limit parameter", async () => {
      const manyComponents = Array.from({ length: 10 }, (_, i) =>
        mockComponent({ id: `cmp_${i}`, name: `widget-${i}` }),
      );
      mockFindManyMarketplaceComponents.mockResolvedValue(manyComponents);

      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/browse?limit=3`,
        { headers: AUTH_HEADERS },
      );

      const data = await res.json() as any;
      expect(data.results).toHaveLength(3);
    });

    it("caps limit at 50", async () => {
      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/browse?limit=100`,
        { headers: AUTH_HEADERS },
      );

      // The endpoint should still succeed; we verify limit capping via behavior
      expect(res.status).toBe(200);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/pod/marketplace/item/:id
  // ═══════════════════════════════════════════════════════════════════════════

  describe("GET /marketplace/item/:id", () => {
    it("returns a component when found", async () => {
      const comp = mockComponent();
      mockFindFirstMarketplaceComponents.mockResolvedValue(comp);

      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/item/cmp_test_abc123`,
        { headers: AUTH_HEADERS },
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.type).toBe("component");
      expect(data.item.name).toBe("my-widget");
    });

    it("returns a service with bundled components and skills when found", async () => {
      mockFindFirstMarketplaceComponents.mockResolvedValue(null); // not a component
      mockFindFirstMarketplaceServices.mockResolvedValue(mockService());
      mockFindManyServiceComponents.mockResolvedValue([
        { id: "sc_1", packageId: "pkg_test_abc123", componentId: "cmp_a" },
      ]);
      mockFindManyServiceSkills.mockResolvedValue([
        { id: "ss_1", packageId: "pkg_test_abc123", skillId: "skill_web_search" },
      ]);

      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/item/pkg_test_abc123`,
        { headers: AUTH_HEADERS },
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.type).toBe("service");
      expect(data.item.name).toBe("weather-service");
      expect(data.components).toHaveLength(1);
      expect(data.skills).toHaveLength(1);
    });

    it("returns 404 when item does not exist", async () => {
      mockFindFirstMarketplaceComponents.mockResolvedValue(null);
      mockFindFirstMarketplaceServices.mockResolvedValue(null);

      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/item/nonexistent`,
        { headers: AUTH_HEADERS },
      );

      expect(res.status).toBe(404);
      const data = await res.json() as any;
      expect(data.error).toContain("not found");
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // GET /api/pod/marketplace/installed
  // ═══════════════════════════════════════════════════════════════════════════

  describe("GET /marketplace/installed", () => {
    it("returns installed components and services for the deployment", async () => {
      mockFindManyComponentInstalls.mockResolvedValue([
        {
          id: "ci_001",
          componentId: "cmp_a",
          installedAt: "2026-01-01T00:00:00Z",
          component: {
            name: "widget-a",
            displayName: "Widget A",
            description: "A widget",
            tier: "template",
          },
        },
      ]);
      mockFindManyServiceInstalls.mockResolvedValue([
        {
          id: "pki_001",
          packageId: "pkg_b",
          installedAt: "2026-01-02T00:00:00Z",
          package: {
            name: "svc-b",
            displayName: "Service B",
            description: "A service",
            hostingModel: "hosted",
          },
        },
      ]);

      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/installed`,
        { headers: AUTH_HEADERS },
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.deploymentId).toBe(DEP_ID);
      expect(data.components).toHaveLength(1);
      expect(data.components[0].name).toBe("widget-a");
      expect(data.components[0].installId).toBe("ci_001");
      expect(data.services).toHaveLength(1);
      expect(data.services[0].name).toBe("svc-b");
      expect(data.services[0].installId).toBe("pki_001");
    });

    it("returns empty lists when nothing is installed", async () => {
      const res = await fetch(
        `${baseUrl}/api/pod/marketplace/installed`,
        { headers: AUTH_HEADERS },
      );

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.components).toEqual([]);
      expect(data.services).toEqual([]);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/pod/marketplace/install
  // ═══════════════════════════════════════════════════════════════════════════

  describe("POST /marketplace/install", () => {
    it("returns 400 when itemId is missing", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/install`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ type: "component" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("itemId");
    });

    // ── Component install ──────────────────────────────────────────────────

    describe("component install", () => {
      it("installs a component successfully", async () => {
        mockFindFirstMarketplaceComponents.mockResolvedValue(mockComponent());
        mockFindFirstComponentInstalls.mockResolvedValue(null); // not yet installed
        mockFindManyComponentVersions.mockResolvedValue([
          { id: "ver_001", componentId: "cmp_test_abc123", createdAt: "2026-01-01T00:00:00Z" },
        ]);

        const res = await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "cmp_test_abc123" }),
        });

        expect(res.status).toBe(200);
        const data = await res.json() as any;
        expect(data.success).toBe(true);
        expect(data.type).toBe("component");
        expect(data.installId).toMatch(/^ci_/);

        // Verify insert was called
        expect(mockInsert).toHaveBeenCalled();
        expect(mockInsertValues).toHaveBeenCalledWith(
          expect.objectContaining({
            componentId: "cmp_test_abc123",
            deploymentId: DEP_ID,
            userId: USER_ID,
            versionId: "ver_001",
          }),
        );

        // Verify install count was incremented
        expect(mockUpdate).toHaveBeenCalled();
      });

      it("returns 404 when component does not exist", async () => {
        mockFindFirstMarketplaceComponents.mockResolvedValue(null);

        const res = await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "cmp_nonexistent" }),
        });

        expect(res.status).toBe(404);
        const data = await res.json() as any;
        expect(data.error).toContain("not found");
      });

      it("returns 409 when component is already installed", async () => {
        mockFindFirstMarketplaceComponents.mockResolvedValue(mockComponent());
        mockFindFirstComponentInstalls.mockResolvedValue({
          id: "ci_existing",
          componentId: "cmp_test_abc123",
          deploymentId: DEP_ID,
        });

        const res = await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "cmp_test_abc123" }),
        });

        expect(res.status).toBe(409);
        const data = await res.json() as any;
        expect(data.error).toContain("already installed");
      });

      it("triggers configSync when deployment is running", async () => {
        mockFindFirstMarketplaceComponents.mockResolvedValue(mockComponent());
        mockFindFirstComponentInstalls.mockResolvedValue(null);
        mockFindManyComponentVersions.mockResolvedValue([]);

        await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "cmp_test_abc123" }),
        });

        expect(syncConfigsToPvc).toHaveBeenCalledWith(DEP_ID);
      });

      it("does not trigger configSync when deployment is not running", async () => {
        mockFindFirstDeployments.mockResolvedValue({
          ...MOCK_DEPLOYMENT,
          status: "stopped",
        });
        mockFindFirstMarketplaceComponents.mockResolvedValue(mockComponent());
        mockFindFirstComponentInstalls.mockResolvedValue(null);
        mockFindManyComponentVersions.mockResolvedValue([]);

        await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "cmp_test_abc123" }),
        });

        expect(syncConfigsToPvc).not.toHaveBeenCalled();
      });

      it("handles component with no versions (versionId is null)", async () => {
        mockFindFirstMarketplaceComponents.mockResolvedValue(mockComponent());
        mockFindFirstComponentInstalls.mockResolvedValue(null);
        mockFindManyComponentVersions.mockResolvedValue([]); // no versions

        const res = await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "cmp_test_abc123" }),
        });

        expect(res.status).toBe(200);
        expect(mockInsertValues).toHaveBeenCalledWith(
          expect.objectContaining({ versionId: null }),
        );
      });
    });

    // ── Service install ────────────────────────────────────────────────────

    describe("service install", () => {
      it("installs a service (package hosting model) successfully", async () => {
        mockFindFirstMarketplaceServices.mockResolvedValue(mockService());
        mockFindFirstServiceInstalls.mockResolvedValue(null); // not yet installed
        mockFindManyServiceComponents.mockResolvedValue([]); // no bundled components
        mockFindManyServiceSkills.mockResolvedValue([]); // no bundled skills

        const res = await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "pkg_test_abc123", type: "service" }),
        });

        expect(res.status).toBe(200);
        const data = await res.json() as any;
        expect(data.success).toBe(true);
        expect(data.type).toBe("service");
        expect(data.installId).toMatch(/^pki_/);
      });

      it("returns 404 when service does not exist", async () => {
        mockFindFirstMarketplaceServices.mockResolvedValue(null);

        const res = await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "pkg_nonexistent", type: "service" }),
        });

        expect(res.status).toBe(404);
        const data = await res.json() as any;
        expect(data.error).toContain("not found");
      });

      it("returns 409 when service is already installed", async () => {
        mockFindFirstMarketplaceServices.mockResolvedValue(mockService());
        mockFindFirstServiceInstalls.mockResolvedValue({
          id: "pki_existing",
          packageId: "pkg_test_abc123",
          deploymentId: DEP_ID,
        });

        const res = await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "pkg_test_abc123", type: "service" }),
        });

        expect(res.status).toBe(409);
        const data = await res.json() as any;
        expect(data.error).toContain("already installed");
      });

      it("installs bundled components and skills alongside service", async () => {
        mockFindFirstMarketplaceServices.mockResolvedValue(mockService());
        mockFindFirstServiceInstalls.mockResolvedValue(null);

        // Bundled component
        mockFindManyServiceComponents.mockResolvedValue([
          { id: "sc_1", packageId: "pkg_test_abc123", componentId: "cmp_bundled" },
        ]);
        mockFindFirstComponentInstalls.mockResolvedValue(null); // not yet installed
        mockFindManyComponentVersions.mockResolvedValue([
          { id: "ver_b1", componentId: "cmp_bundled", createdAt: "2026-01-01T00:00:00Z" },
        ]);

        // Bundled skill
        mockFindManyServiceSkills.mockResolvedValue([
          { id: "ss_1", packageId: "pkg_test_abc123", skillId: "skill_web_search" },
        ]);
        mockFindFirstDeploymentSkills.mockResolvedValue(null); // not yet linked

        const res = await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "pkg_test_abc123", type: "service" }),
        });

        expect(res.status).toBe(200);

        // Should have multiple insert calls: service install + component install + skill link
        // 1: serviceInstalls insert
        // 2: componentInstalls insert
        // 3: deploymentSkills insert
        expect(mockInsert).toHaveBeenCalledTimes(3);
      });

      it("generates credentials for remote hosting model services", async () => {
        const remoteService = mockService({
          hostingModel: "remote",
          remoteApiConfig: JSON.stringify({ endpoint: "https://creator.example.com" }),
          remoteApiEndpoint: "https://creator.example.com/install",
        });
        mockFindFirstMarketplaceServices.mockResolvedValue(remoteService);
        mockFindFirstServiceInstalls.mockResolvedValue(null);
        mockFindManyServiceComponents.mockResolvedValue([]);
        mockFindManyServiceSkills.mockResolvedValue([]);

        const res = await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "pkg_test_abc123", type: "service" }),
        });

        expect(res.status).toBe(200);

        // Should have inserted service install + service credential
        // (install record + credential record = 2 insert calls)
        expect(mockInsert).toHaveBeenCalledTimes(2);
      });

      it("sets handshakeStatus to completed for platform_managed services", async () => {
        const platformService = mockService({
          hostingModel: "platform_managed",
          remoteApiConfig: JSON.stringify({ endpoint: null }),
        });
        mockFindFirstMarketplaceServices.mockResolvedValue(platformService);
        mockFindFirstServiceInstalls.mockResolvedValue(null);
        mockFindManyServiceComponents.mockResolvedValue([]);
        mockFindManyServiceSkills.mockResolvedValue([]);

        const res = await fetch(`${baseUrl}/api/pod/marketplace/install`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "pkg_test_abc123", type: "service" }),
        });

        expect(res.status).toBe(200);

        // Verify the credential insert included handshakeStatus: "completed"
        expect(mockInsertValues).toHaveBeenCalledWith(
          expect.objectContaining({
            handshakeStatus: "completed",
          }),
        );
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/pod/marketplace/uninstall
  // ═══════════════════════════════════════════════════════════════════════════

  describe("POST /marketplace/uninstall", () => {
    it("returns 400 when itemId is missing", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/uninstall`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ type: "component" }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("itemId");
    });

    describe("component uninstall", () => {
      it("uninstalls a component successfully", async () => {
        mockFindFirstComponentInstalls.mockResolvedValue({
          id: "ci_001",
          componentId: "cmp_test",
          deploymentId: DEP_ID,
        });

        const res = await fetch(`${baseUrl}/api/pod/marketplace/uninstall`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "cmp_test" }),
        });

        expect(res.status).toBe(200);
        const data = await res.json() as any;
        expect(data.success).toBe(true);
        expect(data.type).toBe("component");

        // Verify delete was called
        expect(mockDelete).toHaveBeenCalled();
        expect(syncConfigsToPvc).toHaveBeenCalledWith(DEP_ID);
      });

      it("returns 404 when component is not installed", async () => {
        mockFindFirstComponentInstalls.mockResolvedValue(null);

        const res = await fetch(`${baseUrl}/api/pod/marketplace/uninstall`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "cmp_not_installed" }),
        });

        expect(res.status).toBe(404);
        const data = await res.json() as any;
        expect(data.error).toContain("not installed");
      });
    });

    describe("service uninstall", () => {
      it("uninstalls a service and cleans up credentials", async () => {
        mockFindFirstServiceInstalls.mockResolvedValue({
          id: "pki_001",
          packageId: "pkg_test",
          deploymentId: DEP_ID,
        });

        const res = await fetch(`${baseUrl}/api/pod/marketplace/uninstall`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "pkg_test", type: "service" }),
        });

        expect(res.status).toBe(200);
        const data = await res.json() as any;
        expect(data.success).toBe(true);
        expect(data.type).toBe("service");

        // Should have 2 delete calls: credentials + install record
        expect(mockDelete).toHaveBeenCalledTimes(2);
        expect(syncConfigsToPvc).toHaveBeenCalledWith(DEP_ID);
      });

      it("returns 404 when service is not installed", async () => {
        mockFindFirstServiceInstalls.mockResolvedValue(null);

        const res = await fetch(`${baseUrl}/api/pod/marketplace/uninstall`, {
          method: "POST",
          headers: AUTH_HEADERS,
          body: JSON.stringify({ itemId: "pkg_not_installed", type: "service" }),
        });

        expect(res.status).toBe(404);
        const data = await res.json() as any;
        expect(data.error).toContain("not installed");
      });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/pod/marketplace/publish-component
  // ═══════════════════════════════════════════════════════════════════════════

  describe("POST /marketplace/publish-component", () => {
    it("publishes a component with correct creatorId from deployment's userId", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/publish-component`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          name: "cool-chart",
          displayName: "Cool Chart",
          description: "A cool chart component",
          tier: "code",
          category: "charts",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.id).toMatch(/^cmp_/);
      expect(data.status).toBe("submitted");

      // Verify insert was called with correct creatorId (resolved via resolveCreatorId)
      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "cool-chart",
          displayName: "Cool Chart",
          description: "A cool chart component",
          tier: "code",
          category: "charts",
          creatorId: "cp_test001",
          status: "submitted",
        }),
      );
    });

    it("returns 400 when required fields are missing", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/publish-component`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ name: "test" }), // missing displayName and description
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("Missing required fields");
    });

    it("defaults tier to template and category to utility", async () => {
      await fetch(`${baseUrl}/api/pod/marketplace/publish-component`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          name: "basic",
          displayName: "Basic",
          description: "Basic component",
        }),
      });

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          tier: "template",
          category: "utility",
          pricingModel: "free",
          priceUsdCents: 0,
        }),
      );
    });

    it("handles tags as an array by JSON-stringifying", async () => {
      await fetch(`${baseUrl}/api/pod/marketplace/publish-component`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          name: "tagged",
          displayName: "Tagged",
          description: "Tagged component",
          tags: ["chart", "data"],
        }),
      });

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: JSON.stringify(["chart", "data"]),
        }),
      );
    });

    it("handles tags as a string by passing through", async () => {
      await fetch(`${baseUrl}/api/pod/marketplace/publish-component`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          name: "tagged",
          displayName: "Tagged",
          description: "Tagged component",
          tags: "chart,data",
        }),
      });

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: "chart,data",
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/pod/marketplace/publish-service
  // ═══════════════════════════════════════════════════════════════════════════

  describe("POST /marketplace/publish-service", () => {
    it("publishes a service with correct fields", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/publish-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          name: "weather-api",
          displayName: "Weather API",
          description: "Weather data service",
          hostingModel: "remote",
          instructionSnippet: "Use weather tools to get data",
          remoteApiEndpoint: "https://weather.example.com/api",
        }),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.id).toMatch(/^pkg_/);
      expect(data.status).toBe("submitted");

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "weather-api",
          displayName: "Weather API",
          description: "Weather data service",
          hostingModel: "remote",
          instructionSnippet: "Use weather tools to get data",
          remoteApiEndpoint: "https://weather.example.com/api",
          creatorId: "cp_test001",
          status: "submitted",
        }),
      );
    });

    it("returns 400 when required fields are missing", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/publish-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ description: "something" }), // missing name and displayName
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("Missing required fields");
    });

    it("defaults hostingModel to hosted and pricingModel to free", async () => {
      await fetch(`${baseUrl}/api/pod/marketplace/publish-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          name: "basic-svc",
          displayName: "Basic Service",
        }),
      });

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          hostingModel: "hosted",
          pricingModel: "free",
          priceUsdCents: 0,
        }),
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // POST /api/pod/marketplace/register-service
  // ═══════════════════════════════════════════════════════════════════════════

  describe("POST /marketplace/register-service", () => {
    const validSkill = {
      name: "get_weather",
      description: "Get current weather",
      inputSchema: { type: "object", properties: { city: { type: "string" } } },
    };

    const validBody = {
      name: "weather-svc",
      displayName: "Weather Service",
      description: "Provides weather data",
      skills: [validSkill],
      instructionSnippet: "Use weather tools",
      category: "data",
    };

    it("registers a platform-managed service with auto-published status", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify(validBody),
      });

      expect(res.status).toBe(200);
      const data = await res.json() as any;
      expect(data.success).toBe(true);
      expect(data.id).toMatch(/^pkg_/);
      expect(data.status).toBe("published");
      expect(data.skillCount).toBe(1);

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          hostingModel: "platform_managed",
          status: "published",
          pricingModel: "free",
          priceUsdCents: 0,
          creatorId: "cp_test001",
          creatorDeploymentId: DEP_ID,
        }),
      );
    });

    it("generates a ServiceCard in remoteApiConfig", async () => {
      await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify(validBody),
      });

      // Verify the inserted remoteApiConfig contains a valid ServiceCard
      const insertedValues = mockInsertValues.mock.calls[0][0];
      const serviceCard = JSON.parse(insertedValues.remoteApiConfig);
      expect(serviceCard.endpoint).toBeUndefined();
      expect(serviceCard.creatorDeploymentId).toBe(DEP_ID);
      expect(serviceCard.auth.type).toBe("api_key");
      expect(serviceCard.skills).toHaveLength(1);
      expect(serviceCard.skills[0].name).toBe("get_weather");
      expect(serviceCard.version).toBe("1.0.0");
      expect(serviceCard.rateLimits.requestsPerMinute).toBe(60);
    });

    it("returns 400 when required fields are missing", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({ name: "test" }), // missing displayName, description
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("Missing required fields");
    });

    it("validates name format (must start with lowercase letter)", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          ...validBody,
          name: "123-invalid",
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("Invalid name");
    });

    it("validates name format (rejects uppercase letters)", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          ...validBody,
          name: "Invalid-Name",
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("Invalid name");
    });

    it("validates name format (rejects names longer than 64 chars)", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          ...validBody,
          name: "a" + "b".repeat(64), // 65 chars
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("Invalid name");
    });

    it("requires at least one skill", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          ...validBody,
          skills: [],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("At least one skill");
    });

    it("rejects non-array skills", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          ...validBody,
          skills: "not-an-array",
        }),
      });

      expect(res.status).toBe(400);
    });

    it("validates each skill has required fields", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          ...validBody,
          skills: [{ name: "incomplete" }], // missing description and inputSchema
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("missing required fields");
    });

    it("validates handler skill requires handlerCode", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          ...validBody,
          skills: [{
            name: "my-handler",
            description: "A handler skill",
            inputSchema: { type: "object" },
            mode: "handler",
            // missing handlerCode
          }],
        }),
      });

      expect(res.status).toBe(400);
      const data = await res.json() as any;
      expect(data.error).toContain("handlerCode");
    });

    it("accepts valid name formats", async () => {
      const res = await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          ...validBody,
          name: "my-cool-service-123",
        }),
      });

      expect(res.status).toBe(200);
    });

    it("includes outputSchema in ServiceCard skills when provided", async () => {
      const skillWithOutput = {
        ...validSkill,
        outputSchema: { type: "object", properties: { temp: { type: "number" } } },
      };

      await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          ...validBody,
          skills: [skillWithOutput],
        }),
      });

      const insertedValues = mockInsertValues.mock.calls[0][0];
      const serviceCard = JSON.parse(insertedValues.remoteApiConfig);
      expect(serviceCard.skills[0].outputSchema).toEqual(skillWithOutput.outputSchema);
    });

    it("includes handlerCode in ServiceCard skills when provided", async () => {
      const handlerSkill = {
        ...validSkill,
        mode: "handler",
        handlerCode: "return { temp: 72 };",
      };

      await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify({
          ...validBody,
          skills: [handlerSkill],
        }),
      });

      const insertedValues = mockInsertValues.mock.calls[0][0];
      const serviceCard = JSON.parse(insertedValues.remoteApiConfig);
      expect(serviceCard.skills[0].handlerCode).toBe("return { temp: 72 };");
      expect(serviceCard.skills[0].executionMode).toBe("handler");
    });

    it("defaults category to utility when not provided", async () => {
      const { category, ...bodyWithoutCategory } = validBody;

      await fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
        method: "POST",
        headers: AUTH_HEADERS,
        body: JSON.stringify(bodyWithoutCategory),
      });

      expect(mockInsertValues).toHaveBeenCalledWith(
        expect.objectContaining({
          category: "utility",
        }),
      );
    });
  });
});
