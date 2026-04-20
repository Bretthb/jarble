import { describe, it, expect, vi } from "vitest";

// Mock the platformCredentials router module to avoid circular dependency chain:
// platformCredentials.ts → configSync.ts → runtimes/index.ts → zeroclaw.ts (cycle)
vi.mock("../../trpc/routers/platformCredentials.js", () => ({
  PLATFORM_CREDENTIAL_KEYS: {
    discord: { botToken: "token" },
    telegram: { botToken: "botToken" },
    slack: { botToken: "botToken", appToken: "appToken" },
    whatsapp: {},
  } as Record<string, Record<string, string>>,
  PLATFORM_ENV_MAP: {
    discord: { botToken: "DISCORD_BOT_TOKEN" },
    telegram: { botToken: "TELEGRAM_BOT_TOKEN" },
    slack: { botToken: "SLACK_BOT_TOKEN", appToken: "SLACK_APP_TOKEN" },
    whatsapp: {},
  } as Record<string, Record<string, string>>,
}));

import { zeroclawHandler } from "./zeroclaw.js";
import type { DeploymentFields } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDeployment(overrides: Partial<DeploymentFields> = {}): DeploymentFields {
  return {
    id: "zc-deploy-id",
    runtime: "zeroclaw",
    name: "ZeroClaw Bot",
    description: "A test ZeroClaw deployment",
    systemPrompt: null,
    llmMode: "byok",
    llmProvider: "openrouter",
    llmModel: "google/gemini-2.5-pro",
    llmApiKey: "sk-or-zeroclaw-key",
    ...overrides,
  };
}

// ── Handler metadata ─────────────────────────────────────────────────────────

describe("zeroclawHandler metadata", () => {
  it("has correct slug and name", () => {
    expect(zeroclawHandler.slug).toBe("zeroclaw");
    expect(zeroclawHandler.name).toBe("ZeroClaw");
  });

  it("declares correct capabilities", () => {
    const caps = zeroclawHandler.capabilities;
    expect(caps.needsLlm).toBe(true);
    expect(caps.hasPlatforms).toBe(true);
    expect(caps.hasSkills).toBe(false);
    expect(caps.hasSystemPrompt).toBe(false);
    // JAR-119 Phase 2
    expect(caps.nativeCanvas).toBe(false);
    expect(caps.modelSwitch).toBe("restart");
    // JAR-120 Phase 3
    expect(caps.ingress).toEqual({
      port: 3000,
      authStrategy: "bearer-header",
    });
    // JAR-121 Phase 4
    expect(caps.chatTransport).toBe("http-stream");
    expect(caps.nativeUi?.mode).toBe("iframe");
    expect(caps.nativeUi?.authHandoff).toBe("bearer-header");
  });

  it("declares config file spec for config.toml", () => {
    expect(zeroclawHandler.configFiles).toHaveLength(1);
    expect(zeroclawHandler.configFiles[0].path).toBe("config.toml");
  });
});

// ── renderConfigs ────────────────────────────────────────────────────────────

describe("zeroclawHandler.renderConfigs", () => {
  it("generates TOML with agent name", () => {
    const files = zeroclawHandler.renderConfigs(makeDeployment({ name: "My Bot" }));

    expect(files).toHaveLength(1);
    expect(files[0].path).toBe("config.toml");
    expect(files[0].content).toContain('[agent]');
    expect(files[0].content).toContain('name = "My Bot"');
  });

  it("includes description when provided", () => {
    const files = zeroclawHandler.renderConfigs(
      makeDeployment({ description: "A smart assistant" })
    );
    expect(files[0].content).toContain('description = "A smart assistant"');
  });

  it("omits description when null", () => {
    const files = zeroclawHandler.renderConfigs(
      makeDeployment({ description: null })
    );
    expect(files[0].content).not.toContain("description");
  });

  it("includes provider section with default provider", () => {
    const files = zeroclawHandler.renderConfigs(
      makeDeployment({ llmProvider: "anthropic" })
    );
    expect(files[0].content).toContain("[provider]");
    expect(files[0].content).toContain('default = "anthropic"');
  });

  it("defaults provider to openrouter when not set", () => {
    const files = zeroclawHandler.renderConfigs(
      makeDeployment({ llmProvider: "" })
    );
    expect(files[0].content).toContain('default = "openrouter"');
  });

  it("includes TOML header comment", () => {
    const files = zeroclawHandler.renderConfigs(makeDeployment());
    expect(files[0].content).toContain("Managed by Jarble AI Platform");
  });
});

// ── getSecretEntries ─────────────────────────────────────────────────────────

describe("zeroclawHandler.getSecretEntries", () => {
  it("maps llmApiKey to API_KEY (not provider-specific)", () => {
    const entries = zeroclawHandler.getSecretEntries(
      makeDeployment({ llmApiKey: "my-api-key" })
    );
    expect(entries["API_KEY"]).toBe("my-api-key");
  });

  it("maps llmProvider to PROVIDER", () => {
    const entries = zeroclawHandler.getSecretEntries(
      makeDeployment({ llmProvider: "anthropic" })
    );
    expect(entries["PROVIDER"]).toBe("anthropic");
  });

  it("maps llmModel to ZEROCLAW_MODEL", () => {
    const entries = zeroclawHandler.getSecretEntries(
      makeDeployment({ llmModel: "claude-3.5-sonnet" })
    );
    expect(entries["ZEROCLAW_MODEL"]).toBe("claude-3.5-sonnet");
  });

  it("omits entries for null fields", () => {
    const entries = zeroclawHandler.getSecretEntries(
      makeDeployment({ llmApiKey: null, llmModel: null })
    );
    expect(entries["API_KEY"]).toBeUndefined();
    expect(entries["ZEROCLAW_MODEL"]).toBeUndefined();
  });

  it("maps platform credential env vars for telegram", () => {
    const entries = zeroclawHandler.getSecretEntries(
      makeDeployment({
        platformCredentials: { telegram: { botToken: "tg-tok-111" } },
      })
    );
    expect(entries["TELEGRAM_BOT_TOKEN"]).toBe("tg-tok-111");
  });

  it("maps platform credential env vars for discord", () => {
    const entries = zeroclawHandler.getSecretEntries(
      makeDeployment({
        platformCredentials: { discord: { botToken: "disc-tok-222" } },
      })
    );
    expect(entries["DISCORD_BOT_TOKEN"]).toBe("disc-tok-222");
  });
});

// ── parseConfigs ─────────────────────────────────────────────────────────────

describe("zeroclawHandler.parseConfigs", () => {
  it("returns empty object (minimal implementation)", () => {
    const result = zeroclawHandler.parseConfigs([
      { path: "config.toml", content: '[agent]\nname = "Bot"' },
    ]);
    expect(result).toEqual({});
  });
});

// ── validateCreate ───────────────────────────────────────────────────────────

describe("zeroclawHandler.validateCreate", () => {
  it("returns null when byok mode has a key", () => {
    const result = zeroclawHandler.validateCreate({ llmMode: "byok", llmApiKey: "sk-test" });
    expect(result).toBeNull();
  });

  it("returns error when byok mode has no key", () => {
    const result = zeroclawHandler.validateCreate({ llmMode: "byok", llmApiKey: undefined });
    expect(result).toContain("LLM API key");
  });

  it("returns null for non-byok mode", () => {
    const result = zeroclawHandler.validateCreate({ llmMode: "included" });
    expect(result).toBeNull();
  });
});
