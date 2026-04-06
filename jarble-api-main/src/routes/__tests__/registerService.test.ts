/**
 * Integration tests for the register-service Pod API endpoint.
 *
 * Tests the Express route handler at POST /api/pod/marketplace/register-service
 * by mounting the podApiRouter on a temporary Express server and using Node's
 * built-in fetch. All external dependencies (DB, K8s, logger, encryption, etc.)
 * are mocked.
 *
 * The register-service endpoint is called by the MCP `register_service` tool
 * running inside bot pods. It validates input, auto-generates a ServiceCard,
 * and inserts a platform_managed service into the marketplace.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import http from "http";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Track DB insert calls
const mockInsertValues = vi.fn().mockResolvedValue(undefined);
const mockInsert = vi.fn().mockReturnValue({ values: mockInsertValues });

// Deployment lookup for authenticatePod middleware
const mockFindFirstDeployments = vi.fn();

vi.mock("../../db/index.js", () => ({
  db: {
    query: {
      deployments: {
        findFirst: (...args: any[]) => mockFindFirstDeployments(...args),
      },
      // Other query namespaces required by podApi routes we're not testing
      marketplaceComponents: { findMany: vi.fn().mockResolvedValue([]) },
      marketplaceServices: { findMany: vi.fn().mockResolvedValue([]) },
      componentInstalls: { findMany: vi.fn().mockResolvedValue([]) },
      serviceInstalls: { findMany: vi.fn().mockResolvedValue([]) },
      creatorProfiles: {
        findFirst: vi.fn().mockResolvedValue({ id: "cp_test001", userId: "test-user-001" }),
      },
    },
    insert: (...args: any[]) => mockInsert(...args),
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockResolvedValue([]),
  },
  tables: {
    deployments: { id: "id", userId: "userId" },
    marketplaceServices: { id: "id", name: "name", creatorId: "creatorId" },
    marketplaceComponents: { id: "id", status: "status" },
    componentInstalls: { deploymentId: "deploymentId" },
    serviceInstalls: { deploymentId: "deploymentId" },
    serviceComponents: {},
    serviceSkills: {},
    serviceCredentials: {},
    componentVersions: {},
    skillsCatalog: {},
    deploymentSkills: {},
    creatorProfiles: { id: "id", userId: "userId" },
  },
  dbDate: (d?: Date) => (d ?? new Date()).toISOString(),
}));

// Env mock - prevent Zod parse of process.env (DATABASE_URL is required)
vi.mock("../../utils/env.js", () => ({
  env: {
    NODE_ENV: "test",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
    FRONTEND_URL: "http://localhost:3000",
    DATABASE_URL: "postgres://test",
    OPENROUTER_API_KEY: "sk-test",
    ADMIN_USER_IDS: "",
  },
}));

// K8s - not available in test mode
vi.mock("../../k8s/client.js", () => {
  throw new Error("K8s not available");
});
vi.mock("../../k8s/constants.js", () => {
  throw new Error("K8s not available");
});

// ConfigSync - no-op
vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
}));

// Encryption - no-op
vi.mock("../../utils/encryption.js", () => ({
  encryptApiKey: vi.fn((v: string) => `enc:${v}`),
  decryptApiKey: vi.fn((v: string) => v.replace(/^enc:/, "")),
}));

// HMAC - no-op
vi.mock("../../utils/hmac.js", () => ({
  generateSigningSecret: vi.fn(() => "mock-signing-secret"),
}));

// Service handshake - no-op
vi.mock("../../services/serviceHandshake.js", () => ({
  performInstallHandshake: vi.fn().mockResolvedValue(undefined),
}));

// Logger - suppress output
vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { podApiRouter } from "../podApi.js";

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

// ── Helpers ──────────────────────────────────────────────────────────────────

const TEST_DEPLOYMENT_ID = "dep-test-001";
const TEST_USER_ID = "user-test-001";
const TEST_GATEWAY_TOKEN = "test-gateway-token";

const AUTH_HEADERS = {
  "Content-Type": "application/json",
  "X-Deployment-Id": TEST_DEPLOYMENT_ID,
  "X-Gateway-Token": TEST_GATEWAY_TOKEN,
};

/** A valid skill payload for register-service */
function validSkill(overrides?: Partial<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  mode: string;
  handlerCode: string;
  outputSchema: Record<string, unknown>;
}>) {
  return {
    name: "get-weather",
    description: "Get current weather for a location",
    inputSchema: {
      type: "object",
      properties: { location: { type: "string" } },
      required: ["location"],
    },
    mode: "handler",
    handlerCode: "async function handler(input) { return { temp: 72 }; }",
    ...overrides,
  };
}

/** A valid register-service request body */
function validBody(overrides?: Record<string, unknown>) {
  return {
    name: "my-weather-service",
    displayName: "My Weather Service",
    description: "Provides weather data for any location",
    skills: [validSkill()],
    ...overrides,
  };
}

/** POST to the register-service endpoint */
async function registerService(body: unknown) {
  return fetch(`${baseUrl}/api/pod/marketplace/register-service`, {
    method: "POST",
    headers: AUTH_HEADERS,
    body: JSON.stringify(body),
  });
}

// ── Suite ────────────────────────────────────────────────────────────────────

describe("POST /api/pod/marketplace/register-service", () => {
  beforeEach(async () => {
    vi.clearAllMocks();

    // Default: pod authentication passes
    mockFindFirstDeployments.mockResolvedValue({
      id: TEST_DEPLOYMENT_ID,
      userId: TEST_USER_ID,
      status: "running",
    });

    // Default: DB insert succeeds
    mockInsertValues.mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockInsertValues });

    baseUrl = await startServer(createTestApp());
  });

  afterEach(() => {
    return new Promise<void>((resolve) => {
      server?.close(() => resolve());
    });
  });

  // ── Name validation (5 tests) ──────────────────────────────────────────────

  describe("name validation", () => {
    it("accepts a valid lowercase-hyphenated name", async () => {
      const res = await registerService(validBody({ name: "my-weather-service" }));

      expect(res.status).toBe(200);
      const data = (await res.json()) as { success: boolean; id: string; status: string };
      expect(data.success).toBe(true);
      expect(data.id).toMatch(/^pkg_/);
      expect(data.status).toBe("published");
    });

    it("rejects a name with uppercase letters", async () => {
      const res = await registerService(validBody({ name: "My-Weather-Service" }));

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid name");
    });

    it("rejects a name starting with a digit", async () => {
      const res = await registerService(validBody({ name: "1weather" }));

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid name");
      expect(data.error).toContain("lowercase letter");
    });

    it("rejects a name with special characters", async () => {
      const res = await registerService(validBody({ name: "weather_service!" }));

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid name");
    });

    it("rejects a name longer than 64 characters", async () => {
      // The regex is /^[a-z][a-z0-9-]{0,63}$/ which means total max is 64
      const longName = "a" + "b".repeat(64); // 65 chars total
      const res = await registerService(validBody({ name: longName }));

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Invalid name");
    });
  });

  // ── Skills validation (5 tests) ────────────────────────────────────────────

  describe("skills validation", () => {
    it("rejects an empty skills array", async () => {
      const res = await registerService(validBody({ skills: [] }));

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("At least one skill");
    });

    it("rejects a skill missing a name", async () => {
      const skill = validSkill();
      delete (skill as any).name;

      const res = await registerService(validBody({ skills: [skill] }));

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("(unnamed)");
      expect(data.error).toContain("missing required fields");
    });

    it("rejects a skill missing a description", async () => {
      const skill = validSkill();
      delete (skill as any).description;

      const res = await registerService(validBody({ skills: [skill] }));

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("missing required fields");
    });

    it("rejects a skill missing an inputSchema", async () => {
      const skill = validSkill();
      delete (skill as any).inputSchema;

      const res = await registerService(validBody({ skills: [skill] }));

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("missing required fields");
    });

    it("rejects a handler-mode skill without handlerCode", async () => {
      const skill = validSkill({ mode: "handler" });
      delete (skill as any).handlerCode;

      const res = await registerService(validBody({ skills: [skill] }));

      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("handler");
      expect(data.error).toContain("no handlerCode");
    });
  });

  // ── ServiceCard auto-generation (5 tests) ──────────────────────────────────

  describe("ServiceCard auto-generation", () => {
    it("inserts with hostingModel 'platform_managed'", async () => {
      await registerService(validBody());

      expect(mockInsertValues).toHaveBeenCalledTimes(1);
      const insertedRow = mockInsertValues.mock.calls[0][0];
      expect(insertedRow.hostingModel).toBe("platform_managed");
    });

    it("inserts with status 'published' (auto-approved)", async () => {
      await registerService(validBody());

      const insertedRow = mockInsertValues.mock.calls[0][0];
      expect(insertedRow.status).toBe("published");
    });

    it("stores a valid JSON ServiceCard in remoteApiConfig", async () => {
      await registerService(validBody());

      const insertedRow = mockInsertValues.mock.calls[0][0];
      const serviceCard = JSON.parse(insertedRow.remoteApiConfig);

      expect(serviceCard).toHaveProperty("auth");
      expect(serviceCard.auth.type).toBe("api_key");
      expect(serviceCard).toHaveProperty("skills");
      expect(serviceCard).toHaveProperty("version", "1.0.0");
      expect(serviceCard).toHaveProperty("rateLimits");
      expect(serviceCard.rateLimits.requestsPerMinute).toBe(60);
    });

    it("ServiceCard contains creatorDeploymentId matching the authenticated deployment", async () => {
      await registerService(validBody());

      const insertedRow = mockInsertValues.mock.calls[0][0];
      const serviceCard = JSON.parse(insertedRow.remoteApiConfig);

      expect(serviceCard.creatorDeploymentId).toBe(TEST_DEPLOYMENT_ID);
    });

    it("ServiceCard skills match input skills with correct structure", async () => {
      const skills = [
        validSkill({ name: "get-weather", description: "Get weather" }),
        validSkill({
          name: "get-forecast",
          description: "Get 5-day forecast",
          mode: "handler",
          handlerCode: "async function handler(input) { return []; }",
          outputSchema: { type: "array", items: { type: "object" } },
        }),
      ];

      await registerService(validBody({ skills }));

      const insertedRow = mockInsertValues.mock.calls[0][0];
      const serviceCard = JSON.parse(insertedRow.remoteApiConfig);

      expect(serviceCard.skills).toHaveLength(2);
      expect(serviceCard.skills[0].name).toBe("get-weather");
      expect(serviceCard.skills[0].executionMode).toBe("handler");
      expect(serviceCard.skills[0].handlerCode).toBeDefined();

      expect(serviceCard.skills[1].name).toBe("get-forecast");
      expect(serviceCard.skills[1].outputSchema).toBeDefined();
      expect(serviceCard.skills[1].outputSchema.type).toBe("array");
    });
  });

  // ── Edge cases (5 tests) ───────────────────────────────────────────────────

  describe("edge cases", () => {
    it("rejects when required fields (name, displayName, description) are missing", async () => {
      // Missing name
      const res1 = await registerService({
        displayName: "Weather",
        description: "Desc",
        skills: [validSkill()],
      });
      expect(res1.status).toBe(400);
      const data1 = (await res1.json()) as { error: string };
      expect(data1.error).toContain("Missing required fields");

      // Missing displayName
      const res2 = await registerService({
        name: "weather",
        description: "Desc",
        skills: [validSkill()],
      });
      expect(res2.status).toBe(400);
      const data2 = (await res2.json()) as { error: string };
      expect(data2.error).toContain("Missing required fields");

      // Missing description
      const res3 = await registerService({
        name: "weather",
        displayName: "Weather",
        skills: [validSkill()],
      });
      expect(res3.status).toBe(400);
      const data3 = (await res3.json()) as { error: string };
      expect(data3.error).toContain("Missing required fields");
    });

    it("accepts multiple skills with a mix of handler and agent modes", async () => {
      const skills = [
        validSkill({ name: "handler-skill", mode: "handler", handlerCode: "function h() {}" }),
        validSkill({ name: "agent-skill", mode: "agent" }),
      ];

      // Agent mode skill does not need handlerCode - remove it to verify
      delete (skills[1] as any).handlerCode;

      const res = await registerService(validBody({ skills }));

      expect(res.status).toBe(200);
      const data = (await res.json()) as { success: boolean; skillCount: number };
      expect(data.success).toBe(true);
      expect(data.skillCount).toBe(2);
    });

    it("accepts an agent-mode skill without handlerCode", async () => {
      const skill = validSkill({ mode: "agent" });
      delete (skill as any).handlerCode;

      const res = await registerService(validBody({ skills: [skill] }));

      expect(res.status).toBe(200);
      const data = (await res.json()) as { success: boolean };
      expect(data.success).toBe(true);

      // Verify the ServiceCard skill has executionMode "agent" and no handlerCode
      const insertedRow = mockInsertValues.mock.calls[0][0];
      const serviceCard = JSON.parse(insertedRow.remoteApiConfig);
      expect(serviceCard.skills[0].executionMode).toBe("agent");
      expect(serviceCard.skills[0].handlerCode).toBeUndefined();
    });

    it("accepts a very long description without rejecting", async () => {
      const longDesc = "A".repeat(10000);
      const res = await registerService(validBody({ description: longDesc }));

      expect(res.status).toBe(200);
      const insertedRow = mockInsertValues.mock.calls[0][0];
      expect(insertedRow.description).toBe(longDesc);
    });

    it("derives creatorId from deployment userId, not from request body", async () => {
      // Even if the request body supplies a different creatorId, the endpoint
      // should use the resolved creator profile ID (not the raw userId or attacker value).
      const res = await registerService(
        validBody({ creatorId: "attacker-user-id" }),
      );

      expect(res.status).toBe(200);
      const insertedRow = mockInsertValues.mock.calls[0][0];
      // creatorId is now resolved via resolveCreatorId → creator_profiles.id
      expect(insertedRow.creatorId).toBe("cp_test001");
      expect(insertedRow.creatorId).not.toBe("attacker-user-id");
    });
  });
});
