import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock node:fs before importing the handler - the module reads jarble-ui-server.js at import time
vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => "// mock MCP server script"),
}));

// Mock env module before importing handler - platform mode reads env vars.
// vi.mock factory is hoisted, so we cannot reference top-level variables.
// Instead, we import the mocked env and mutate it directly in tests.
vi.mock("../../utils/env.js", () => ({
  env: {} as Record<string, string | undefined>,
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
import { env } from "../../utils/env.js";
import type { DeploymentFields, ConfigFile } from "../types.js";

const mockEnv = env as unknown as Record<string, string | undefined>;

// ── Setup ────────────────────────────────────────────────────────────────────

function clearEnv() {
  for (const key of Object.keys(mockEnv)) {
    delete mockEnv[key];
  }
}

beforeEach(() => {
  clearEnv();
});

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
    // Base spec has 4 entries. delegation-tools.json is generated
    // dynamically by renderConfigs only when teamMembers exist (A2A
    // Phase 1), so it's not in the static configFiles list.
    expect(openclawHandler.configFiles).toHaveLength(4);
    expect(openclawHandler.configFiles[0].path).toBe("soul.md");
    expect(openclawHandler.configFiles[1].path).toBe("openclaw.json");
    expect(openclawHandler.configFiles[2].path).toBe("skills/*");
    expect(openclawHandler.configFiles[2].isGlob).toBe(true);
    expect(openclawHandler.configFiles[3].path).toBe("subagent-tools.json");
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
    // Should contain deployment name identity header
    expect(soulMd.content).toContain("# Test Bot");
    expect(soulMd.content).toContain("You are Test Bot.");
    // Should contain JARBLE_UI_PROMPT
    expect(soulMd.content).toContain("Platform Awareness");
    // Should start with the deployment name identity header, not "null"
    expect(soulMd.content.startsWith("# Test Bot")).toBe(true);
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

  it("generates openclaw.json with agents.defaults.model.primary", () => {
    const deployment = makeDeployment({ llmModel: "claude-opus-4-6" });
    const files = openclawHandler.renderConfigs(deployment);

    const configFile = files.find((f) => f.path === "openclaw.json")!;
    const config = JSON.parse(configFile.content);
    // OpenClaw reads from agents.defaults.model.primary with provider prefix
    expect(config.agents.defaults.model.primary).toBe("anthropic/claude-opus-4-6");
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

  it("renders skill config files when skills are present", () => {
    const deployment = makeDeployment({
      skills: [
        { name: "Web Search", config: '{"tool":"browser","params":{"engine":"google"}}' },
        { name: "Weather", config: '{"tool":"weather","params":{"provider":"openweather"}}' },
      ],
    });
    const files = openclawHandler.renderConfigs(deployment);

    const skillFiles = files.filter((f) => f.path.startsWith("skills/"));
    expect(skillFiles).toHaveLength(2);
    expect(skillFiles[0].path).toBe("skills/web-search.json");
    expect(skillFiles[0].content).toBe('{"tool":"browser","params":{"engine":"google"}}');
    expect(skillFiles[1].path).toBe("skills/weather.json");
    expect(skillFiles[1].content).toBe('{"tool":"weather","params":{"provider":"openweather"}}');
  });

  it("does not render skill files when no skills installed", () => {
    const deployment = makeDeployment({ skills: undefined });
    const files = openclawHandler.renderConfigs(deployment);

    const skillFiles = files.filter((f) => f.path.startsWith("skills/"));
    expect(skillFiles).toHaveLength(0);
  });

  it("sanitizes skill names for filenames", () => {
    const deployment = makeDeployment({
      skills: [
        { name: "My Custom Skill!", config: '{}' },
      ],
    });
    const files = openclawHandler.renderConfigs(deployment);

    const skillFile = files.find((f) => f.path.startsWith("skills/"));
    expect(skillFile).toBeDefined();
    expect(skillFile!.path).toBe("skills/my-custom-skill-.json");
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

  // ── JARBLE_API_URL derivation ──────────────────────────────────────────────
  // Regression: chained .replace() turned "dev.jarble.ai" → "api.api.jarble.ai".
  // Fix uses a single regex instead.
  // Note: handler reads process.env.FRONTEND_URL directly (not the env utility mock).

  it("sets JARBLE_API_URL to https://api.jarble.ai when FRONTEND_URL is not set", () => {
    const prev = process.env.FRONTEND_URL;
    delete process.env.FRONTEND_URL;
    try {
      const entries = openclawHandler.getSecretEntries(makeDeployment());
      expect(entries["JARBLE_API_URL"]).toBe("https://api.jarble.ai");
    } finally {
      if (prev !== undefined) process.env.FRONTEND_URL = prev;
    }
  });

  it("derives JARBLE_API_URL from dev.jarble.ai FRONTEND_URL correctly (no double-replace)", () => {
    const prev = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "https://dev.jarble.ai";
    try {
      const entries = openclawHandler.getSecretEntries(makeDeployment());
      expect(entries["JARBLE_API_URL"]).toBe("https://api.jarble.ai");
      // Guard against the old double-replace bug
      expect(entries["JARBLE_API_URL"]).not.toBe("https://api.api.jarble.ai");
    } finally {
      if (prev !== undefined) process.env.FRONTEND_URL = prev;
      else delete process.env.FRONTEND_URL;
    }
  });

  it("derives JARBLE_API_URL from bare jarble.ai FRONTEND_URL correctly", () => {
    const prev = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "https://jarble.ai";
    try {
      const entries = openclawHandler.getSecretEntries(makeDeployment());
      expect(entries["JARBLE_API_URL"]).toBe("https://api.jarble.ai");
    } finally {
      if (prev !== undefined) process.env.FRONTEND_URL = prev;
      else delete process.env.FRONTEND_URL;
    }
  });

  it("preserves non-jarble FRONTEND_URL as-is for JARBLE_API_URL", () => {
    const prev = process.env.FRONTEND_URL;
    process.env.FRONTEND_URL = "http://localhost:3000";
    try {
      const entries = openclawHandler.getSecretEntries(makeDeployment());
      // Non-jarble URLs pass through unchanged
      expect(entries["JARBLE_API_URL"]).toBe("http://localhost:3000");
    } finally {
      if (prev !== undefined) process.env.FRONTEND_URL = prev;
      else delete process.env.FRONTEND_URL;
    }
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

// ── Phase 1: Sandbox-First Prompt Pivot ──────────────────────────────────────

describe("Phase 1 - sandbox-first prompt language", () => {
  it("soul.md contains 'SANDBOX-FIRST RULE' (not LAST RESORT)", () => {
    const deployment = makeDeployment();
    const files = openclawHandler.renderConfigs(deployment);
    const soulMd = files.find((f) => f.path === "soul.md")!;

    expect(soulMd.content).toContain("SANDBOX-FIRST RULE");
    expect(soulMd.content).not.toContain("LAST RESORT");
  });

  it("Component Chooser section has sandbox as the first/default recommendation", () => {
    const deployment = makeDeployment();
    const files = openclawHandler.renderConfigs(deployment);
    const soulMd = files.find((f) => f.path === "soul.md")!;

    // Extract the Component Chooser section
    const chooserStart = soulMd.content.indexOf("### Component Chooser");
    expect(chooserStart).toBeGreaterThan(-1);

    const chooserSection = soulMd.content.slice(chooserStart, chooserStart + 500);

    // Should recommend sandbox as the default
    expect(chooserSection).toContain("sandbox");
    // First line after the heading should mention sandbox as default
    const lines = chooserSection.split("\n").filter((l) => l.trim().length > 0);
    expect(lines[1]).toContain("sandbox");
  });

  it("messaging-only prompt has no sandbox-first language", () => {
    const deployment = makeDeployment({ messagingOnly: true });
    const files = openclawHandler.renderConfigs(deployment);
    const soulMd = files.find((f) => f.path === "soul.md")!;

    expect(soulMd.content).not.toContain("SANDBOX-FIRST RULE");
    expect(soulMd.content).not.toContain("Component Chooser");
  });
});

// ── Bot Teams: soul.md Team Context section ──────────────────────────────────

describe("openclawHandler.renderConfigs - Team Context (Bot Teams)", () => {
  it("does NOT render Team Context for solo deployments", () => {
    // No teamContext field set → solo bot → no Team Context block at all.
    const files = openclawHandler.renderConfigs(makeDeployment());
    const soulMd = files.find((f) => f.path === "soul.md")!;

    expect(soulMd.content).not.toContain("BEGIN JARBLE_FLOW_CONTEXT");
    expect(soulMd.content).not.toContain("## Team Context");
  });

  it("renders Team Context block when deployment.teamContext is set", () => {
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamContext: {
          flowId: "flw_abc123",
          flowName: "Pricing Squad",
          selfRole: "Entry Point",
          isEntryPoint: true,
          teammates: [
            { deploymentId: "dep_pricer", name: "Pricer Bot", role: "Pricing Specialist", slug: "pricing_specialist" },
            { deploymentId: "dep_cat", name: "Catalog Bot", role: "Catalog Lookup", slug: "catalog_lookup" },
          ],
        },
      })
    );
    const soulMd = files.find((f) => f.path === "soul.md")!;

    // Delimiters must wrap the section so we can find/remove it later.
    expect(soulMd.content).toContain("<!-- BEGIN JARBLE_FLOW_CONTEXT v1 -->");
    expect(soulMd.content).toContain("<!-- END JARBLE_FLOW_CONTEXT v1 -->");
    expect(soulMd.content).toContain("## Team Context");

    // Flow name and self role appear authoritatively.
    expect(soulMd.content).toContain("\"Pricing Squad\"");
    expect(soulMd.content).toContain("**Your team role:** Entry Point");

    // Entry-point note only fires when isEntryPoint=true.
    expect(soulMd.content).toContain("**You are the entry point**");

    // Teammates render as bullet list with slug + role + name.
    expect(soulMd.content).toContain("- **pricing_specialist** (Pricing Specialist) — Pricer Bot");
    expect(soulMd.content).toContain("- **catalog_lookup** (Catalog Lookup) — Catalog Bot");
  });

  it("omits the entry-point note when isEntryPoint=false", () => {
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamContext: {
          flowId: "flw_x",
          flowName: "Team A",
          selfRole: "Specialist",
          isEntryPoint: false,
          teammates: [
            { deploymentId: "dep_lead", name: "Lead Bot", role: "Coordinator", slug: "coordinator" },
          ],
        },
      })
    );
    const soulMd = files.find((f) => f.path === "soul.md")!;

    expect(soulMd.content).toContain("## Team Context");
    expect(soulMd.content).not.toContain("**You are the entry point**");
  });

  it("teaches the exact jarble_delegate JSON block format with one-shot example", () => {
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamContext: {
          flowId: "flw_x",
          flowName: "Demo Team",
          selfRole: null,
          isEntryPoint: false,
          teammates: [
            { deploymentId: "dep_specialist", name: "Specialist", role: null, slug: "specialist" },
          ],
        },
      })
    );
    const soulMd = files.find((f) => f.path === "soul.md")!;

    // Must reference the language-tagged fence by exact name.
    expect(soulMd.content).toContain("`jarble_delegate`");
    // Must include a one-shot example with the agreed example payload.
    expect(soulMd.content).toContain('"to": "specialist"');
    expect(soulMd.content).toContain('"task": "Describe primary colors"');
    expect(soulMd.content).toContain('"context": ""');
  });

  it("includes the hard rule against fabricating delegations", () => {
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamContext: {
          flowId: "flw_x",
          flowName: "Team",
          selfRole: "Member",
          isEntryPoint: true,
          teammates: [
            { deploymentId: "dep_a", name: "A", role: null, slug: "a" },
          ],
        },
      })
    );
    const soulMd = files.find((f) => f.path === "soul.md")!;

    expect(soulMd.content).toContain("Never claim you delegated unless you actually emitted a `jarble_delegate` block");
    expect(soulMd.content).toContain("If you cannot accomplish the task and have no appropriate teammate, say so plainly");
  });

  it("renders a polite empty-team note when teammates is empty", () => {
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamContext: {
          flowId: "flw_solo",
          flowName: "One-Bot Team",
          selfRole: "Entry Point",
          isEntryPoint: true,
          teammates: [],
        },
      })
    );
    const soulMd = files.find((f) => f.path === "soul.md")!;

    expect(soulMd.content).toContain("## Team Context");
    expect(soulMd.content).toContain("You have no teammates configured");
  });

  it("falls back to '(unspecified)' messaging when selfRole is null", () => {
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamContext: {
          flowId: "flw_x",
          flowName: "Team",
          selfRole: null,
          isEntryPoint: false,
          teammates: [
            { deploymentId: "dep_a", name: "A", role: null, slug: "a" },
          ],
        },
      })
    );
    const soulMd = files.find((f) => f.path === "soul.md")!;
    expect(soulMd.content).toContain("**Your team role:** (unspecified");
  });

  it("renders teammates without role suffix when role is null", () => {
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamContext: {
          flowId: "flw_x",
          flowName: "Team",
          selfRole: "Lead",
          isEntryPoint: true,
          teammates: [
            { deploymentId: "dep_unrole", name: "No Role Bot", role: null, slug: "no_role_bot" },
          ],
        },
      })
    );
    const soulMd = files.find((f) => f.path === "soul.md")!;
    // Format: `- **slug** — name` (no parenthesized role suffix)
    expect(soulMd.content).toContain("- **no_role_bot** — No Role Bot");
    // No empty parens
    expect(soulMd.content).not.toContain("**no_role_bot** ()");
  });

  it("writes delegation-tools.json with a2a_delegate when teamMembers exist (A2A Phase 1)", () => {
    // A2A Phase 1: delegation-tools.json is now generated dynamically
    // with the a2a_delegate tool + legacy per-member tools.
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamMembers: [
          { deploymentId: "dep_a", name: "A", role: "Specialist", slug: "specialist" },
        ],
        teamContext: {
          flowId: "flw_x",
          flowName: "Team",
          selfRole: "Lead",
          isEntryPoint: true,
          teammates: [
            { deploymentId: "dep_a", name: "A", role: "Specialist", slug: "specialist" },
          ],
        },
      })
    );

    const delegationFile = files.find((f) => f.path === "delegation-tools.json");
    expect(delegationFile).toBeDefined();
    const tools = JSON.parse(delegationFile!.content);
    expect(tools[0].name).toBe("a2a_delegate");
  });

  it("includes a2a_delegate instructions in Agent Pool Team Members section", () => {
    // A2A Phase 1: the Agent Pool block now teaches a2a_delegate as the
    // preferred delegation method, with legacy tools as fallback.
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamMembers: [
          { deploymentId: "dep_a", name: "A", role: "Specialist", slug: "specialist" },
        ],
        teamContext: {
          flowId: "flw_x",
          flowName: "Team",
          selfRole: "Lead",
          isEntryPoint: true,
          teammates: [
            { deploymentId: "dep_a", name: "A", role: "Specialist", slug: "specialist" },
          ],
        },
      })
    );
    const soulMd = files.find((f) => f.path === "soul.md")!;

    // A2A Phase 1: soul.md now includes Team Members section with a2a_delegate
    expect(soulMd.content).toContain("a2a_delegate");
    expect(soulMd.content).toContain("### Team Members");
  });

  it("renders Team Context to BOTH soul.md and the workspace SOUL.md path", () => {
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamContext: {
          flowId: "flw_x",
          flowName: "Team",
          selfRole: "Lead",
          isEntryPoint: true,
          teammates: [],
        },
      })
    );

    const soulFiles = files.filter((f) => f.path === "soul.md" || f.path.endsWith("SOUL.md"));
    expect(soulFiles).toHaveLength(2);
    for (const f of soulFiles) {
      expect(f.content).toContain("BEGIN JARBLE_FLOW_CONTEXT v1");
    }
  });
});

// ── Phase 2: Agent Forking - platform LLM key injection ─────────────────────

describe("openclawHandler.getSecretEntries - platform mode", () => {
  it("uses AGENT_LLM_API_KEY when llmMode is 'platform'", () => {
    mockEnv.AGENT_LLM_API_KEY = "platform-key-abc";
    mockEnv.AGENT_LLM_PROVIDER = "anthropic";

    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmMode: "platform", llmApiKey: null })
    );
    expect(entries["ANTHROPIC_API_KEY"]).toBe("platform-key-abc");
  });

  it("falls back to OPENROUTER_API_KEY env when AGENT_LLM_API_KEY is not set", () => {
    mockEnv.OPENROUTER_API_KEY = "or-fallback-key";
    // No AGENT_LLM_API_KEY

    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmMode: "platform", llmApiKey: null })
    );
    expect(entries["OPENROUTER_API_KEY"]).toBe("or-fallback-key");
  });

  it("defaults provider to openrouter when AGENT_LLM_PROVIDER is not set", () => {
    mockEnv.AGENT_LLM_API_KEY = "platform-key-456";
    // No AGENT_LLM_PROVIDER - should default to "openrouter"

    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmMode: "platform", llmApiKey: null })
    );
    expect(entries["OPENROUTER_API_KEY"]).toBe("platform-key-456");
  });

  it("maps platform key to OPENAI_API_KEY when AGENT_LLM_PROVIDER=openai", () => {
    mockEnv.AGENT_LLM_API_KEY = "platform-openai-key";
    mockEnv.AGENT_LLM_PROVIDER = "openai";

    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmMode: "platform", llmApiKey: null })
    );
    expect(entries["OPENAI_API_KEY"]).toBe("platform-openai-key");
    expect(entries["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(entries["OPENROUTER_API_KEY"]).toBeUndefined();
  });

  it("maps platform key to GOOGLE_API_KEY when AGENT_LLM_PROVIDER=google", () => {
    mockEnv.AGENT_LLM_API_KEY = "platform-google-key";
    mockEnv.AGENT_LLM_PROVIDER = "google";

    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmMode: "platform", llmApiKey: null })
    );
    expect(entries["GOOGLE_API_KEY"]).toBe("platform-google-key");
  });

  it("includes no LLM key when neither AGENT_LLM_API_KEY nor OPENROUTER_API_KEY is set", () => {
    // Both env vars undefined
    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmMode: "platform", llmApiKey: null })
    );
    expect(entries["OPENROUTER_API_KEY"]).toBeUndefined();
    expect(entries["ANTHROPIC_API_KEY"]).toBeUndefined();
    expect(entries["OPENAI_API_KEY"]).toBeUndefined();
    expect(entries["GOOGLE_API_KEY"]).toBeUndefined();
  });

  it("ignores deployment llmApiKey in platform mode (uses env instead)", () => {
    mockEnv.AGENT_LLM_API_KEY = "platform-key-wins";
    // Default provider = openrouter

    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmMode: "platform", llmApiKey: "user-key-should-be-ignored" })
    );
    expect(entries["OPENROUTER_API_KEY"]).toBe("platform-key-wins");
  });

  it("still includes LLM_PROVIDER and LLM_MODEL in platform mode", () => {
    mockEnv.AGENT_LLM_API_KEY = "pk";

    const entries = openclawHandler.getSecretEntries(
      makeDeployment({ llmMode: "platform", llmProvider: "anthropic", llmModel: "claude-opus-4-6" })
    );
    expect(entries["LLM_PROVIDER"]).toBe("anthropic");
    expect(entries["LLM_MODEL"]).toBe("claude-opus-4-6");
  });
});

// ── A2A Delegation ────────────────────────────────────────────────────────────

describe("a2a_delegate tool generation", () => {
  it("generates delegation-tools.json with a2a_delegate and legacy tools", () => {
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamMembers: [
          { deploymentId: "dep-researcher", slug: "researcher", name: "Research Bot", role: "researcher" },
          { deploymentId: "dep-writer", slug: "writer", name: "Writer Bot", role: "writer" },
        ],
      })
    );
    const delegationFile = files.find((f) => f.path === "delegation-tools.json");
    expect(delegationFile).toBeDefined();
    const tools = JSON.parse(delegationFile!.content);
    expect(tools).toHaveLength(3); // 1 a2a_delegate + 2 legacy

    // a2a_delegate tool
    const a2a = tools[0];
    expect(a2a.name).toBe("a2a_delegate");
    expect(a2a.inputSchema.properties.to.enum).toEqual(["researcher", "writer"]);
    expect(a2a.inputSchema.required).toContain("to");
    expect(a2a.inputSchema.required).toContain("task");

    // Legacy tools
    expect(tools[1].name).toBe("delegate_to_researcher");
    expect(tools[2].name).toBe("delegate_to_writer");
  });

  it("does not generate delegation-tools.json when no teamMembers", () => {
    const files = openclawHandler.renderConfigs(makeDeployment({ teamMembers: undefined }));
    const delegationFile = files.find((f) => f.path === "delegation-tools.json");
    expect(delegationFile).toBeUndefined();
  });

  it("includes a2a_delegate instructions in soul.md when teamMembers present", () => {
    const files = openclawHandler.renderConfigs(
      makeDeployment({
        teamMembers: [
          { deploymentId: "dep-analyst", slug: "analyst", name: "Analyst Bot", role: null },
        ],
      })
    );
    const soulMd = files.find((f) => f.path === "soul.md");
    expect(soulMd).toBeDefined();
    expect(soulMd!.content).toContain("a2a_delegate");
    expect(soulMd!.content).toContain("analyst");
  });
});
