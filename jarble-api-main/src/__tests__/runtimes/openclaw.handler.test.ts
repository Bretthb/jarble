/**
 * Unit tests for the OpenClaw runtime handler.
 *
 * Covers the two pure transformation functions on the handler:
 *
 *   - `parseConfigs(files)` — reverse-sync: read soul.md +
 *     openclaw.json off the PVC and translate them back into DB
 *     fields. The platform calls this from `configSync.ts` whenever
 *     the user (or the bot) edited config in-pod and we need to
 *     reconcile the DB row. A regression that swallowed the
 *     `agents.defaults.model.primary` path would silently lose the
 *     model the bot was running.
 *
 *   - `validateCreate(input)` — deployment-create input gate. Today
 *     the only rule is "BYOK requires an API key", but it's the
 *     last line of defense before we save a deployment that can't
 *     actually start.
 *
 * The handler module imports `env`, the platformCredentials router,
 * and the logger at module-load. We mock all three so the test can
 * run without standing up the full DATABASE_URL / Auth0 / tRPC
 * environment.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    AGENT_LLM_API_KEY: "",
    OPENROUTER_API_KEY: "",
    AGENT_LLM_PROVIDER: "openrouter",
    FRONTEND_URL: "https://api.jarble.ai",
  },
}));

// platformCredentials router pulls in db/zod/etc. Mock it down to the
// two record-shaped exports the handler actually consumes.
vi.mock("../../trpc/routers/platformCredentials.js", () => ({
  PLATFORM_CREDENTIAL_KEYS: {
    discord: { botToken: "token" },
    telegram: { botToken: "botToken" },
    slack: { botToken: "botToken", appToken: "appToken" },
    whatsapp: {},
    web: { allowedDomains: "allowedDomains" },
    teams: { appId: "appId", appPassword: "appPassword" },
    messenger: { pageAccessToken: "pageAccessToken", verifyToken: "verifyToken" },
  },
  PLATFORM_ENV_MAP: {
    discord: { botToken: "DISCORD_BOT_TOKEN" },
    telegram: { botToken: "TELEGRAM_BOT_TOKEN" },
    slack: { botToken: "SLACK_BOT_TOKEN", appToken: "SLACK_APP_TOKEN" },
    whatsapp: {},
    web: {},
    teams: { appId: "TEAMS_APP_ID", appPassword: "TEAMS_APP_PASSWORD" },
    messenger: { pageAccessToken: "MESSENGER_PAGE_ACCESS_TOKEN", verifyToken: "MESSENGER_VERIFY_TOKEN" },
  },
}));

import { openclawHandler } from "../../runtimes/handlers/openclaw.js";

// ── parseConfigs ────────────────────────────────────────────────────────────

describe("openclawHandler.parseConfigs", () => {
  it("returns an empty result for an empty file array", () => {
    const r = openclawHandler.parseConfigs([]);
    expect(r).toEqual({});
  });

  it("populates systemPrompt from soul.md when present", () => {
    const r = openclawHandler.parseConfigs([
      { path: "soul.md", content: "# My Bot\nYou are helpful." },
    ]);
    expect(r.systemPrompt).toBe("# My Bot\nYou are helpful.");
  });

  it("preserves multiline soul.md content verbatim (no trim, no normalization)", () => {
    const content = "# Header\n\n\nBody with     spaces.\n\n  Trailing whitespace  \n";
    const r = openclawHandler.parseConfigs([{ path: "soul.md", content }]);
    expect(r.systemPrompt).toBe(content);
  });

  it("extracts llmModel from agents.defaults.model.primary (current path) and strips the provider prefix", () => {
    const cfg = {
      agents: { defaults: { model: { primary: "anthropic/claude-sonnet-4-20250514" } } },
    };
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(cfg) },
    ]);
    expect(r.llmModel).toBe("claude-sonnet-4-20250514");
  });

  it("falls back to agent.model (legacy path) when the new path is absent", () => {
    const cfg = { agent: { model: "openai/gpt-4o" } };
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(cfg) },
    ]);
    expect(r.llmModel).toBe("gpt-4o");
  });

  it("returns model as-is when there is no provider prefix slash", () => {
    const cfg = { agents: { defaults: { model: { primary: "claude-sonnet-4" } } } };
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(cfg) },
    ]);
    expect(r.llmModel).toBe("claude-sonnet-4");
  });

  it("does NOT throw on malformed openclaw.json — returns empty result", () => {
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: "{not json" },
    ]);
    // No fields populated, but no exception raised.
    expect(r.llmModel).toBeUndefined();
    expect(r.platformCredentials).toBeUndefined();
  });

  it("extracts Discord credentials via the channels.token reverse mapping", () => {
    const cfg = {
      channels: {
        discord: { token: "xxxx-discord", enabled: true },
      },
    };
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(cfg) },
    ]);
    expect(r.platformCredentials).toEqual({
      discord: { botToken: "xxxx-discord" },
    });
  });

  it("extracts Telegram credentials via channels.telegram.botToken", () => {
    const cfg = { channels: { telegram: { botToken: "1234:token" } } };
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(cfg) },
    ]);
    expect(r.platformCredentials).toEqual({
      telegram: { botToken: "1234:token" },
    });
  });

  it("extracts both Slack credentials (botToken + appToken)", () => {
    const cfg = {
      channels: {
        slack: { botToken: "xoxb-slack", appToken: "xapp-slack" },
      },
    };
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(cfg) },
    ]);
    expect(r.platformCredentials).toEqual({
      slack: { botToken: "xoxb-slack", appToken: "xapp-slack" },
    });
  });

  it("includes WhatsApp even when the channel has no credentials (special-cased)", () => {
    // WhatsApp uses QR pairing via Baileys — no tokens to extract, but
    // its presence in the channels block is still meaningful (the bot
    // is connected). The reverse-sync must surface this so the DB
    // doesn't drop the connection on next save.
    const cfg = { channels: { whatsapp: { dmPolicy: "pairing" } } };
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(cfg) },
    ]);
    expect(r.platformCredentials).toEqual({ whatsapp: {} });
  });

  it("ignores unknown platforms (safe forward-compat)", () => {
    const cfg = {
      channels: {
        discord: { token: "xxxx" },
        unknownPlatform: { someKey: "someValue" },
      },
    };
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(cfg) },
    ]);
    expect(r.platformCredentials).toEqual({
      discord: { botToken: "xxxx" },
    });
  });

  it("omits a platform when no recognized credential keys are present (and it's not whatsapp)", () => {
    // Discord with no `token` field at all — nothing to extract.
    const cfg = { channels: { discord: { enabled: true } } };
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(cfg) },
    ]);
    // No platformCredentials at all (nothing to surface).
    expect(r.platformCredentials).toBeUndefined();
  });

  it("ignores non-object channel entries (defensive)", () => {
    const cfg = {
      channels: {
        discord: null, // malformed — must not crash
        telegram: { botToken: "valid-tg" },
      },
    };
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(cfg) },
    ]);
    expect(r.platformCredentials).toEqual({
      telegram: { botToken: "valid-tg" },
    });
  });

  it("populates systemPrompt AND llmModel AND platformCredentials from a full config pair", () => {
    const r = openclawHandler.parseConfigs([
      { path: "soul.md", content: "You are helpful." },
      {
        path: "openclaw.json",
        content: JSON.stringify({
          agents: { defaults: { model: { primary: "anthropic/claude-sonnet-4" } } },
          channels: { discord: { token: "xxx" } },
        }),
      },
    ]);
    expect(r.systemPrompt).toBe("You are helpful.");
    expect(r.llmModel).toBe("claude-sonnet-4");
    expect(r.platformCredentials).toEqual({ discord: { botToken: "xxx" } });
  });

  it("never returns llmApiKey — security boundary (keys are never reverse-synced from PVC)", () => {
    // Even if a malicious or buggy pod wrote an apiKey field into the
    // openclaw.json, parseConfigs MUST NOT surface it back into the
    // ParsedDeploymentFields. That field type doesn't even include
    // llmApiKey (see types.ts) — but we double-check the runtime
    // shape because TypeScript can't enforce this at parse time.
    const cfg = {
      agents: { defaults: { model: { primary: "anthropic/claude-sonnet-4" } } },
      api_key: "sk-stolen-key-attempt", // unsupported field
    };
    const r = openclawHandler.parseConfigs([
      { path: "openclaw.json", content: JSON.stringify(cfg) },
    ]);
    expect((r as any).llmApiKey).toBeUndefined();
  });
});

// ── validateCreate ──────────────────────────────────────────────────────────

describe("openclawHandler.validateCreate", () => {
  it("rejects byok mode without an llmApiKey", () => {
    const err = openclawHandler.validateCreate({ llmMode: "byok" });
    expect(err).toContain("Bring Your Own Key");
  });

  it("rejects byok mode with an empty-string llmApiKey", () => {
    // !"" is truthy → the check fires.
    const err = openclawHandler.validateCreate({ llmMode: "byok", llmApiKey: "" });
    expect(err).toContain("Bring Your Own Key");
  });

  it("accepts byok mode with a non-empty llmApiKey", () => {
    const err = openclawHandler.validateCreate({
      llmMode: "byok",
      llmApiKey: "sk-ant-anything",
    });
    expect(err).toBeNull();
  });

  it("accepts included mode without an llmApiKey (auto-provisioned via OpenRouter)", () => {
    expect(openclawHandler.validateCreate({ llmMode: "included" })).toBeNull();
  });

  it("accepts platform mode without an llmApiKey (uses platform-managed key)", () => {
    expect(openclawHandler.validateCreate({ llmMode: "platform" } as any)).toBeNull();
  });

  it("accepts an empty input (no llmMode set — validation only fires for byok)", () => {
    expect(openclawHandler.validateCreate({})).toBeNull();
  });
});

// ── Stable static metadata ──────────────────────────────────────────────────

describe("openclawHandler — stable metadata", () => {
  it("declares the expected slug, name, and topology", () => {
    expect(openclawHandler.slug).toBe("openclaw");
    expect(openclawHandler.name).toBe("OpenClaw");
    expect(openclawHandler.supportsNativeSubagents).toBe(true);
    expect(openclawHandler.topology.kind).toBe("k8s-deployment");
    expect(openclawHandler.topology.containerName).toBe("runtime");
    expect(openclawHandler.topology.pvcMountPath).toBe("/data");
  });

  it("declares the expected runtime capabilities", () => {
    const c = openclawHandler.capabilities;
    expect(c.needsLlm).toBe(true);
    expect(c.hasPlatforms).toBe(true);
    expect(c.hasSkills).toBe(true);
    expect(c.hasSystemPrompt).toBe(true);
    expect(c.nativeCanvas).toBe(true);
    expect(c.canvasProtocol).toBe("jarble:ui_block");
    expect(c.modelSwitch).toBe("restart");
    expect(c.chatTransport).toBe("openclaw-ws");
    expect(c.ingress?.port).toBe(18789);
    expect(c.ingress?.authStrategy).toBe("gateway-token");
  });

  it("declares the expected configFiles list (reverse-sync targets)", () => {
    const paths = openclawHandler.configFiles.map((f) => f.path);
    expect(paths).toContain("soul.md");
    expect(paths).toContain("openclaw.json");
    // skills/* is a glob pattern
    const glob = openclawHandler.configFiles.find((f) => f.isGlob);
    expect(glob?.path).toBe("skills/*");
  });

  it("getTerminalBanner / getShellAlias / getPromptLabel return non-empty strings", () => {
    // These are wired through routes/terminal.ts (JAR-99 LOW #2). A
    // regression to undefined would crash that route.
    expect(openclawHandler.getTerminalBanner!()).toContain("OpenClaw");
    expect(openclawHandler.getShellAlias!()).toContain("openclaw");
    expect(openclawHandler.getPromptLabel!()).toBe("openclaw");
  });
});
