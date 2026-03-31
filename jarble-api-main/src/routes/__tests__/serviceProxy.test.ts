/**
 * Integration tests for the service proxy route.
 *
 * Tests the Express route handler by mounting on a temporary Express server
 * and using Node's built-in fetch. All external dependencies (DB, encryption,
 * HMAC, logger) are mocked.
 *
 * Route: POST /proxy/:deploymentId/:serviceId/:skillName
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";

// ── Mocks ────────────────────────────────────────────────────────────────────

// DB mock
const mockFindFirstServiceCreds = vi.fn();
const mockFindFirstService = vi.fn();
const mockFindFirstServiceUsage = vi.fn();
const mockFindFirstServiceInstalls = vi.fn();
const mockFindFirstDeployments = vi.fn();
const mockUpdateUsage = vi.fn().mockReturnThis();
const mockSetUsage = vi.fn().mockReturnThis();
const mockWhereUsage = vi.fn().mockResolvedValue(undefined);
const mockInsertUsage = vi.fn().mockReturnThis();
const mockValuesUsage = vi.fn().mockResolvedValue(undefined);

// Auth mock - prevent env.ts from loading at import time
const mockVerifyToken = vi.fn();
const mockGetUserFromToken = vi.fn();
vi.mock("../../services/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  getUserFromToken: (...args: any[]) => mockGetUserFromToken(...args),
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    USE_SQLITE: "true",
    DB_PROVIDER: "sqlite",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.test",
    STRIPE_SECRET_KEY: "",
    STRIPE_WEBHOOK_SECRET: "",
    FRONTEND_URL: "http://localhost:3000",
    ADMIN_USER_IDS: "",
  },
}));

vi.mock("../../db/index.js", () => ({
  db: {
    query: {
      serviceCredentials: { findFirst: (...args: any[]) => mockFindFirstServiceCreds(...args) },
      marketplaceServices: { findFirst: (...args: any[]) => mockFindFirstService(...args) },
      serviceUsage: { findFirst: (...args: any[]) => mockFindFirstServiceUsage(...args) },
      serviceInstalls: { findFirst: (...args: any[]) => mockFindFirstServiceInstalls(...args) },
      deployments: { findFirst: (...args: any[]) => mockFindFirstDeployments(...args) },
    },
    update: (...args: any[]) => {
      mockUpdateUsage(...args);
      return { set: (...setArgs: any[]) => { mockSetUsage(...setArgs); return { where: mockWhereUsage }; } };
    },
    insert: (...args: any[]) => {
      mockInsertUsage(...args);
      return { values: mockValuesUsage };
    },
  },
  tables: {
    serviceCredentials: {
      deploymentId: "deploymentId",
      packageId: "packageId",
    },
    marketplaceServices: {
      id: "id",
    },
    serviceUsage: {
      id: "id",
      deploymentId: "deploymentId",
      packageId: "packageId",
      skillName: "skillName",
      billingCycleStart: "billingCycleStart",
      requestCount: "requestCount",
    },
    serviceInstalls: {
      deploymentId: "deploymentId",
      packageId: "packageId",
    },
    deployments: {
      id: "id",
      userId: "userId",
    },
    serviceAsyncJobs: {
      id: "id",
      deploymentId: "deploymentId",
      expiresAt: "expiresAt",
    },
  },
  dbDate: (d?: Date) => d ?? new Date(),
}));

vi.mock("../../db/schema.js", () => ({
  generateMarketplaceId: (prefix: string) => `${prefix}_test123`,
}));

// Encryption mock
vi.mock("../../utils/encryption.js", () => ({
  decryptApiKey: vi.fn((stored: string) => {
    // Simulate the "plain:" prefix stripping for test simplicity
    if (stored.startsWith("plain:")) return stored.slice(6);
    return stored;
  }),
}));

// HMAC mock - use real implementation for signature verification
vi.mock("../../utils/hmac.js", async () => {
  const actual = await vi.importActual<typeof import("../../utils/hmac.js")>("../../utils/hmac.js");
  return {
    ...actual,
    signRequest: vi.fn(actual.signRequest),
  };
});

// Logger mock - suppress output
vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock serviceJobs to avoid DB calls
vi.mock("../serviceJobs.js", () => ({
  createAsyncJob: vi.fn().mockResolvedValue("sjb_test123"),
  completeAsyncJob: vi.fn().mockResolvedValue(undefined),
}));

import { resetAllServiceRateLimits } from "../../middleware/serviceRateLimit.js";
import { resetAllCircuits } from "../../services/circuitBreaker.js";
import { MemoryStateStore } from "../../services/memoryStateStore.js";
import { serviceProxyRouter } from "../serviceProxy.js";
import { signRequest } from "../../utils/hmac.js";

// ── Test server setup ────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;
let store: MemoryStateStore;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/services", serviceProxyRouter);
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

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a valid ServiceCard config JSON string. */
function buildRemoteApiConfig(overrides?: {
  endpoint?: string;
  authType?: "api_key" | "bearer";
  headerName?: string;
  skills?: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    maxRetries?: number;
    executionMode?: string;
  }>;
}): string {
  const skills = overrides?.skills ?? [
    {
      name: "get_weather",
      description: "Get current weather",
      inputSchema: {
        type: "object",
        properties: { location: { type: "string" } },
        required: ["location"],
      },
    },
  ];

  const authType = overrides?.authType ?? "api_key";
  const auth =
    authType === "bearer"
      ? { type: "bearer", headerName: overrides?.headerName ?? "Authorization" }
      : { type: "api_key", headerName: overrides?.headerName ?? "X-API-Key" };

  return JSON.stringify({
    endpoint: overrides?.endpoint ?? "https://api.creator.example.com/v1",
    auth,
    skills,
    version: "1.0.0",
  });
}

/** Configure mocks for a fully valid proxy request. */
function setupValidMocks(overrides?: {
  endpoint?: string;
  authType?: "api_key" | "bearer";
  headerName?: string;
  skills?: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    maxRetries?: number;
    executionMode?: string;
  }>;
}) {
  const signingSecret = "plain:test-signing-secret-hex-value-1234";

  mockFindFirstServiceCreds.mockResolvedValue({
    id: "pkc_001",
    deploymentId: "dep-001",
    serviceId: "pkg-001",
    signingSecret,
  });

  mockFindFirstService.mockResolvedValue({
    id: "pkg-001",
    remoteApiConfig: buildRemoteApiConfig(overrides),
  });

  return signingSecret;
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe("Service Proxy Route", () => {
  // We intercept global fetch for upstream requests. Save the original.
  const originalFetch = globalThis.fetch;

  const TEST_GATEWAY_TOKEN = "test-gateway-token-xyz";

  beforeEach(async () => {
    vi.clearAllMocks();
    store = new MemoryStateStore();
    await resetAllServiceRateLimits(store);
    await resetAllCircuits(store);

    // Default: gateway token auth passes for dep-001
    mockFindFirstDeployments.mockResolvedValue({
      id: "dep-001",
      userId: "user-1",
      gatewayToken: TEST_GATEWAY_TOKEN,
    });

    baseUrl = await startServer(createTestApp());
  });

  afterEach(() => {
    // Restore global fetch after each test
    globalThis.fetch = originalFetch;
    return new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  it("returns 404 when serviceCredentials not found for deployment+service", async () => {
    mockFindFirstServiceCreds.mockResolvedValue(null);

    const res = await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({ location: "NYC" }),
      },
    );

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("credentials not found");
  });

  it("returns 404 when service has no remoteApiConfig", async () => {
    mockFindFirstServiceCreds.mockResolvedValue({
      id: "pkc_001",
      signingSecret: "plain:secret",
    });
    mockFindFirstService.mockResolvedValue({
      id: "pkg-001",
      remoteApiConfig: null,
    });

    const res = await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({}),
      },
    );

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("no remote API configuration");
  });

  it("returns 404 when skill name not found in ServiceCard", async () => {
    setupValidMocks();

    const res = await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/nonexistent_skill`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({}),
      },
    );

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("nonexistent_skill");
    expect(data.error).toContain("not found");
  });

  it("successfully proxies a request to the creator endpoint", async () => {
    const endpoint = "https://api.creator.example.com/v1";
    setupValidMocks({ endpoint });

    // Mock the outbound fetch to the creator API
    const mockUpstreamResponse = new Response(
      JSON.stringify({ temperature: 72, unit: "F" }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );

    const fetchCalls: Array<{ url: string; options: RequestInit }> = [];
    globalThis.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.startsWith(endpoint)) {
        fetchCalls.push({ url: urlStr, options });
        return mockUpstreamResponse;
      }
      return originalFetch(url, options);
    }) as any;

    const res = await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({ location: "NYC" }),
      },
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as { temperature: number };
    expect(data.temperature).toBe(72);

    // Verify the outbound fetch was called with correct URL
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(`${endpoint}/skills/get_weather`);
  });

  it("returns 504 on upstream timeout", async () => {
    setupValidMocks();

    globalThis.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("creator.example.com")) {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        throw error;
      }
      return originalFetch(url, options);
    }) as any;

    const res = await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({ location: "NYC" }),
      },
    );

    expect(res.status).toBe(504);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("timed out");
  });

  it("returns 502 when response content-length exceeds 1MB", async () => {
    setupValidMocks();

    globalThis.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("creator.example.com")) {
        return new Response("too large", {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": String(2 * 1024 * 1024),
          },
        });
      }
      return originalFetch(url, options);
    }) as any;

    const res = await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({ location: "NYC" }),
      },
    );

    expect(res.status).toBe(502);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("size limit");
  });

  it("adds correct auth headers for api_key type", async () => {
    const endpoint = "https://api.creator.example.com/v1";
    setupValidMocks({
      endpoint,
      authType: "api_key",
      headerName: "X-Custom-Key",
    });

    const fetchCalls: Array<{ url: string; headers: Record<string, string> }> = [];

    globalThis.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.startsWith(endpoint)) {
        fetchCalls.push({ url: urlStr, headers: options.headers ?? {} });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(url, options);
    }) as any;

    await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({ location: "NYC" }),
      },
    );

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0].headers;
    expect(headers["X-Custom-Key"]).toBe("test-signing-secret-hex-value-1234");
  });

  it("adds correct HMAC signature headers", async () => {
    const endpoint = "https://api.creator.example.com/v1";
    setupValidMocks({ endpoint });

    const fetchCalls: Array<{ url: string; headers: Record<string, string> }> = [];

    globalThis.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.startsWith(endpoint)) {
        fetchCalls.push({ url: urlStr, headers: options.headers ?? {} });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(url, options);
    }) as any;

    await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({ location: "NYC" }),
      },
    );

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0].headers;

    expect(headers["X-Jarble-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(headers["X-Jarble-Timestamp"]).toBeDefined();
    const ts = parseInt(headers["X-Jarble-Timestamp"], 10);
    expect(ts).toBeGreaterThan(0);
    expect(headers["X-Jarble-Deployment-Id"]).toBe("dep-001");
    expect(signRequest).toHaveBeenCalled();
  });

  it("adds bearer auth headers for bearer type", async () => {
    const endpoint = "https://api.creator.example.com/v1";
    setupValidMocks({ endpoint, authType: "bearer" });

    const fetchCalls: Array<{ headers: Record<string, string> }> = [];

    globalThis.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.startsWith(endpoint)) {
        fetchCalls.push({ headers: options.headers ?? {} });
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return originalFetch(url, options);
    }) as any;

    await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({ location: "NYC" }),
      },
    );

    expect(fetchCalls).toHaveLength(1);
    const headers = fetchCalls[0].headers;
    expect(headers["Authorization"]).toBe("Bearer test-signing-secret-hex-value-1234");
  });

  it("returns 502 on non-abort upstream fetch failure", async () => {
    setupValidMocks();

    globalThis.fetch = vi.fn(async (url: any, options: any) => {
      const urlStr = typeof url === "string" ? url : url.toString();
      if (urlStr.includes("creator.example.com")) {
        throw new Error("ECONNREFUSED");
      }
      return originalFetch(url, options);
    }) as any;

    const res = await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({ location: "NYC" }),
      },
    );

    expect(res.status).toBe(502);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Failed to reach creator API");
  });

  it("returns 502 when remoteApiConfig is invalid JSON", async () => {
    mockFindFirstServiceCreds.mockResolvedValue({
      id: "pkc_001",
      signingSecret: "plain:secret",
    });
    mockFindFirstService.mockResolvedValue({
      id: "pkg-001",
      remoteApiConfig: "not valid json {{{",
    });

    const res = await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({}),
      },
    );

    expect(res.status).toBe(502);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Malformed service card");
  });

  it("returns 404 when service record itself is not found", async () => {
    mockFindFirstServiceCreds.mockResolvedValue({
      id: "pkc_001",
      signingSecret: "plain:secret",
    });
    mockFindFirstService.mockResolvedValue(null);

    const res = await originalFetch(
      `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
        body: JSON.stringify({}),
      },
    );

    expect(res.status).toBe(404);
    const data = (await res.json()) as { error: string };
    expect(data.error).toContain("Service not found");
  });

  // ── Usage Recording ────────────────────────────────────────────────────────

  describe("recordUsage (fire-and-forget after successful proxy)", () => {
    it("inserts a new usage record when no existing record for this billing cycle", async () => {
      const endpoint = "https://api.creator.example.com/v1";
      setupValidMocks({ endpoint });

      mockFindFirstServiceUsage.mockResolvedValue(null);
      mockFindFirstServiceInstalls.mockResolvedValue({
        id: "pki_001",
        deploymentId: "dep-001",
        serviceId: "pkg-001",
      });

      globalThis.fetch = vi.fn(async (url: any, options: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.startsWith(endpoint)) {
          return new Response(JSON.stringify({ result: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(url, options);
      }) as any;

      const res = await originalFetch(
        `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
          body: JSON.stringify({ location: "NYC" }),
        },
      );

      expect(res.status).toBe(200);

      // recordUsage is fire-and-forget, give it a moment to resolve
      await new Promise((r) => setTimeout(r, 50));

      expect(mockInsertUsage).toHaveBeenCalled();
      expect(mockValuesUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          packageInstallId: "pki_001",
          deploymentId: "dep-001",
          packageId: "pkg-001",
          skillName: "get_weather",
          requestCount: 1,
        }),
      );
    });

    it("increments existing usage record when one exists for this billing cycle", async () => {
      const endpoint = "https://api.creator.example.com/v1";
      setupValidMocks({ endpoint });

      mockFindFirstServiceUsage.mockResolvedValue({
        id: "pu_existing",
        requestCount: 42,
        billingCycleStart: "2026-03-01",
      });

      globalThis.fetch = vi.fn(async (url: any, options: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.startsWith(endpoint)) {
          return new Response(JSON.stringify({ result: "ok" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(url, options);
      }) as any;

      const res = await originalFetch(
        `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
          body: JSON.stringify({ location: "NYC" }),
        },
      );

      expect(res.status).toBe(200);
      await new Promise((r) => setTimeout(r, 50));
      expect(mockUpdateUsage).toHaveBeenCalled();
      expect(mockSetUsage).toHaveBeenCalled();
    });
  });

  // ── Input Schema Validation ───────────────────────────────────────────────

  describe("input schema validation", () => {
    it("returns 400 when required field is missing from body", async () => {
      setupValidMocks();

      const res = await originalFetch(
        `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
          body: JSON.stringify({}),
        },
      );

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string; details: string[] };
      expect(data.error).toContain("Input validation failed");
      expect(data.details).toEqual(
        expect.arrayContaining([expect.stringContaining("location")]),
      );
    });

    it("passes validation when all required fields have correct types", async () => {
      const endpoint = "https://api.creator.example.com/v1";
      setupValidMocks({ endpoint });

      globalThis.fetch = vi.fn(async (url: any, options: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.startsWith(endpoint)) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(url, options);
      }) as any;

      const res = await originalFetch(
        `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
          body: JSON.stringify({ location: "NYC" }),
        },
      );

      expect(res.status).toBe(200);
    });
  });

  // ── Rate Limiting ─────────────────────────────────────────────────────────

  describe("rate limiting", () => {
    it("returns 429 when per-minute rate limit is exceeded", async () => {
      const endpoint = "https://api.creator.example.com/v1";

      const signingSecret = "plain:test-signing-secret-hex-value-1234";
      mockFindFirstServiceCreds.mockResolvedValue({
        id: "pkc_001",
        deploymentId: "dep-001",
        serviceId: "pkg-001",
        signingSecret,
      });

      const serviceCardWithLimits = {
        endpoint,
        auth: { type: "api_key", headerName: "X-API-Key" },
        skills: [
          {
            name: "get_weather",
            description: "Get weather",
            inputSchema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
          },
        ],
        rateLimits: { requestsPerMinute: 2 },
        version: "1.0.0",
      };

      mockFindFirstService.mockResolvedValue({
        id: "pkg-001",
        remoteApiConfig: JSON.stringify(serviceCardWithLimits),
      });

      globalThis.fetch = vi.fn(async (url: any, options: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.startsWith(endpoint)) {
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(url, options);
      }) as any;

      // First 2 requests should succeed
      for (let i = 0; i < 2; i++) {
        const res = await originalFetch(
          `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
            body: JSON.stringify({ location: "NYC" }),
          },
        );
        expect(res.status).toBe(200);
      }

      // 3rd request should be rate limited
      const res = await originalFetch(
        `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
          body: JSON.stringify({ location: "NYC" }),
        },
      );

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeDefined();
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Rate limit exceeded");
    });
  });

  // ── Circuit Breaker ───────────────────────────────────────────────────────

  describe("circuit breaker", () => {
    it("returns 503 when circuit is open after consecutive failures", async () => {
      const endpoint = "https://api.creator.example.com/v1";
      setupValidMocks({ endpoint });

      globalThis.fetch = vi.fn(async (url: any, options: any) => {
        const urlStr = typeof url === "string" ? url : url.toString();
        if (urlStr.startsWith(endpoint)) {
          return new Response(JSON.stringify({ error: "Internal error" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
        return originalFetch(url, options);
      }) as any;

      // Make 5 requests (FAILURE_THRESHOLD = 5) to trip the circuit
      for (let i = 0; i < 5; i++) {
        await originalFetch(
          `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
            body: JSON.stringify({ location: "NYC" }),
          },
        );
      }

      // Next request should be blocked by circuit breaker (503)
      const res = await originalFetch(
        `${baseUrl}/api/services/proxy/dep-001/pkg-001/get_weather`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Gateway-Token": TEST_GATEWAY_TOKEN },
          body: JSON.stringify({ location: "NYC" }),
        },
      );

      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBeDefined();
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("circuit breaker");
    });
  });
});
