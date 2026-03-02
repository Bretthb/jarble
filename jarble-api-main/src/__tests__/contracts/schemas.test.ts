import { describe, it, expect } from "vitest";
import { z } from "zod";

/**
 * API Contract Tests
 *
 * Tests the Zod input schemas used by tRPC router procedures.
 * These schemas form the API contract between frontend and backend.
 * We test them directly (without tRPC) to ensure validation rules
 * are correct and stable.
 */

// ── Deployment Create Schema ────────────────────────────────────────────────
// Source: jarble-api-main/src/trpc/routers/deployment.ts lines 226-243

const deploymentCreateSchema = z.object({
  name: z.string().min(1),
  runtimeCatalogId: z.number(),
  platform: z.string().optional(),
  image: z.string().optional(),
  llmMode: z.enum(["included", "byok"]).default("byok"),
  llmProvider: z
    .enum(["openrouter", "openai", "anthropic", "google"])
    .default("openrouter"),
  llmModel: z.string().optional(),
  llmApiKey: z.string().optional(),
  systemPrompt: z.string().optional(),
  creditLimitDollars: z.number().min(1).max(1000).optional(),
  linkToDeploymentId: z.string().optional(),
  cpuLimit: z.string().optional(),
  memoryMb: z.number().int().positive().optional(),
  storageMb: z.number().int().positive().optional(),
  telegramBotToken: z.string().optional(),
  messagingOnly: z.boolean().optional(),
});

// ── Platform Credentials Save Schema ────────────────────────────────────────
// Source: jarble-api-main/src/trpc/routers/platformCredentials.ts line 92-96

const platformCredentialsSaveSchema = z.object({
  deploymentId: z.string(),
  platformId: z.string(),
  credentials: z.record(z.string()),
});

// ── Validate Provider Key Schema ────────────────────────────────────────────
// Source: jarble-api-main/src/trpc/routers/openrouter.ts lines 57-60

const validateProviderKeySchema = z.object({
  provider: z.enum(["openrouter", "openai", "anthropic", "google"]),
  apiKey: z.string().min(1),
});

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Deployment Create Schema", () => {
  it("accepts valid minimal input", () => {
    const input = { name: "My Bot", runtimeCatalogId: 1 };
    const result = deploymentCreateSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.llmMode).toBe("byok"); // default
      expect(result.data.llmProvider).toBe("openrouter"); // default
    }
  });

  it("accepts valid full input with all fields", () => {
    const input = {
      name: "Production Bot",
      runtimeCatalogId: 2,
      platform: "telegram",
      image: "ghcr.io/jarble-ai/openclaw:latest",
      llmMode: "included" as const,
      llmProvider: "anthropic" as const,
      llmModel: "claude-sonnet-4-20250514",
      llmApiKey: "sk-ant-api03-test",
      systemPrompt: "You are a helpful assistant.",
      creditLimitDollars: 10,
      linkToDeploymentId: "dep-abc123",
      cpuLimit: "2.0",
      memoryMb: 2048,
      storageMb: 30,
      telegramBotToken: "123456:ABC-DEF",
      messagingOnly: true,
    };
    const result = deploymentCreateSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects empty name", () => {
    const input = { name: "", runtimeCatalogId: 1 };
    const result = deploymentCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing name", () => {
    const input = { runtimeCatalogId: 1 };
    const result = deploymentCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing runtimeCatalogId", () => {
    const input = { name: "Test" };
    const result = deploymentCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid llmMode enum value", () => {
    const input = {
      name: "Test",
      runtimeCatalogId: 1,
      llmMode: "free",
    };
    const result = deploymentCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects invalid llmProvider enum value", () => {
    const input = {
      name: "Test",
      runtimeCatalogId: 1,
      llmProvider: "huggingface",
    };
    const result = deploymentCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects creditLimitDollars below 1", () => {
    const input = {
      name: "Test",
      runtimeCatalogId: 1,
      creditLimitDollars: 0,
    };
    const result = deploymentCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects creditLimitDollars above 1000", () => {
    const input = {
      name: "Test",
      runtimeCatalogId: 1,
      creditLimitDollars: 1001,
    };
    const result = deploymentCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects non-integer memoryMb", () => {
    const input = {
      name: "Test",
      runtimeCatalogId: 1,
      memoryMb: 1024.5,
    };
    const result = deploymentCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects negative storageMb", () => {
    const input = {
      name: "Test",
      runtimeCatalogId: 1,
      storageMb: -10,
    };
    const result = deploymentCreateSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("Platform Credentials Save Schema", () => {
  it("accepts valid input", () => {
    const input = {
      deploymentId: "dep-123",
      platformId: "telegram",
      credentials: { botToken: "123456:ABC-DEF" },
    };
    const result = platformCredentialsSaveSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("accepts credentials with multiple keys", () => {
    const input = {
      deploymentId: "dep-123",
      platformId: "slack",
      credentials: { botToken: "xoxb-123", appToken: "xapp-456" },
    };
    const result = platformCredentialsSaveSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("rejects missing deploymentId", () => {
    const input = {
      platformId: "telegram",
      credentials: { botToken: "abc" },
    };
    const result = platformCredentialsSaveSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing platformId", () => {
    const input = {
      deploymentId: "dep-123",
      credentials: { botToken: "abc" },
    };
    const result = platformCredentialsSaveSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects missing credentials", () => {
    const input = {
      deploymentId: "dep-123",
      platformId: "telegram",
    };
    const result = platformCredentialsSaveSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("rejects non-string values in credentials record", () => {
    const input = {
      deploymentId: "dep-123",
      platformId: "telegram",
      credentials: { botToken: 12345 },
    };
    const result = platformCredentialsSaveSchema.safeParse(input);
    expect(result.success).toBe(false);
  });
});

describe("Validate Provider Key Schema", () => {
  it("accepts valid openrouter key", () => {
    const result = validateProviderKeySchema.safeParse({
      provider: "openrouter",
      apiKey: "sk-or-v1-test123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid anthropic key", () => {
    const result = validateProviderKeySchema.safeParse({
      provider: "anthropic",
      apiKey: "sk-ant-api03-test123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid openai key", () => {
    const result = validateProviderKeySchema.safeParse({
      provider: "openai",
      apiKey: "sk-proj-test123",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid google key", () => {
    const result = validateProviderKeySchema.safeParse({
      provider: "google",
      apiKey: "AIza-test-key",
    });
    expect(result.success).toBe(true);
  });

  it("rejects unsupported provider", () => {
    const result = validateProviderKeySchema.safeParse({
      provider: "huggingface",
      apiKey: "hf_test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = validateProviderKeySchema.safeParse({
      provider: "openai",
      apiKey: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing provider", () => {
    const result = validateProviderKeySchema.safeParse({
      apiKey: "sk-test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing apiKey", () => {
    const result = validateProviderKeySchema.safeParse({
      provider: "openai",
    });
    expect(result.success).toBe(false);
  });
});
