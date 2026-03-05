import { describe, it, expect } from "vitest";
import {
  packageCardSchema,
  packageCardSkillSchema,
  packageCardAuthSchema,
  packageCardRateLimitsSchema,
} from "./packageCard.js";

// ── Fixtures ────────────────────────────────────────────────────────────────

const VALID_SKILL = {
  name: "get_weather",
  description: "Get current weather for a location",
  inputSchema: {
    type: "object" as const,
    properties: {
      city: { type: "string" },
      units: { type: "string", enum: ["metric", "imperial"] },
    },
    required: ["city"],
  },
  outputSchema: {
    type: "object" as const,
    properties: {
      temperature: { type: "number" },
      condition: { type: "string" },
    },
  },
};

const VALID_CARD = {
  endpoint: "https://weather-api.creator.com/v1",
  healthEndpoint: "https://weather-api.creator.com/health",
  auth: { type: "api_key" as const },
  skills: [VALID_SKILL],
  rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
  version: "1.0.0",
};

// ── PackageCard Schema ──────────────────────────────────────────────────────

describe("PackageCard Schema", () => {
  it("accepts a valid full package card", () => {
    const result = packageCardSchema.safeParse(VALID_CARD);
    expect(result.success).toBe(true);
  });

  it("accepts minimal card (no healthEndpoint, no rateLimits)", () => {
    const result = packageCardSchema.safeParse({
      endpoint: "https://api.example.com",
      auth: { type: "bearer" },
      skills: [VALID_SKILL],
      version: "1.0.0",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing endpoint", () => {
    const { endpoint, ...rest } = VALID_CARD;
    const result = packageCardSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects non-URL endpoint", () => {
    const result = packageCardSchema.safeParse({
      ...VALID_CARD,
      endpoint: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-URL healthEndpoint", () => {
    const result = packageCardSchema.safeParse({
      ...VALID_CARD,
      healthEndpoint: "not a url at all",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing auth", () => {
    const { auth, ...rest } = VALID_CARD;
    const result = packageCardSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects empty skills array", () => {
    const result = packageCardSchema.safeParse({
      ...VALID_CARD,
      skills: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing version", () => {
    const { version, ...rest } = VALID_CARD;
    const result = packageCardSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects non-semver version", () => {
    const result = packageCardSchema.safeParse({
      ...VALID_CARD,
      version: "v1.0",
    });
    expect(result.success).toBe(false);
  });

  it("rejects version with prefix", () => {
    const result = packageCardSchema.safeParse({
      ...VALID_CARD,
      version: "v1.0.0",
    });
    expect(result.success).toBe(false);
  });

  it("accepts version with patch number", () => {
    const result = packageCardSchema.safeParse({
      ...VALID_CARD,
      version: "2.1.3",
    });
    expect(result.success).toBe(true);
  });
});

// ── Skill Schema ────────────────────────────────────────────────────────────

describe("PackageCard Skill Schema", () => {
  it("accepts valid skill with input and output schemas", () => {
    const result = packageCardSkillSchema.safeParse(VALID_SKILL);
    expect(result.success).toBe(true);
  });

  it("accepts skill without outputSchema", () => {
    const { outputSchema, ...rest } = VALID_SKILL;
    const result = packageCardSkillSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const result = packageCardSkillSchema.safeParse({
      ...VALID_SKILL,
      name: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects name with uppercase", () => {
    const result = packageCardSkillSchema.safeParse({
      ...VALID_SKILL,
      name: "Get_Weather",
    });
    expect(result.success).toBe(false);
  });

  it("rejects name starting with a digit", () => {
    const result = packageCardSkillSchema.safeParse({
      ...VALID_SKILL,
      name: "1_weather",
    });
    expect(result.success).toBe(false);
  });

  it("rejects name with hyphens", () => {
    const result = packageCardSkillSchema.safeParse({
      ...VALID_SKILL,
      name: "get-weather",
    });
    expect(result.success).toBe(false);
  });

  it("accepts name with underscores", () => {
    const result = packageCardSkillSchema.safeParse({
      ...VALID_SKILL,
      name: "get_current_weather",
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty description", () => {
    const result = packageCardSkillSchema.safeParse({
      ...VALID_SKILL,
      description: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects inputSchema without type: object", () => {
    const result = packageCardSkillSchema.safeParse({
      ...VALID_SKILL,
      inputSchema: { type: "array", items: { type: "string" } },
    });
    expect(result.success).toBe(false);
  });

  it("rejects inputSchema without properties", () => {
    const result = packageCardSkillSchema.safeParse({
      ...VALID_SKILL,
      inputSchema: { type: "object" },
    });
    expect(result.success).toBe(false);
  });

  it("accepts inputSchema with extra JSON Schema fields (passthrough)", () => {
    const result = packageCardSkillSchema.safeParse({
      ...VALID_SKILL,
      inputSchema: {
        type: "object",
        properties: { q: { type: "string" } },
        additionalProperties: false,
        description: "Search params",
      },
    });
    expect(result.success).toBe(true);
  });
});

// ── Auth Schema ─────────────────────────────────────────────────────────────

describe("PackageCard Auth Schema", () => {
  it("accepts api_key with default headerName", () => {
    const result = packageCardAuthSchema.safeParse({ type: "api_key" });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "api_key") {
      expect(result.data.headerName).toBe("X-API-Key");
    }
  });

  it("accepts api_key with custom headerName", () => {
    const result = packageCardAuthSchema.safeParse({
      type: "api_key",
      headerName: "X-Custom-Key",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "api_key") {
      expect(result.data.headerName).toBe("X-Custom-Key");
    }
  });

  it("accepts bearer with default headerName", () => {
    const result = packageCardAuthSchema.safeParse({ type: "bearer" });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "bearer") {
      expect(result.data.type).toBe("bearer");
      expect(result.data.headerName).toBe("Authorization");
    }
  });

  it("accepts oauth2_client_credentials with tokenEndpoint", () => {
    const result = packageCardAuthSchema.safeParse({
      type: "oauth2_client_credentials",
      tokenEndpoint: "https://auth.example.com/oauth/token",
      scopes: ["read", "write"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.type).toBe("oauth2_client_credentials");
    }
  });

  it("accepts oauth2 with empty scopes default", () => {
    const result = packageCardAuthSchema.safeParse({
      type: "oauth2_client_credentials",
      tokenEndpoint: "https://auth.example.com/token",
    });
    expect(result.success).toBe(true);
    if (result.success && result.data.type === "oauth2_client_credentials") {
      expect(result.data.scopes).toEqual([]);
    }
  });

  it("rejects oauth2 without tokenEndpoint", () => {
    const result = packageCardAuthSchema.safeParse({
      type: "oauth2_client_credentials",
    });
    expect(result.success).toBe(false);
  });

  it("rejects oauth2 with non-URL tokenEndpoint", () => {
    const result = packageCardAuthSchema.safeParse({
      type: "oauth2_client_credentials",
      tokenEndpoint: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown auth type", () => {
    const result = packageCardAuthSchema.safeParse({
      type: "basic",
    });
    expect(result.success).toBe(false);
  });
});

// ── Rate Limits Schema ──────────────────────────────────────────────────────

describe("PackageCard RateLimits Schema", () => {
  it("accepts both limits", () => {
    const result = packageCardRateLimitsSchema.safeParse({
      requestsPerMinute: 60,
      requestsPerDay: 10000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts only requestsPerMinute", () => {
    const result = packageCardRateLimitsSchema.safeParse({
      requestsPerMinute: 100,
    });
    expect(result.success).toBe(true);
  });

  it("accepts only requestsPerDay", () => {
    const result = packageCardRateLimitsSchema.safeParse({
      requestsPerDay: 5000,
    });
    expect(result.success).toBe(true);
  });

  it("accepts empty object (both optional)", () => {
    const result = packageCardRateLimitsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("rejects zero requestsPerMinute", () => {
    const result = packageCardRateLimitsSchema.safeParse({
      requestsPerMinute: 0,
    });
    expect(result.success).toBe(false);
  });

  it("rejects negative requestsPerDay", () => {
    const result = packageCardRateLimitsSchema.safeParse({
      requestsPerDay: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-integer requestsPerMinute", () => {
    const result = packageCardRateLimitsSchema.safeParse({
      requestsPerMinute: 60.5,
    });
    expect(result.success).toBe(false);
  });

  it("rejects requestsPerMinute above max", () => {
    const result = packageCardRateLimitsSchema.safeParse({
      requestsPerMinute: 10001,
    });
    expect(result.success).toBe(false);
  });

  it("rejects requestsPerDay above max", () => {
    const result = packageCardRateLimitsSchema.safeParse({
      requestsPerDay: 1000001,
    });
    expect(result.success).toBe(false);
  });
});
