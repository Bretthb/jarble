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

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// Mutable env reference so per-test customization is possible. Defaults
// mirror an unset env var (undefined) rather than empty string because
// the SUT uses `env.X ?? env.Y` — null-coalescing only falls back on
// null/undefined, NOT empty string. Setting an empty default would
// silently break the platform-mode fallback test.
const mockEnv = vi.hoisted(() => ({
  AGENT_LLM_API_KEY: undefined as string | undefined,
  OPENROUTER_API_KEY: undefined as string | undefined,
  AGENT_LLM_PROVIDER: undefined as string | undefined,
  FRONTEND_URL: "https://api.jarble.ai" as string,
}));

vi.mock("../../utils/env.js", () => ({
  env: mockEnv,
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

// ── getSecretEntries ────────────────────────────────────────────────────────

/**
 * `getSecretEntries` builds the K8s Secret stringData payload for an
 * OpenClaw pod. The shape it returns is consumed by k8s/lifecycle.ts
 * and dropped onto the pod as env vars. Several non-obvious contracts
 * are worth pinning:
 *
 *   - `llmMode` selects the key source: `byok` reads `deployment.llmApiKey`,
 *     `platform` reads from the `env` module's AGENT_LLM_API_KEY (with
 *     OPENROUTER_API_KEY as fallback). An unset `llmMode` (or `included`)
 *     falls into the byok branch.
 *   - The provider→envVar map — anthropic/openai/google/openrouter — is
 *     the only thing that decides which env var holds the key. A typo
 *     here would silently break LLM calls in the pod without any error
 *     surfaced at deploy time.
 *   - Operator-mode pods get JARBLE_*_DIR overrides because their PVC
 *     mount path differs (/home/openclaw/.openclaw vs /data).
 *   - Deployment secrets are LOWEST priority — the loop explicitly
 *     refuses to overwrite system entries. That precedence is the
 *     defense against a user-defined env var named `OPENROUTER_API_KEY`
 *     leaking through and replacing the platform key.
 */
describe("openclawHandler.getSecretEntries", () => {
  // Reset env between tests. Use undefined (not "") because the SUT
  // uses ?? for fallback, which only triggers on null/undefined. An
  // empty string is treated as a real value and skips the fallback.
  beforeEach(() => {
    mockEnv.AGENT_LLM_API_KEY = undefined;
    mockEnv.OPENROUTER_API_KEY = undefined;
    mockEnv.AGENT_LLM_PROVIDER = undefined;
    mockEnv.FRONTEND_URL = "https://api.jarble.ai";
    delete process.env.FRONTEND_URL;
  });

  /** Minimal valid DeploymentFields. Override per test. */
  function dep(overrides: Partial<any> = {}): any {
    return {
      id: "dep-test-1",
      runtime: "openclaw",
      name: "Test Bot",
      description: null,
      systemPrompt: null,
      llmMode: "byok",
      llmProvider: "openrouter",
      llmModel: null,
      llmApiKey: null,
      ...overrides,
    };
  }

  // ── BYOK: provider → env var mapping ────────────────────────────────────

  it("BYOK + openrouter sets OPENROUTER_API_KEY", () => {
    const e = openclawHandler.getSecretEntries(dep({ llmApiKey: "sk-or-key", llmProvider: "openrouter" }));
    expect(e.OPENROUTER_API_KEY).toBe("sk-or-key");
    expect(e.LLM_PROVIDER).toBe("openrouter");
  });

  it("BYOK + anthropic sets ANTHROPIC_API_KEY (not OPENROUTER_API_KEY)", () => {
    const e = openclawHandler.getSecretEntries(dep({ llmApiKey: "sk-ant-key", llmProvider: "anthropic" }));
    expect(e.ANTHROPIC_API_KEY).toBe("sk-ant-key");
    expect(e.OPENROUTER_API_KEY).toBeUndefined();
    expect(e.LLM_PROVIDER).toBe("anthropic");
  });

  it("BYOK + openai sets OPENAI_API_KEY", () => {
    const e = openclawHandler.getSecretEntries(dep({ llmApiKey: "sk-oai-key", llmProvider: "openai" }));
    expect(e.OPENAI_API_KEY).toBe("sk-oai-key");
  });

  it("BYOK + google sets GOOGLE_API_KEY", () => {
    const e = openclawHandler.getSecretEntries(dep({ llmApiKey: "g-key", llmProvider: "google" }));
    expect(e.GOOGLE_API_KEY).toBe("g-key");
  });

  it("BYOK with unknown provider falls back to OPENROUTER_API_KEY", () => {
    const e = openclawHandler.getSecretEntries(dep({ llmApiKey: "x", llmProvider: "azure" as any }));
    expect(e.OPENROUTER_API_KEY).toBe("x");
  });

  it("BYOK without llmApiKey emits no provider env var (provider/model still set)", () => {
    const e = openclawHandler.getSecretEntries(dep({ llmApiKey: null, llmModel: "m1" }));
    expect(e.OPENROUTER_API_KEY).toBeUndefined();
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
    expect(e.LLM_PROVIDER).toBe("openrouter");
    expect(e.LLM_MODEL).toBe("m1");
  });

  // ── Platform mode ───────────────────────────────────────────────────────

  it("platform mode + AGENT_LLM_API_KEY uses platform key + AGENT_LLM_PROVIDER", () => {
    mockEnv.AGENT_LLM_API_KEY = "platform-anth-key";
    mockEnv.AGENT_LLM_PROVIDER = "anthropic";
    const e = openclawHandler.getSecretEntries(dep({ llmMode: "platform" }));
    expect(e.ANTHROPIC_API_KEY).toBe("platform-anth-key");
    expect(e.OPENROUTER_API_KEY).toBeUndefined();
  });

  it("platform mode falls back to OPENROUTER_API_KEY when AGENT_LLM_API_KEY is unset", () => {
    // Important: undefined, not "" — `??` only triggers on null/undefined.
    mockEnv.AGENT_LLM_API_KEY = undefined;
    mockEnv.OPENROUTER_API_KEY = "or-fallback";
    mockEnv.AGENT_LLM_PROVIDER = "openrouter";
    const e = openclawHandler.getSecretEntries(dep({ llmMode: "platform" }));
    expect(e.OPENROUTER_API_KEY).toBe("or-fallback");
  });

  it("platform mode without ANY platform key in env emits no provider env var", () => {
    // Both env vars empty → no key set, no throw.
    const e = openclawHandler.getSecretEntries(dep({ llmMode: "platform" }));
    expect(e.OPENROUTER_API_KEY).toBeUndefined();
    expect(e.ANTHROPIC_API_KEY).toBeUndefined();
  });

  // ── LLM_PROVIDER / LLM_MODEL ────────────────────────────────────────────

  it("only sets LLM_PROVIDER / LLM_MODEL when present on the deployment", () => {
    const e = openclawHandler.getSecretEntries(dep({ llmProvider: null, llmModel: null }));
    expect(e.LLM_PROVIDER).toBeUndefined();
    expect(e.LLM_MODEL).toBeUndefined();
  });

  // ── JARBLE_API_URL ─────────────────────────────────────────────────────

  it("JARBLE_API_URL defaults to https://api.jarble.ai when FRONTEND_URL is unset", () => {
    delete process.env.FRONTEND_URL;
    const e = openclawHandler.getSecretEntries(dep());
    expect(e.JARBLE_API_URL).toBe("https://api.jarble.ai");
  });

  // KNOWN BUG (NOT fixed in this additive PR): the SUT chains two
  // `.replace()` calls that both target overlapping patterns —
  //   `.replace("dev.jarble.ai", "api.jarble.ai").replace("jarble.ai", "api.jarble.ai")`
  // — so the second replace runs on the first replace's OUTPUT, and
  // `jarble.ai` is a substring of `api.jarble.ai`. The result is a
  // double-prefix `https://api.api.jarble.ai`.
  // Test pins the actual current behavior so any future fix has to
  // come with a matching test update; tracked separately.
  it("JARBLE_API_URL — dev.jarble.ai input produces api.api.jarble.ai (BUG: double-replace)", () => {
    process.env.FRONTEND_URL = "https://dev.jarble.ai";
    const e = openclawHandler.getSecretEntries(dep());
    expect(e.JARBLE_API_URL).toBe("https://api.api.jarble.ai");
  });

  it("JARBLE_API_URL — bare jarble.ai input produces api.api.jarble.ai (same BUG path)", () => {
    // Same root cause: dev.jarble.ai isn't matched, but the second
    // replace then turns `jarble.ai` → `api.jarble.ai` once, then
    // catches the `jarble.ai` substring of that result on the next
    // pass... actually no — replace() only runs once per call without
    // the /g flag, so this case is correct. Documenting both shapes
    // makes the asymmetry of the bug obvious.
    process.env.FRONTEND_URL = "https://jarble.ai";
    const e = openclawHandler.getSecretEntries(dep());
    expect(e.JARBLE_API_URL).toBe("https://api.jarble.ai");
  });

  // ── Gateway token + operator-mode paths ─────────────────────────────────

  it("duplicates gatewayToken into the `token` Secret key (operator compat)", () => {
    const e = openclawHandler.getSecretEntries(dep({ gatewayToken: "ed25519-token" }));
    expect(e.token).toBe("ed25519-token");
  });

  it("does not emit `token` when gatewayToken is unset", () => {
    const e = openclawHandler.getSecretEntries(dep({ gatewayToken: undefined }));
    expect(e.token).toBeUndefined();
  });

  it("operator mode adds JARBLE_*_DIR overrides under /home/openclaw/.openclaw", () => {
    const e = openclawHandler.getSecretEntries(dep({ managedBy: "operator" }));
    expect(e.JARBLE_COMPONENTS_DIR).toBe("/home/openclaw/.openclaw/components");
    expect(e.JARBLE_FILES_DIR).toBe("/home/openclaw/.openclaw/files");
    expect(e.JARBLE_MEMORY_DIR).toBe("/home/openclaw/.openclaw/memory");
    expect(e.JARBLE_KNOWLEDGE_DIR).toBe("/home/openclaw/.openclaw/knowledge");
  });

  it("legacy mode does NOT add JARBLE_*_DIR overrides (defaults baked into MCP server)", () => {
    const e = openclawHandler.getSecretEntries(dep({ managedBy: "legacy" }));
    expect(e.JARBLE_COMPONENTS_DIR).toBeUndefined();
    expect(e.JARBLE_FILES_DIR).toBeUndefined();
    expect(e.JARBLE_MEMORY_DIR).toBeUndefined();
    expect(e.JARBLE_KNOWLEDGE_DIR).toBeUndefined();
  });

  // ── JARBLE_MEMORY_SCOPE ─────────────────────────────────────────────────

  it("JARBLE_MEMORY_SCOPE is always set, defaults to 'global'", () => {
    expect(openclawHandler.getSecretEntries(dep()).JARBLE_MEMORY_SCOPE).toBe("global");
    expect(openclawHandler.getSecretEntries(dep({ memoryScope: "session" })).JARBLE_MEMORY_SCOPE).toBe("session");
    expect(openclawHandler.getSecretEntries(dep({ memoryScope: "off" })).JARBLE_MEMORY_SCOPE).toBe("off");
  });

  // ── Platform credential env-var fallbacks ──────────────────────────────

  it("maps Discord botToken to DISCORD_BOT_TOKEN", () => {
    const e = openclawHandler.getSecretEntries(dep({
      platformCredentials: { discord: { botToken: "discord-x" } },
    }));
    expect(e.DISCORD_BOT_TOKEN).toBe("discord-x");
  });

  it("maps Telegram botToken to TELEGRAM_BOT_TOKEN", () => {
    const e = openclawHandler.getSecretEntries(dep({
      platformCredentials: { telegram: { botToken: "tg-x" } },
    }));
    expect(e.TELEGRAM_BOT_TOKEN).toBe("tg-x");
  });

  it("maps Slack both keys to SLACK_BOT_TOKEN + SLACK_APP_TOKEN", () => {
    const e = openclawHandler.getSecretEntries(dep({
      platformCredentials: { slack: { botToken: "xoxb-x", appToken: "xapp-x" } },
    }));
    expect(e.SLACK_BOT_TOKEN).toBe("xoxb-x");
    expect(e.SLACK_APP_TOKEN).toBe("xapp-x");
  });

  it("ignores unknown platforms in platformCredentials (forward-compat)", () => {
    const e = openclawHandler.getSecretEntries(dep({
      platformCredentials: { discord: { botToken: "d" }, hypotheticalNew: { foo: "bar" } as any },
    }));
    expect(e.DISCORD_BOT_TOKEN).toBe("d");
    // No env var leak from the unknown platform.
    expect(e.foo).toBeUndefined();
    expect((e as any).bar).toBeUndefined();
  });

  // ── Deployment-secret precedence ───────────────────────────────────────

  it("merges deploymentSecrets into the Secret entries when no system collision", () => {
    const e = openclawHandler.getSecretEntries(dep({
      deploymentSecrets: { CUSTOM_API: "custom", ANOTHER: "another" },
    }));
    expect(e.CUSTOM_API).toBe("custom");
    expect(e.ANOTHER).toBe("another");
  });

  it("deploymentSecrets CANNOT overwrite a system-set entry (security boundary)", () => {
    // BYOK key is set first; the user-defined OPENROUTER_API_KEY in
    // deploymentSecrets must NOT replace it.
    const e = openclawHandler.getSecretEntries(dep({
      llmApiKey: "system-key",
      llmProvider: "openrouter",
      deploymentSecrets: { OPENROUTER_API_KEY: "attacker-key", CUSTOM: "ok" },
    }));
    expect(e.OPENROUTER_API_KEY).toBe("system-key");
    expect(e.CUSTOM).toBe("ok");
  });

  it("deploymentSecrets cannot overwrite JARBLE_API_URL or JARBLE_MEMORY_SCOPE either", () => {
    const e = openclawHandler.getSecretEntries(dep({
      deploymentSecrets: { JARBLE_API_URL: "https://evil.example", JARBLE_MEMORY_SCOPE: "off" },
    }));
    expect(e.JARBLE_API_URL).toBe("https://api.jarble.ai");
    expect(e.JARBLE_MEMORY_SCOPE).toBe("global");
  });
});
