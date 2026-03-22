/**
 * ServiceCard Zod schema validation tests.
 *
 * Tests the complete ServiceCard schema including skills, auth,
 * rate limits, URL validation, and edge cases.
 */
import { describe, it, expect, afterEach } from "vitest";
import {
  serviceCardSchema,
  serviceCardSkillSchema,
  serviceCardAuthSchema,
  serviceCardRateLimitsSchema,
} from "../serviceCard.js";

// ── Helper: minimal valid ServiceCard ────────────────────────────────────────

function validCard(overrides?: Record<string, unknown>) {
  return {
    endpoint: "https://api.creator.com/v1",
    auth: { type: "api_key" as const },
    skills: [
      {
        name: "get_weather",
        description: "Get current weather for a location",
        inputSchema: { type: "object" as const, properties: { city: { type: "string" } } },
      },
    ],
    version: "1.0.0",
    ...overrides,
  };
}

describe("serviceCardSchema", () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => { process.env.NODE_ENV = originalEnv; });

  // ── Happy path ────────────────────────────────────────────────────────────

  describe("valid ServiceCards", () => {
    it("parses a minimal valid card", () => {
      const result = serviceCardSchema.safeParse(validCard());
      expect(result.success).toBe(true);
    });

    it("parses a card with all optional fields", () => {
      const result = serviceCardSchema.safeParse(validCard({
        healthEndpoint: "https://api.creator.com/health",
        rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
        timeoutMs: 30000,
      }));
      expect(result.success).toBe(true);
    });

    it("applies default headerName for api_key auth", () => {
      const result = serviceCardSchema.parse(validCard());
      expect(result.auth.type).toBe("api_key");
      if (result.auth.type === "api_key") {
        expect(result.auth.headerName).toBe("X-API-Key");
      }
    });

    it("applies default headerName for bearer auth", () => {
      const result = serviceCardSchema.parse(validCard({
        auth: { type: "bearer" },
      }));
      if (result.auth.type === "bearer") {
        expect(result.auth.headerName).toBe("Authorization");
      }
    });

    it("applies default empty scopes for oauth2", () => {
      const result = serviceCardSchema.parse(validCard({
        auth: {
          type: "oauth2_client_credentials",
          tokenEndpoint: "https://auth.creator.com/token",
        },
      }));
      if (result.auth.type === "oauth2_client_credentials") {
        expect(result.auth.scopes).toEqual([]);
      }
    });
  });

  // ── Missing required fields ────────────────────────────────────────────────

  describe("missing required fields", () => {
    it("accepts missing endpoint (optional for platform-managed services)", () => {
      const { endpoint, ...rest } = validCard();
      const result = serviceCardSchema.safeParse(rest);
      expect(result.success).toBe(true);
    });

    it("rejects missing auth", () => {
      const { auth, ...rest } = validCard();
      const result = serviceCardSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing skills", () => {
      const { skills, ...rest } = validCard();
      const result = serviceCardSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });

    it("rejects missing version", () => {
      const { version, ...rest } = validCard();
      const result = serviceCardSchema.safeParse(rest);
      expect(result.success).toBe(false);
    });
  });

  // ── Endpoint validation ────────────────────────────────────────────────────

  describe("endpoint validation", () => {
    it("rejects non-URL endpoint", () => {
      const result = serviceCardSchema.safeParse(validCard({ endpoint: "not-a-url" }));
      expect(result.success).toBe(false);
    });

    it("rejects private IP endpoint (10.x)", () => {
      const result = serviceCardSchema.safeParse(validCard({ endpoint: "https://10.0.0.1/api" }));
      expect(result.success).toBe(false);
    });

    it("rejects localhost endpoint", () => {
      const result = serviceCardSchema.safeParse(validCard({ endpoint: "https://localhost/api" }));
      expect(result.success).toBe(false);
    });

    it("rejects cloud metadata endpoint", () => {
      const result = serviceCardSchema.safeParse(validCard({
        endpoint: "http://169.254.169.254/latest/meta-data/",
      }));
      expect(result.success).toBe(false);
    });

    it("rejects .internal domain endpoint", () => {
      const result = serviceCardSchema.safeParse(validCard({
        endpoint: "https://service.internal/api",
      }));
      expect(result.success).toBe(false);
    });

    it("accepts valid HTTPS endpoint", () => {
      const result = serviceCardSchema.safeParse(validCard({
        endpoint: "https://api.myservice.io:8443/v2",
      }));
      expect(result.success).toBe(true);
    });
  });

  // ── Health endpoint ────────────────────────────────────────────────────────

  describe("healthEndpoint validation", () => {
    it("accepts valid health endpoint", () => {
      const result = serviceCardSchema.safeParse(validCard({
        healthEndpoint: "https://api.creator.com/health",
      }));
      expect(result.success).toBe(true);
    });

    it("rejects private IP health endpoint", () => {
      const result = serviceCardSchema.safeParse(validCard({
        healthEndpoint: "https://192.168.1.1/health",
      }));
      expect(result.success).toBe(false);
    });

    it("rejects non-URL health endpoint", () => {
      const result = serviceCardSchema.safeParse(validCard({
        healthEndpoint: "not-a-url",
      }));
      expect(result.success).toBe(false);
    });
  });

  // ── Auth types ─────────────────────────────────────────────────────────────

  describe("auth type validation", () => {
    it("rejects unknown auth type", () => {
      const result = serviceCardSchema.safeParse(validCard({
        auth: { type: "hmac" },
      }));
      expect(result.success).toBe(false);
    });

    it("rejects api_key with empty headerName", () => {
      const result = serviceCardSchema.safeParse(validCard({
        auth: { type: "api_key", headerName: "" },
      }));
      expect(result.success).toBe(false);
    });

    it("rejects api_key with too-long headerName", () => {
      const result = serviceCardSchema.safeParse(validCard({
        auth: { type: "api_key", headerName: "X".repeat(101) },
      }));
      expect(result.success).toBe(false);
    });

    it("accepts custom headerName for api_key", () => {
      const result = serviceCardSchema.parse(validCard({
        auth: { type: "api_key", headerName: "X-Custom-Auth" },
      }));
      if (result.auth.type === "api_key") {
        expect(result.auth.headerName).toBe("X-Custom-Auth");
      }
    });

    it("rejects oauth2 without tokenEndpoint", () => {
      const result = serviceCardSchema.safeParse(validCard({
        auth: { type: "oauth2_client_credentials" },
      }));
      expect(result.success).toBe(false);
    });

    it("rejects oauth2 with invalid tokenEndpoint", () => {
      const result = serviceCardSchema.safeParse(validCard({
        auth: { type: "oauth2_client_credentials", tokenEndpoint: "not-url" },
      }));
      expect(result.success).toBe(false);
    });

    it("accepts oauth2 with valid tokenEndpoint and scopes", () => {
      const result = serviceCardSchema.safeParse(validCard({
        auth: {
          type: "oauth2_client_credentials",
          tokenEndpoint: "https://auth.example.com/token",
          scopes: ["read", "write"],
        },
      }));
      expect(result.success).toBe(true);
    });

    it("rejects oauth2 scope longer than 200 chars", () => {
      const result = serviceCardSchema.safeParse(validCard({
        auth: {
          type: "oauth2_client_credentials",
          tokenEndpoint: "https://auth.example.com/token",
          scopes: ["x".repeat(201)],
        },
      }));
      expect(result.success).toBe(false);
    });
  });

  // ── Skills validation ──────────────────────────────────────────────────────

  describe("skills validation", () => {
    it("rejects empty skills array", () => {
      const result = serviceCardSchema.safeParse(validCard({ skills: [] }));
      expect(result.success).toBe(false);
    });

    it("rejects more than 50 skills", () => {
      const skills = Array.from({ length: 51 }, (_, i) => ({
        name: `skill_${i}`,
        description: `Skill ${i}`,
        inputSchema: { type: "object" as const, properties: {} },
      }));
      const result = serviceCardSchema.safeParse(validCard({ skills }));
      expect(result.success).toBe(false);
    });

    it("accepts exactly 50 skills", () => {
      const skills = Array.from({ length: 50 }, (_, i) => ({
        name: `skill_${i}`,
        description: `Skill ${i}`,
        inputSchema: { type: "object" as const, properties: {} },
      }));
      const result = serviceCardSchema.safeParse(validCard({ skills }));
      expect(result.success).toBe(true);
    });

    it("rejects skill with uppercase name", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "GetWeather",
        description: "test",
        inputSchema: { type: "object", properties: {} },
      });
      expect(result.success).toBe(false);
    });

    it("rejects skill name starting with number", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "1bad_name",
        description: "test",
        inputSchema: { type: "object", properties: {} },
      });
      expect(result.success).toBe(false);
    });

    it("accepts skill name with hyphens", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "get-weather",
        description: "test",
        inputSchema: { type: "object", properties: {} },
      });
      expect(result.success).toBe(true);
    });

    it("allows skill name with underscores", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "get_current_weather",
        description: "test",
        inputSchema: { type: "object", properties: {} },
      });
      expect(result.success).toBe(true);
    });

    it("rejects skill name longer than 100 chars", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "a".repeat(101),
        description: "test",
        inputSchema: { type: "object", properties: {} },
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty skill name", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "",
        description: "test",
        inputSchema: { type: "object", properties: {} },
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty skill description", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "test_skill",
        description: "",
        inputSchema: { type: "object", properties: {} },
      });
      expect(result.success).toBe(false);
    });

    it("rejects skill description longer than 1000 chars", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "test_skill",
        description: "x".repeat(1001),
        inputSchema: { type: "object", properties: {} },
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing inputSchema", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "test_skill",
        description: "test",
      });
      expect(result.success).toBe(false);
    });

    it("rejects inputSchema with non-object type", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "test_skill",
        description: "test",
        inputSchema: { type: "string", properties: {} },
      });
      expect(result.success).toBe(false);
    });

    it("accepts inputSchema with required array", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "test_skill",
        description: "test",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string" } },
          required: ["city"],
        },
      });
      expect(result.success).toBe(true);
    });

    it("accepts optional outputSchema", () => {
      const result = serviceCardSkillSchema.safeParse({
        name: "test_skill",
        description: "test",
        inputSchema: { type: "object", properties: {} },
        outputSchema: { type: "object", properties: { temp: { type: "number" } } },
      });
      expect(result.success).toBe(true);
    });
  });

  // ── Rate limits ────────────────────────────────────────────────────────────

  describe("rate limits validation", () => {
    it("accepts valid rate limits", () => {
      const result = serviceCardRateLimitsSchema.safeParse({
        requestsPerMinute: 60,
        requestsPerDay: 10000,
      });
      expect(result.success).toBe(true);
    });

    it("rejects zero requestsPerMinute", () => {
      const result = serviceCardRateLimitsSchema.safeParse({
        requestsPerMinute: 0,
      });
      expect(result.success).toBe(false);
    });

    it("rejects negative requestsPerMinute", () => {
      const result = serviceCardRateLimitsSchema.safeParse({
        requestsPerMinute: -1,
      });
      expect(result.success).toBe(false);
    });

    it("rejects non-integer requestsPerMinute", () => {
      const result = serviceCardRateLimitsSchema.safeParse({
        requestsPerMinute: 60.5,
      });
      expect(result.success).toBe(false);
    });

    it("rejects requestsPerMinute exceeding 10000", () => {
      const result = serviceCardRateLimitsSchema.safeParse({
        requestsPerMinute: 10001,
      });
      expect(result.success).toBe(false);
    });

    it("accepts requestsPerMinute at max 10000", () => {
      const result = serviceCardRateLimitsSchema.safeParse({
        requestsPerMinute: 10000,
      });
      expect(result.success).toBe(true);
    });

    it("rejects requestsPerDay exceeding 1000000", () => {
      const result = serviceCardRateLimitsSchema.safeParse({
        requestsPerDay: 1000001,
      });
      expect(result.success).toBe(false);
    });

    it("accepts both fields empty (all optional)", () => {
      const result = serviceCardRateLimitsSchema.safeParse({});
      expect(result.success).toBe(true);
    });
  });

  // ── Timeout ────────────────────────────────────────────────────────────────

  describe("timeoutMs validation", () => {
    it("accepts valid timeout", () => {
      const result = serviceCardSchema.safeParse(validCard({ timeoutMs: 30000 }));
      expect(result.success).toBe(true);
    });

    it("rejects timeout exceeding 120000", () => {
      const result = serviceCardSchema.safeParse(validCard({ timeoutMs: 120001 }));
      expect(result.success).toBe(false);
    });

    it("accepts timeout at exactly 120000", () => {
      const result = serviceCardSchema.safeParse(validCard({ timeoutMs: 120000 }));
      expect(result.success).toBe(true);
    });

    it("rejects zero timeout", () => {
      const result = serviceCardSchema.safeParse(validCard({ timeoutMs: 0 }));
      expect(result.success).toBe(false);
    });

    it("rejects negative timeout", () => {
      const result = serviceCardSchema.safeParse(validCard({ timeoutMs: -1000 }));
      expect(result.success).toBe(false);
    });

    it("rejects non-integer timeout", () => {
      const result = serviceCardSchema.safeParse(validCard({ timeoutMs: 30000.5 }));
      expect(result.success).toBe(false);
    });

    it("accepts 1ms timeout", () => {
      const result = serviceCardSchema.safeParse(validCard({ timeoutMs: 1 }));
      expect(result.success).toBe(true);
    });
  });

  // ── Version ────────────────────────────────────────────────────────────────

  describe("version validation", () => {
    it("accepts valid semver", () => {
      expect(serviceCardSchema.safeParse(validCard({ version: "1.0.0" })).success).toBe(true);
      expect(serviceCardSchema.safeParse(validCard({ version: "0.1.0" })).success).toBe(true);
      expect(serviceCardSchema.safeParse(validCard({ version: "12.34.56" })).success).toBe(true);
    });

    it("rejects pre-release versions (strict semver)", () => {
      expect(serviceCardSchema.safeParse(validCard({ version: "1.0.0-beta" })).success).toBe(false);
    });

    it("rejects build metadata", () => {
      expect(serviceCardSchema.safeParse(validCard({ version: "1.0.0+build123" })).success).toBe(false);
    });

    it("rejects two-part version", () => {
      expect(serviceCardSchema.safeParse(validCard({ version: "1.0" })).success).toBe(false);
    });

    it("rejects single number version", () => {
      expect(serviceCardSchema.safeParse(validCard({ version: "1" })).success).toBe(false);
    });

    it("rejects empty version", () => {
      expect(serviceCardSchema.safeParse(validCard({ version: "" })).success).toBe(false);
    });

    it("rejects version with leading v", () => {
      expect(serviceCardSchema.safeParse(validCard({ version: "v1.0.0" })).success).toBe(false);
    });
  });

  // ── Auth schema standalone ─────────────────────────────────────────────────

  describe("serviceCardAuthSchema standalone", () => {
    it("accepts api_key type", () => {
      expect(serviceCardAuthSchema.safeParse({ type: "api_key" }).success).toBe(true);
    });

    it("accepts bearer type", () => {
      expect(serviceCardAuthSchema.safeParse({ type: "bearer" }).success).toBe(true);
    });

    it("accepts oauth2 type with tokenEndpoint", () => {
      expect(serviceCardAuthSchema.safeParse({
        type: "oauth2_client_credentials",
        tokenEndpoint: "https://auth.example.com/token",
      }).success).toBe(true);
    });

    it("rejects completely invalid object", () => {
      expect(serviceCardAuthSchema.safeParse({ foo: "bar" }).success).toBe(false);
    });

    it("rejects null", () => {
      expect(serviceCardAuthSchema.safeParse(null).success).toBe(false);
    });
  });
});
