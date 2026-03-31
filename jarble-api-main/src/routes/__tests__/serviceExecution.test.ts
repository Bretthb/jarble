/**
 * Integration tests for the service execution route.
 *
 * Tests the Express route handler by mounting on a temporary Express server
 * and using Node's built-in fetch. All external dependencies (DB, K8s, auth,
 * logger) are mocked.
 *
 * Route: POST /execute/:serviceId/:skillName
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";

// ── Mocks ────────────────────────────────────────────────────────────────────

// DB mock
const mockFindFirstServiceCreds = vi.fn();
const mockFindFirstService = vi.fn();
const mockFindFirstDeployments = vi.fn();
const mockFindFirstServiceUsage = vi.fn();
const mockFindFirstServiceInstalls = vi.fn();
const mockUpdateUsage = vi.fn().mockReturnThis();
const mockSetUsage = vi.fn().mockReturnThis();
const mockWhereUsage = vi.fn().mockResolvedValue(undefined);
const mockInsertUsage = vi.fn().mockReturnThis();
const mockValuesUsage = vi.fn().mockResolvedValue(undefined);

vi.mock("../../db/index.js", () => ({
  db: {
    query: {
      serviceCredentials: { findFirst: (...args: any[]) => mockFindFirstServiceCreds(...args) },
      marketplaceServices: { findFirst: (...args: any[]) => mockFindFirstService(...args) },
      deployments: { findFirst: (...args: any[]) => mockFindFirstDeployments(...args) },
      serviceUsage: { findFirst: (...args: any[]) => mockFindFirstServiceUsage(...args) },
      serviceInstalls: { findFirst: (...args: any[]) => mockFindFirstServiceInstalls(...args) },
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
    serviceCredentials: { deploymentId: "deploymentId", packageId: "packageId" },
    marketplaceServices: { id: "id" },
    deployments: { id: "id", userId: "userId" },
    serviceUsage: {
      id: "id",
      deploymentId: "deploymentId",
      packageId: "packageId",
      skillName: "skillName",
      billingCycleStart: "billingCycleStart",
      requestCount: "requestCount",
    },
    serviceInstalls: { deploymentId: "deploymentId", packageId: "packageId" },
  },
}));

// Auth mock
const mockVerifyToken = vi.fn();
const mockGetUserFromToken = vi.fn();
vi.mock("../../services/auth.js", () => ({
  verifyToken: (...args: any[]) => mockVerifyToken(...args),
  getUserFromToken: (...args: any[]) => mockGetUserFromToken(...args),
}));

// K8s exec mock
const mockFindPodForDeployment = vi.fn();
const mockExecInPod = vi.fn();
vi.mock("../../k8s/exec.js", () => ({
  findPodForDeployment: (...args: any[]) => mockFindPodForDeployment(...args),
  execInPod: (...args: any[]) => mockExecInPod(...args),
}));

// K8s client mock (for readGatewayTokenFromK8s)
const mockReadNamespacedSecret = vi.fn();
vi.mock("../../k8s/client.js", () => ({
  coreApi: {
    readNamespacedSecret: (...args: any[]) => mockReadNamespacedSecret(...args),
  },
}));

// K8s constants mock
vi.mock("../../k8s/constants.js", () => ({
  NAMESPACE: "jarble",
}));

// K8s status mock (not directly used, but may be imported transitively)
vi.mock("../../k8s/status.js", () => ({}));

// Logger mock - suppress output
vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { resetAllServiceRateLimits } from "../../middleware/serviceRateLimit.js";
import { resetAllCircuits } from "../../services/circuitBreaker.js";
import { serviceExecutionRouter } from "../serviceExecution.js";

// ── Test server setup ────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/services", serviceExecutionRouter);
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

const TEST_GATEWAY_TOKEN = "test-gateway-token-xyz";

/** Build a valid ServiceCard JSON string for handler mode. */
function buildServiceCard(overrides?: {
  skills?: Array<{
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    executionMode?: "handler" | "agent";
    handlerCode?: string;
  }>;
  creatorDeploymentId?: string;
  rateLimits?: { requestsPerMinute?: number; requestsPerDay?: number };
  timeoutMs?: number;
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
      executionMode: "handler",
      handlerCode: "return { temperature: 72, unit: 'F' };",
    },
  ];

  return JSON.stringify({
    auth: { type: "api_key", headerName: "X-API-Key" },
    skills,
    version: "1.0.0",
    creatorDeploymentId: overrides?.creatorDeploymentId ?? "creator-dep-001",
    rateLimits: overrides?.rateLimits,
    timeoutMs: overrides?.timeoutMs,
  });
}

/** Configure mocks for a fully valid execution request (handler mode). */
function setupValidMocks(overrides?: Parameters<typeof buildServiceCard>[0]) {
  mockFindFirstServiceCreds.mockResolvedValue({
    id: "pkc_001",
    deploymentId: "dep-001",
    packageId: "svc-001",
  });

  mockFindFirstService.mockResolvedValue({
    id: "svc-001",
    remoteApiConfig: buildServiceCard(overrides),
  });

  // Creator pod is available
  mockFindPodForDeployment.mockResolvedValue("creator-pod-abc123");

  // Default: execInPod returns a valid JSON handler result
  mockExecInPod.mockResolvedValue(
    JSON.stringify({ ok: true, result: { temperature: 72, unit: "F" } }),
  );
}

/** Make a POST to /api/services/execute/... with standard headers. */
function executeRequest(
  skillName: string = "get_weather",
  body: Record<string, unknown> = { location: "NYC" },
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(`${baseUrl}/api/services/execute/svc-001/${skillName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Deployment-Id": "dep-001",
      "X-Gateway-Token": TEST_GATEWAY_TOKEN,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe("Service Execution Route", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    resetAllServiceRateLimits();
    resetAllCircuits();

    // Default: gateway token auth passes for dep-001
    mockFindFirstDeployments.mockResolvedValue({
      id: "dep-001",
      userId: "user-1",
      gatewayToken: TEST_GATEWAY_TOKEN,
    });

    // Default: K8s secret read fails (simulates dev/test mode) → falls back to DB
    mockReadNamespacedSecret.mockRejectedValue(new Error("K8s not available"));

    baseUrl = await startServer(createTestApp());
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  // ── 1. Authentication ───────────────────────────────────────────────────

  describe("authentication", () => {
    it("returns 400 when X-Deployment-Id header is missing", async () => {
      const res = await fetch(`${baseUrl}/api/services/execute/svc-001/get_weather`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Missing X-Deployment-Id");
    });

    it("returns 401 when no auth credentials are provided", async () => {
      const res = await fetch(`${baseUrl}/api/services/execute/svc-001/get_weather`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Deployment-Id": "dep-001",
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(401);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Unauthorized");
    });

    it("returns 401 when bearer JWT is invalid", async () => {
      mockVerifyToken.mockRejectedValue(new Error("Invalid JWT"));

      const res = await fetch(`${baseUrl}/api/services/execute/svc-001/get_weather`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Deployment-Id": "dep-001",
          Authorization: "Bearer invalid-token-here",
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(401);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid token");
    });

    it("returns 403 when valid JWT but user does not own deployment", async () => {
      mockVerifyToken.mockResolvedValue({ sub: "auth0|other-user" });
      mockGetUserFromToken.mockResolvedValue({ id: "other-user-id" });
      mockFindFirstDeployments.mockResolvedValue({
        id: "dep-001",
        userId: "different-user-id", // different from auth user
      });

      const res = await fetch(`${baseUrl}/api/services/execute/svc-001/get_weather`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Deployment-Id": "dep-001",
          Authorization: "Bearer valid-jwt-token",
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(403);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Forbidden");
    });

    it("proceeds with valid JWT and correct deployment ownership", async () => {
      mockVerifyToken.mockResolvedValue({ sub: "auth0|test-user" });
      mockGetUserFromToken.mockResolvedValue({ id: "user-1" });
      mockFindFirstDeployments.mockResolvedValue({
        id: "dep-001",
        userId: "user-1",
      });
      setupValidMocks();

      const res = await fetch(`${baseUrl}/api/services/execute/svc-001/get_weather`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Deployment-Id": "dep-001",
          Authorization: "Bearer valid-jwt-token",
        },
        body: JSON.stringify({ location: "NYC" }),
      });

      expect(res.status).toBe(200);
    });

    it("proceeds with valid gateway token", async () => {
      setupValidMocks();

      const res = await executeRequest();

      expect(res.status).toBe(200);
    });
  });

  // ── 2. Credential & Service Lookup ──────────────────────────────────────

  describe("credential and service lookup", () => {
    it("returns 404 when serviceCredentials not found", async () => {
      mockFindFirstServiceCreds.mockResolvedValue(null);

      const res = await executeRequest();

      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("credentials not found");
    });

    it("returns 404 when service not found", async () => {
      mockFindFirstServiceCreds.mockResolvedValue({
        id: "pkc_001",
        deploymentId: "dep-001",
        packageId: "svc-001",
      });
      mockFindFirstService.mockResolvedValue(null);

      const res = await executeRequest();

      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Service not found");
    });

    it("returns 404 when service has no remoteApiConfig", async () => {
      mockFindFirstServiceCreds.mockResolvedValue({
        id: "pkc_001",
        deploymentId: "dep-001",
        packageId: "svc-001",
      });
      mockFindFirstService.mockResolvedValue({
        id: "svc-001",
        remoteApiConfig: null,
      });

      const res = await executeRequest();

      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("no remote API configuration");
    });

    it("returns 502 when remoteApiConfig is invalid JSON", async () => {
      mockFindFirstServiceCreds.mockResolvedValue({
        id: "pkc_001",
        deploymentId: "dep-001",
        packageId: "svc-001",
      });
      mockFindFirstService.mockResolvedValue({
        id: "svc-001",
        remoteApiConfig: "not valid json {{{",
      });

      const res = await executeRequest();

      expect(res.status).toBe(502);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Malformed service card");
    });
  });

  // ── 3. Skill Matching ──────────────────────────────────────────────────

  describe("skill matching", () => {
    it("returns 404 when skill not found in ServiceCard", async () => {
      setupValidMocks();

      const res = await executeRequest("nonexistent_skill");

      expect(res.status).toBe(404);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("nonexistent_skill");
      expect(data.error).toContain("not found");
    });

    it("proceeds when skill is found in ServiceCard", async () => {
      setupValidMocks();

      const res = await executeRequest("get_weather", { location: "NYC" });

      expect(res.status).toBe(200);
    });
  });

  // ── 4. Rate Limiting ──────────────────────────────────────────────────

  describe("rate limiting", () => {
    it("returns 429 with Retry-After when rate limit exceeded", async () => {
      // Service with a strict 2/min limit
      setupValidMocks({ rateLimits: { requestsPerMinute: 2 } });

      // First 2 should succeed
      for (let i = 0; i < 2; i++) {
        const res = await executeRequest();
        expect(res.status).toBe(200);
      }

      // 3rd should be rate limited
      const res = await executeRequest();

      expect(res.status).toBe(429);
      expect(res.headers.get("Retry-After")).toBeDefined();
      const data = (await res.json()) as { error: string; retryAfterSeconds: number };
      expect(data.error).toContain("Rate limit exceeded");
      expect(data.retryAfterSeconds).toBeGreaterThan(0);
    });

    it("succeeds when under the rate limit", async () => {
      setupValidMocks({ rateLimits: { requestsPerMinute: 100 } });

      const res = await executeRequest();

      expect(res.status).toBe(200);
    });
  });

  // ── 5. Circuit Breaker ────────────────────────────────────────────────

  describe("circuit breaker", () => {
    it("returns 503 when circuit is open after consecutive failures", async () => {
      setupValidMocks();

      // Make execInPod fail consistently to trip the circuit breaker
      // FAILURE_THRESHOLD = 5
      mockExecInPod.mockResolvedValue(
        JSON.stringify({ ok: false, error: "handler crashed" }),
      );

      for (let i = 0; i < 5; i++) {
        await executeRequest();
      }

      // 6th request should be blocked by open circuit
      const res = await executeRequest();

      expect(res.status).toBe(503);
      expect(res.headers.get("Retry-After")).toBeDefined();
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("circuit breaker");
    });

    it("proceeds when circuit is closed", async () => {
      setupValidMocks();

      const res = await executeRequest();

      expect(res.status).toBe(200);
    });
  });

  // ── 6. Input Validation ───────────────────────────────────────────────

  describe("input schema validation", () => {
    it("returns 400 when required field is missing from body", async () => {
      setupValidMocks();

      // Skill requires "location" but we send empty body
      const res = await executeRequest("get_weather", {});

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string; details: string[] };
      expect(data.error).toContain("Input validation failed");
      expect(data.details).toEqual(
        expect.arrayContaining([expect.stringContaining("location")]),
      );
    });

    it("proceeds when input matches schema", async () => {
      setupValidMocks();

      const res = await executeRequest("get_weather", { location: "NYC" });

      expect(res.status).toBe(200);
    });
  });

  // ── 7. Handler Mode Execution ─────────────────────────────────────────

  describe("handler mode execution", () => {
    it("returns 502 when skill has no handlerCode", async () => {
      setupValidMocks({
        skills: [
          {
            name: "no_handler",
            description: "Skill with no handler",
            inputSchema: { type: "object", properties: {} },
            executionMode: "handler",
            // handlerCode intentionally omitted
          },
        ],
      });

      const res = await executeRequest("no_handler", {});

      expect(res.status).toBe(502);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("no handler code");
    });

    it("returns 502 when service has no creatorDeploymentId", async () => {
      setupValidMocks({
        creatorDeploymentId: undefined,
        skills: [
          {
            name: "get_weather",
            description: "Get weather",
            inputSchema: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
            executionMode: "handler",
            handlerCode: "return { temp: 72 };",
          },
        ],
      });

      // Override the service card to explicitly remove creatorDeploymentId
      mockFindFirstService.mockResolvedValue({
        id: "svc-001",
        remoteApiConfig: JSON.stringify({
          auth: { type: "api_key", headerName: "X-API-Key" },
          skills: [
            {
              name: "get_weather",
              description: "Get weather",
              inputSchema: { type: "object", properties: { location: { type: "string" } }, required: ["location"] },
              executionMode: "handler",
              handlerCode: "return { temp: 72 };",
            },
          ],
          version: "1.0.0",
          // No creatorDeploymentId
        }),
      });

      const res = await executeRequest("get_weather", { location: "NYC" });

      expect(res.status).toBe(502);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("no creator deployment");
    });

    it("returns 503 when creator pod is not found (null)", async () => {
      setupValidMocks();
      mockFindPodForDeployment.mockResolvedValue(null);

      const res = await executeRequest();

      expect(res.status).toBe(503);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Creator pod not available");
    });

    it("returns 503 when findPodForDeployment throws", async () => {
      setupValidMocks();
      mockFindPodForDeployment.mockRejectedValue(new Error("K8s API error"));

      const res = await executeRequest();

      expect(res.status).toBe(503);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Failed to locate creator pod");
    });

    it("returns 500 when handler returns ok:false with error message", async () => {
      setupValidMocks();
      mockExecInPod.mockResolvedValue(
        JSON.stringify({ ok: false, error: "Cannot read property 'foo' of undefined" }),
      );

      const res = await executeRequest();

      expect(res.status).toBe(500);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Cannot read property");
    });

    it("returns 500 when handler output is not valid JSON", async () => {
      setupValidMocks();
      mockExecInPod.mockResolvedValue("this is not json at all");

      const res = await executeRequest();

      expect(res.status).toBe(500);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("invalid JSON output");
    });

    it("returns 504 when handler execution times out", async () => {
      setupValidMocks({ timeoutMs: 50 }); // very short timeout

      // Mock execInPod to never resolve (simulate hung handler)
      mockExecInPod.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000, "too late")),
      );

      const res = await executeRequest();

      expect(res.status).toBe(504);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("timed out");
    });

    it("returns 200 with valid handler result", async () => {
      setupValidMocks();

      const res = await executeRequest();

      expect(res.status).toBe(200);
      const data = (await res.json()) as { temperature: number; unit: string };
      expect(data.temperature).toBe(72);
      expect(data.unit).toBe("F");
    });

    it("returns 502 when execInPod throws a non-timeout error", async () => {
      setupValidMocks();
      mockExecInPod.mockRejectedValue(new Error("ECONNREFUSED"));

      const res = await executeRequest();

      expect(res.status).toBe(502);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Skill execution failed");
    });
  });

  // ── 8. Agent Mode ─────────────────────────────────────────────────────

  describe("agent mode execution", () => {
    it("returns 501 for agent mode (not yet implemented)", async () => {
      setupValidMocks({
        skills: [
          {
            name: "ask_agent",
            description: "Ask the agent",
            inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] },
            executionMode: "agent",
            handlerCode: "return {};", // agent mode ignores this
          },
        ],
      });

      const res = await executeRequest("ask_agent", { question: "What is the weather?" });

      expect(res.status).toBe(501);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Agent mode not yet implemented");
    });
  });

  // ── 9. Output Schema Validation ───────────────────────────────────────

  describe("output schema validation", () => {
    it("does not add X-Jarble-Schema-Warning when output matches schema", async () => {
      setupValidMocks({
        skills: [
          {
            name: "get_weather",
            description: "Get weather",
            inputSchema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
            outputSchema: {
              type: "object",
              properties: {
                temperature: { type: "number" },
              },
              required: ["temperature"],
            },
            executionMode: "handler",
            handlerCode: "return { temperature: 72 };",
          },
        ],
      });

      mockExecInPod.mockResolvedValue(
        JSON.stringify({ ok: true, result: { temperature: 72 } }),
      );

      const res = await executeRequest();

      expect(res.status).toBe(200);
      expect(res.headers.get("X-Jarble-Schema-Warning")).toBeNull();
    });

    it("adds X-Jarble-Schema-Warning when output does not match schema", async () => {
      setupValidMocks({
        skills: [
          {
            name: "get_weather",
            description: "Get weather",
            inputSchema: {
              type: "object",
              properties: { location: { type: "string" } },
              required: ["location"],
            },
            outputSchema: {
              type: "object",
              properties: {
                temperature: { type: "number" },
                unit: { type: "string" },
              },
              required: ["temperature", "unit"],
            },
            executionMode: "handler",
            handlerCode: "return { temperature: 72 };",
          },
        ],
      });

      // Handler returns result missing "unit" field
      mockExecInPod.mockResolvedValue(
        JSON.stringify({ ok: true, result: { temperature: 72 } }),
      );

      const res = await executeRequest();

      // Still 200 - output schema validation is warn-only
      expect(res.status).toBe(200);
      expect(res.headers.get("X-Jarble-Schema-Warning")).toBe("output schema mismatch");
    });
  });

  // ── 10. Request ID Tracing ────────────────────────────────────────────

  describe("request ID tracing", () => {
    it("returns X-Request-Id header on all responses", async () => {
      setupValidMocks();

      const res = await executeRequest();

      expect(res.headers.get("X-Request-Id")).toBeDefined();
      expect(res.headers.get("X-Request-Id")!.length).toBeGreaterThan(0);
    });

    it("echoes provided X-Request-Id back", async () => {
      setupValidMocks();

      const res = await fetch(`${baseUrl}/api/services/execute/svc-001/get_weather`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Deployment-Id": "dep-001",
          "X-Gateway-Token": TEST_GATEWAY_TOKEN,
          "X-Request-Id": "custom-trace-id-123",
        },
        body: JSON.stringify({ location: "NYC" }),
      });

      expect(res.headers.get("X-Request-Id")).toBe("custom-trace-id-123");
    });
  });

  // ── 11. Gateway Token Auth Edge Cases ─────────────────────────────────

  describe("gateway token auth", () => {
    it("returns 401 when deployment not found for gateway token auth", async () => {
      mockFindFirstDeployments.mockResolvedValue(null);

      const res = await fetch(`${baseUrl}/api/services/execute/svc-001/get_weather`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Deployment-Id": "dep-nonexistent",
          "X-Gateway-Token": "some-token",
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(401);
    });

    it("returns 401 when gateway token does not match expected token", async () => {
      mockFindFirstDeployments.mockResolvedValue({
        id: "dep-001",
        userId: "user-1",
        gatewayToken: "correct-token",
      });

      const res = await fetch(`${baseUrl}/api/services/execute/svc-001/get_weather`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Deployment-Id": "dep-001",
          "X-Gateway-Token": "wrong-token",
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(401);
    });

    it("accepts request when K8s token matches", async () => {
      // Simulate K8s secret containing the token
      mockReadNamespacedSecret.mockResolvedValue({
        body: {
          data: {
            OPENCLAW_GATEWAY_TOKEN: Buffer.from("k8s-secret-token").toString("base64"),
          },
        },
      });
      setupValidMocks();

      const res = await fetch(`${baseUrl}/api/services/execute/svc-001/get_weather`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Deployment-Id": "dep-001",
          "X-Gateway-Token": "k8s-secret-token",
        },
        body: JSON.stringify({ location: "NYC" }),
      });

      expect(res.status).toBe(200);
    });
  });

  // ── 12. Usage Recording ───────────────────────────────────────────────

  describe("usage recording (fire-and-forget)", () => {
    it("inserts new usage record after successful execution", async () => {
      setupValidMocks();
      mockFindFirstServiceUsage.mockResolvedValue(null);
      mockFindFirstServiceInstalls.mockResolvedValue({
        id: "pki_001",
        deploymentId: "dep-001",
        packageId: "svc-001",
      });

      const res = await executeRequest();
      expect(res.status).toBe(200);

      // recordUsage is fire-and-forget, give it a moment
      await new Promise((r) => setTimeout(r, 50));

      expect(mockInsertUsage).toHaveBeenCalled();
      expect(mockValuesUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          packageInstallId: "pki_001",
          deploymentId: "dep-001",
          packageId: "svc-001",
          skillName: "get_weather",
          requestCount: 1,
        }),
      );
    });

    it("increments existing usage record for current billing cycle", async () => {
      setupValidMocks();
      mockFindFirstServiceUsage.mockResolvedValue({
        id: "pu_existing",
        requestCount: 42,
        billingCycleStart: "2026-03-01",
      });

      const res = await executeRequest();
      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 50));

      expect(mockUpdateUsage).toHaveBeenCalled();
      expect(mockSetUsage).toHaveBeenCalled();
    });
  });

  // ── 13. ServiceCard Validation ────────────────────────────────────────

  describe("ServiceCard validation", () => {
    it("returns 502 when ServiceCard fails Zod validation", async () => {
      mockFindFirstServiceCreds.mockResolvedValue({
        id: "pkc_001",
        deploymentId: "dep-001",
        packageId: "svc-001",
      });

      // Valid JSON but fails ServiceCard schema (missing required fields)
      mockFindFirstService.mockResolvedValue({
        id: "svc-001",
        remoteApiConfig: JSON.stringify({
          // Missing: auth, skills, version
          endpoint: "https://example.com",
        }),
      });

      const res = await executeRequest();

      expect(res.status).toBe(502);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid service card");
    });
  });

  // ── 14. Timeout Configuration ─────────────────────────────────────────

  describe("timeout configuration", () => {
    it("uses custom timeout from ServiceCard when provided", async () => {
      // Use a very short timeout so we can test it triggers
      setupValidMocks({ timeoutMs: 100 });

      // Mock execInPod to hang
      mockExecInPod.mockImplementation(
        () => new Promise((resolve) => setTimeout(resolve, 5000, "late")),
      );

      const res = await executeRequest();

      expect(res.status).toBe(504);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("timed out");
    });
  });
});
