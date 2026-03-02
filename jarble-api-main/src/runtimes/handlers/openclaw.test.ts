import { describe, it, expect, vi } from "vitest";

// Mock node:fs before importing the handler — the module reads jarble-ui-server.js at import time
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "// mock MCP server script"),
}));

// Mock the platformCredentials router module to avoid circular dependency chain:
// platformCredentials.ts → configSync.ts → runtimes/index.ts → openclaw.ts (cycle)
// We only need the exported constant maps, not the router itself.
vi.mock("../../trpc/routers/platformCredentials.js", () => ({
  PLATFORM_CREDENTIAL_KEYS: {
    discord: { botToken: "token" },
    telegram: { botToken: "botToken" },
    slack: { botToken: "botToken", appToken: "appToken" },
    whatsapp: {},
    web: { allowedDomains: "allowedDomains" },
    teams: { appId: "appId", appPassword: "appPassword" },
    messenger: { pageAccessToken: "pageAccessToken", verifyToken: "verifyToken" },
  } as Record<string, Record<string, string>>,
  PLATFORM_ENV_MAP: {
    discord: { botToken: "DISCORD_BOT_TOKEN" },
    telegram: { botToken: "TELEGRAM_BOT_TOKEN" },
    slack: { botToken: "SLACK_BOT_TOKEN", appToken: "SLACK_APP_TOKEN" },
    whatsapp: {},
    web: {},
    teams: { appId: "TEAMS_APP_ID", appPassword: "TEAMS_APP_PASSWORD" },
    messenger: { pageAccessToken: "MESSENGER_PAGE_ACCESS_TOKEN", verifyToken: "MESSENGER_VERIFY_TOKEN" },
  } as Record<string, Record<string, string>>,
}));

import { openclawHandler } from "./openclaw.js";
import type { DeploymentFields, ConfigFile } from "../types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDeployment(overrides: Partial<DeploymentFields> = {}): DeploymentFields {
  return {
    id: "test-deploy-id",
    runtime: "openclaw",
    name: "Test Bot",
    description: "A test deployment",
    systemPrompt: "You are a helpful assistant.",
    llmMode: "byok",
    llmProvider: "anthropic",
    llmModel: "anthropic/claude-sonnet-4-20250514",
    llmApiKey: "sk-ant-test-key-123",
    gatewayToken: "gw-token-abc",
    ...overrides,
  };
}

// ── Handler metadata ─────────────────────────────────────────────────────────

describe("openclawHandler metadata", () => {
  it("has correct slug and name", () => {
    expect(openclawHandler.slug).toBe("openclaw");
    expect(openclawHandler.name).toBe("OpenClaw");
  });

  it("declares correct capabilities", () => {
    expect(openclawHandler.capabilities).toEqual({
      needsLlm: true,
      hasPlatforms: true,
      hasSkills: true,
      hasSystemPrompt: true,
    });
  });

  it("declares config file specs", () => {
    expect(openclawHandler.configFiles).toHaveLength(2);
    expect(openclawHandler.configFiles[0].path).toBe("soul.md");
    expect(openclawHandler.configFiles[1].path).toBe("openclaw.json");
  });
});

// ── renderConfigs ────────────────────────────────────────────────────────────

describe("openclawHandler.renderConfigs", () => {
  it("generates soul.md with systemPrompt + JARBLE_UI_PROMPT", () => {
    const deployment = makeDeployment({ systemPrompt: "I am a bakery bot." });
    const files = openclawHandler.renderConfigs(deployment);

    const soulFiles = files.filter((f) => f.path === "soul.md" || f.path.endsWith("SOUL.md"));
    expect(soulFiles.length).toBeGreaterThanOrEqual(1);

    const soulMd = soulFiles[0];
    // Should contain user system prompt
    expect(soulMd.content).toContain("I am a bakery bot.");
    // Should contain JARBLE_UI_PROMPT sections
    expect(soulMd.content).toContain("Platform Awareness");
    expect(soulMd.content).toContain("jarble_ui");
  });

  it("generates soul.md without systemPrompt when null", () => {
    const deployment = makeDeployment({ systemPrompt: null });
    const files = openclawHandler.renderConfigs(deployment);

    const soulMd = files.find((f) => f.path === "soul.md")!;
    // Should start directly with the JARBLE_UI_PROMPT (no user prompt prefix)
    expect(soulMd.content).toContain("Platform Awareness");
    // The content should start with the UI prompt, not with "null" or empty systemPrompt text
    expect(soulMd.content.startsWith("## Platform Awareness")).toBe(true);
  });

  it("writes soul.md to both config path and OpenClaw workspace path (legacy)", () => {
    const deployment = makeDeployment();
    const files = openclawHandler.renderConfigs(deployment);

    const soulPaths = files.filter((f) => f.path === "soul.md" || f.path.includes("SOUL.md"));
    expect(soulPaths).toHaveLength(2);
    expect(soulPaths[0].path).toBe("soul.md");
    expect(soulPaths[1].path).toBe("/data/.openclaw/.openclaw/workspace/SOUL.md");
    // Both should have identical content
    expect(soulPaths[0].content).toBe(soulPaths[1].content);
  });

  it("writes soul.md to operator workspace path when managedBy=operator", () => {
    const deployment = makeDeployment({ managedBy: "operator" });
    const files = openclawHandler.renderConfigs(deployment);

    const soulPaths = files.filter((f) => f.path === "soul.md" || f.path.includes("SOUL.md"));
    expect(soulPaths).toHaveLength(2);
    expect(soulPaths[1].path).toBe("/home/openclaw/.openclaw/.openclaw/workspace/SOUL.md");
  });

  it("generates openclaw.json with agent.model", () => {
    const deployment = makeDeployment({ llmModel: "anthropic/claude-opus-4-6" });
    const files = openclawHandler.renderConfigs(deployment);

    const configFile = files.find((f) => f.path === "openclaw.json")!;
    const config = JSON.parse(configFile.content);
    expect(config.agent.model).toBe("anthropic/claude-opus-4-6");
  });

  it("generates openclaw.json with gateway config", () => {
    const deployment = makeDeployment({ gatewayToken: "my-gw-token" });
    const files = openclawHandler.renderConfigs(deployment);

    const configFile = files.find((f) => f.path === "openclaw.json")!;
    const config = JSON.parse(configFile.content);
    expect(config.gateway.port).toBe(18789);
    expect(config.gateway.auth.token).toBe("my-gw-token");
    expect(config.gateway.http.endpoints.chatCompletions.enabled).toBe(true);
  });

  it("generates openclaw.json without gateway auth when no token", () => {
    const deployment = makeDeployment({ gatewayToken: undefined });
    const files = openclawHandler.renderConfigs(deployment);

    const configFile = files.find((f) => f.path === "openclaw.json")!;
    const config = JSON.parse(configFile.content);
    expect(config.gateway.port).toBe(18789);
    expect(config.gateway.auth).toBeUndefined();
  });

  it("includes tools.deny with canvas", () => {
    const deployment = makeDeployment();
    const files = openclawHandler.renderConfigs(deployment);

    const configFile = files.find((f) => f.path === "openclaw.json")!;
    const config = JSON.parse(configFile.content);
    expect(config.tools.deny).toEqual(["canvas"]);
  });

  it("builds discord channel config with pairing dmPolicy", () => {
    const deployment = makeDeployment({
      platformCredentials: {
        discord: { botToken: "discord-tok-123" },
      },
    });
    const files = openclawHandler.renderConfigs(deployment);

    const configFile = files.find((f) => f.path === "openclaw.json")!;
    const config = JSON.parse(configFile.content);
    expect(config.channels.discord).toEqual({
      enabled: true,
      token: "discord-tok-123",
      dmPolicy: "pairing",
    });
  });

  it("builds telegram channel config with pairing dmPolicy", () => {
    const deployment = makeDeployment({
      platformCredentials: {
        telegram: { botToken: "tg-bot-token-999" },
      },
    });
    const files = openclawHandler.renderConfigs(deployment);

    const configFile = files.find((f) => f.path === "openclaw.json")!;
    const config = JSON.parse(configFile.content);
    expect(config.channels.telegram).toEqual({
      enabled: true,
      botToken: "tg-bot-token-999",
      dmPolicy: "pairing",
    });
  });

  it("builds slack channel config without dmPolicy", () => {
    const deployment = makeDeployment({
      platformCredentials: {
        slack: { botToken: "xoxb-slack", appToken: "xapp-slack" },
      },
    });
    const files = openclawHandler.renderConfigs(deployment);

    const configFile = files.find((f) => f.path === "openclaw.json")!;
    const config = JSON.parse(configFile.content);
    expect(config.channels.slack).toEqual({
      enabled: true,
      botToken: "xoxb-slack",
      appToken: "xapp-slack",
    });
  });

  it("builds whatsapp channel config with pairing dmPolicy and no tokens", () => {
    const deployment = makeDeployment({
      platformCredentials: {
        whatsapp: {},
      },
    });
    const files = openclawHandler.renderConfigs(deployment);

    const configFile = files.find((f) => f.path === "openclaw.json")!;
    const config = JSON.parse(configFile.content);
    expect(config.channels.whatsapp).toEqual({
      enabled: true,
      dmPolicy: "pairing",
    });
  });

  it("builds multiple channels when multiple platform credentials exist", () => {
    const deployment = makeDeployment({
      platformCredentials: {
        discord: { botToken: "disc-tok" },
        telegram: { botToken: "tg-tok" },
        whatsapp: {},
      },
    });
    const files = openclawHandler.renderConfigs(deployment);

    const configFile = files.find((f) => f.path === "openclaw.json")!;
    const config = JSON.parse(configFile.content);
    expect(Object.keys(config.channels)).toEqual(["discord", "telegram", "whatsapp"]);
  });

  it("has empty channels when no platformCredentials", () => {
    const deployment = makeDeployment({ platformCredentials: undefined });
    const files = openclawHandler.renderConfigs(deployment);

    const configFile = files.find((f) => f.path === "openclaw.json")!;
    const config = JSON.parse(configFile.content);
    expect(config.channels).toEqual({});
  });

  it("writes openclaw.json to both config path and OpenClaw native path (legacy)", () => {
    const deployment = makeDeployment();
    const files = openclawHandler.renderConfigs(deployment);

    const jsonFiles = files.filter(
      (f) => f.path === "openclaw.json" || f.path.endsWith("openclaw.json")
    );
    // Should have at least 2: config path + native path
    expect(jsonFiles.length).toBeGreaterThanOrEqual(2);
    expect(jsonFiles[0].path).toBe("openclaw.json");
    expect(jsonFiles[1].path).toBe("/data/.openclaw/openclaw.json");
  });

  it("writes openclaw.json to operator native path when managedBy=operator", () => {
    const deployment = makeDeployment({ managedBy: "operator" });
    const files = openclawHandler.renderConfigs(deployment);

    const jsonFiles = files.filter(
      (f) => f.path === "openclaw.json" || f.path.endsWith("openclaw.json")
    );
    expect(jsonFiles.length).toBeGreaterThanOrEqual(2);
    expect(jsonFiles[1].path).toBe("/home/openclaw/.openclaw/openclaw.json");
  });

  it("includes MCP server script file", () => {
    const deployment = makeDeployment();
    const files = openclawHandler.renderConfigs(deployment);

    const mcpFile = files.find((f) => f.path === "mcp/jarble-ui-server.js");
    expect(mcpFile).toBeDefined();
    expect(mcpFile!.content).toBe("// mock MCP server script");
  });

  it("uses messaging-only prompt for messagingOnly deployments", () => {
    const deployment = makeDeployment({ messagingOnly: true });
    const files = openclawHandler.renderConfigs(deployment);

    const soulMd = files.find((f) => f.path === "soul.md")!;
    expect(soulMd.content).toContain("You are a messaging bot");
    expect(soulMd.content).not.toContain("Jarble UI (dashboard only)");
  });
});

// ── getSecretEntries ─────────────────────────────────────────────────────────

describe("openclawHandler.getSecretEntries", () => {
  it("maps anthropic provider to ANTHROPIC_API_KEY", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmProvider: "anthropic", llmApiKey: "sk-ant-key" })
    );
    expect(entries["ANTHROPIC_API_KEY"]).toBe("sk-ant-key");
    expect(entries["LLM_PROVIDER"]).toBe("anthropic");
  });

  it("maps openai provider to OPENAI_API_KEY", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmProvider: "openai", llmApiKey: "sk-openai-key" })
    );
    expect(entries["OPENAI_API_KEY"]).toBe("sk-openai-key");
  });

  it("maps google provider to GOOGLE_API_KEY", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmProvider: "google", llmApiKey: "AIza-google-key" })
    );
    expect(entries["GOOGLE_API_KEY"]).toBe("AIza-google-key");
  });

  it("maps openrouter provider to OPENROUTER_API_KEY", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmProvider: "openrouter", llmApiKey: "sk-or-key" })
    );
    expect(entries["OPENROUTER_API_KEY"]).toBe("sk-or-key");
  });

  it("defaults to OPENROUTER_API_KEY for unknown provider", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmProvider: "unknown-provider", llmApiKey: "some-key" })
    );
    expect(entries["OPENROUTER_API_KEY"]).toBe("some-key");
  });

  it("includes LLM_MODEL when set", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmModel: "anthropic/claude-opus-4-6" })
    );
    expect(entries["LLM_MODEL"]).toBe("anthropic/claude-opus-4-6");
  });

  it("omits LLM_MODEL when null", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmModel: null })
    );
    expect(entries["LLM_MODEL"]).toBeUndefined();
  });

  it("includes gateway token as 'token' key for operator compatibility", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ gatewayToken: "gw-tok-xyz" })
    );
    expect(entries["token"]).toBe("gw-tok-xyz");
  });

  it("omits gateway token when not set", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ gatewayToken: undefined })
    );
    expect(entries["token"]).toBeUndefined();
  });

  it("includes operator env vars for MCP server paths in operator mode", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ managedBy: "operator" })
    );
    expect(entries["JARBLE_COMPONENTS_DIR"]).toBe("/home/openclaw/.openclaw/components");
    expect(entries["JARBLE_FILES_DIR"]).toBe("/home/openclaw/.openclaw/files");
    expect(entries["JARBLE_MEMORY_DIR"]).toBe("/home/openclaw/.openclaw/memory");
  });

  it("omits operator env vars in legacy mode", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ managedBy: "legacy" })
    );
    expect(entries["JARBLE_COMPONENTS_DIR"]).toBeUndefined();
    expect(entries["JARBLE_FILES_DIR"]).toBeUndefined();
    expect(entries["JARBLE_MEMORY_DIR"]).toBeUndefined();
  });

  it("maps platform credential env vars for discord", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({
        platformCredentials: { discord: { botToken: "disc-tok-999" } },
      })
    );
    expect(entries["DISCORD_BOT_TOKEN"]).toBe("disc-tok-999");
  });

  it("maps platform credential env vars for telegram", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({
        platformCredentials: { telegram: { botToken: "tg-tok-888" } },
      })
    );
    expect(entries["TELEGRAM_BOT_TOKEN"]).toBe("tg-tok-888");
  });

  it("maps platform credential env vars for slack (both tokens)", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({
        platformCredentials: {
          slack: { botToken: "xoxb-slack", appToken: "xapp-slack" },
        },
      })
    );
    expect(entries["SLACK_BOT_TOKEN"]).toBe("xoxb-slack");
    expect(entries["SLACK_APP_TOKEN"]).toBe("xapp-slack");
  });

  it("omits API key entries when llmApiKey is null", () => {
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmApiKey: null })
    );
    expect(entries["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(entries["OPENROUTER_API_KEY"]).toBeUndefined();
    expect(entries["OPENAI_API_KEY"]).toBeUndefined();
    expect(entries["GOOGLE_API_KEY"]).toBeUndefined();
  });
});

// ── parseConfigs ─────────────────────────────────────────────────────────────

describe("openclawHandler.parseConfigs", () => {
  it("parses soul.md into systemPrompt", () => {
    const result = openclawHandler.parseConfigs([
      { path: "soul.md", content: "You are a helpful bot.\n\n## Platform Awareness..." },
    ]);
    expect(result.systemPrompt).toBe("You are a helpful bot.\n\n## Platform Awareness...");
  });

  it("parses openclaw.json agent.model into llmModel", () => {
    const result = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify({ agent: { model: "gpt-4o" } }) },
    ]);
    expect(result.llmModel).toBe("gpt-4o");
  });

  it("parses channels back into platformCredentials", () => {
    const config = {
      channels: {
        discord: { enabled: true, token: "disc-tok", dmPolicy: "pairing" },
        telegram: { enabled: true, botToken: "tg-tok", dmPolicy: "pairing" },
      },
    };
    const result = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(config) },
    ]);
    expect(result.platformCredentials).toEqual({
      discord: { botToken: "disc-tok" },
      telegram: { botToken: "tg-tok" },
    });
  });

  it("includes whatsapp even with no tokens", () => {
    const config = {
      channels: {
        whatsapp: { enabled: true, dmPolicy: "pairing" },
      },
    };
    const result = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(config) },
    ]);
    expect(result.platformCredentials).toEqual({
      whatsapp: {},
    });
  });

  it("handles malformed JSON gracefully", () => {
    const result = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: "{bad json!!!" },
    ]);
    // Should not crash, just skip the JSON parsing
    expect(result.llmModel).toBeUndefined();
    expect(result.platformCredentials).toBeUndefined();
  });

  it("returns empty result when no matching files", () => {
    const result = openclawHandler.parseConfigs([
      { path: "unknown.yaml", content: "foo: bar" },
    ]);
    expect(result).toEqual({});
  });

  it("parses both soul.md and openclaw.json together", () => {
    const config = { agent: { model: "claude-3.5-sonnet" } };
    const result = openclawHandler.parseConfigs([
      { path: "soul.md", content: "My system prompt" },
      { path: "openclaw.json", content: JSON.stringify(config) },
    ]);
    expect(result.systemPrompt).toBe("My system prompt");
    expect(result.llmModel).toBe("claude-3.5-sonnet");
  });

  it("skips non-object channel entries", () => {
    const config = {
      channels: {
        discord: null,
        telegram: "invalid",
      },
    };
    const result = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(config) },
    ]);
    expect(result.platformCredentials).toBeUndefined();
  });
});

// ── validateCreate ───────────────────────────────────────────────────────────

describe("openclawHandler.validateCreate", () => {
  it("returns null when byok mode has a key", () => {
    const result = openclawHandler.validateCreate({ llmMode: "byok", llmApiKey: "sk-test" });
    expect(result).toBeNull();
  });

  it("returns error when byok mode has no key", () => {
    const result = openclawHandler.validateCreate({ llmMode: "byok", llmApiKey: undefined });
    expect(result).toContain("LLM API key");
  });

  it("returns null for non-byok mode", () => {
    const result = openclawHandler.validateCreate({ llmMode: "included" });
    expect(result).toBeNull();
  });

  it("returns null for empty input", () => {
    const result = openclawHandler.validateCreate({});
    expect(result).toBeNull();
  });
});
