/**
 * Integration tests for the `deploymentSecrets` tRPC router.
 *
 * The router manages user/agent-defined env-var-style secrets
 * attached to a deployment. Three contracts are pinned:
 *
 *   1. **Cross-creator authz** — every procedure goes through
 *      `findDeploymentByCreator` (JAR-89 §10). A user MUST NOT
 *      be able to read, write, or delete another user's
 *      deployment secrets even with knowledge of the deployment
 *      ID. NOT_FOUND is preferred over UNAUTHORIZED so the
 *      caller can't probe for existence.
 *
 *   2. **Key validation + reserved-name blocklist** — the
 *      regex `^[A-Z][A-Z0-9_]{0,127}$` enforces ENV-var-style
 *      keys; the RESERVED_ENV_VARS Set blocks 28 names that
 *      the platform itself manages. A regression that loosened
 *      either gate would let a user shadow `OPENROUTER_API_KEY`
 *      or `DEPLOYMENT_ID` and break their own pod's runtime.
 *
 *   3. **Scope-aware encryption** — `shared` and `bot` scopes
 *      are server-side encrypted with `encryptApiKey` (AES-256-
 *      GCM); `user` scope stores the value as-is because the
 *      client already encrypted it client-side and the server
 *      can't decrypt. The masked-value display path branches
 *      on this. A regression that ran `decryptApiKey` on the
 *      `user` scope would silently fail and surface as `****`
 *      (see masked-value tests below).
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import * as sqliteSchema from "../helpers/testSchema.sqlite.js";
import { createTestCaller } from "../helpers/testCaller.js";
import { TRPCError } from "@trpc/server";

const dbHolder = vi.hoisted(() => ({ db: null as any, raw: null as any }));

vi.mock("../../db/index.js", () => ({
  get db() { return dbHolder.db; },
  get tables() {
    return {
      users: sqliteSchema.users,
      deployments: sqliteSchema.deployments,
      deploymentSecrets: sqliteSchema.deploymentSecrets,
      runtimeCatalog: sqliteSchema.runtimeCatalog,
    };
  },
  dbDate: () => new Date().toISOString(),
}));

vi.mock("../../services/configSync.js", () => ({
  syncConfigsToPvc: vi.fn().mockResolvedValue(undefined),
}));

const mockEncrypt = vi.fn((v: string) => `enc:${v}`);
const mockDecrypt = vi.fn((v: string) => v.startsWith("enc:") ? v.slice(4) : (() => { throw new Error("not encrypted"); })());

vi.mock("../../utils/encryption.js", () => ({
  encryptApiKey: (v: string) => mockEncrypt(v),
  decryptApiKey: (v: string) => mockDecrypt(v),
}));

vi.mock("../../utils/env.js", () => ({
  env: {
    DATABASE_URL: "postgres://test",
    AUTH0_DOMAIN: "test.auth0.com",
    AUTH0_AUDIENCE: "https://api.jarble.ai",
    OPENROUTER_API_KEY: "sk-test",
    NODE_ENV: "test",
    FRONTEND_URL: "http://localhost:3000",
    ENCRYPTION_KEY: undefined,
  },
}));

import { createTestDb } from "../helpers/testDb.js";

// ── Setup ────────────────────────────────────────────────────────────────────

const USER_A = "test-user-001";
const USER_A_AUTH0 = "auth0|test-integration-001";
const USER_B = "test-user-002";
const USER_B_AUTH0 = "auth0|other-user";

beforeEach(() => {
  if (dbHolder.raw) dbHolder.raw.close();
  const ctx = createTestDb();
  dbHolder.db = ctx.db;
  dbHolder.raw = ctx.raw;

  // Seed second user.
  ctx.raw.exec(`
    INSERT INTO users (id, email, name, auth0_id, email_verified, free_deployment_used)
    VALUES ('${USER_B}', 'other@jarble.ai', 'Other', '${USER_B_AUTH0}', 1, 0);
  `);

  vi.clearAllMocks();
  // Restore default mock behavior after clearAllMocks.
  mockEncrypt.mockImplementation((v: string) => `enc:${v}`);
  mockDecrypt.mockImplementation((v: string) => {
    if (v.startsWith("enc:")) return v.slice(4);
    throw new Error("not encrypted");
  });
});

afterAll(() => {
  if (dbHolder.raw) dbHolder.raw.close();
});

function callerA() {
  return createTestCaller(dbHolder.db, {
    id: USER_A,
    email: "test@jarble.ai",
    name: "Test",
    auth0Id: USER_A_AUTH0,
    emailVerified: true,
  });
}

function callerB() {
  return createTestCaller(dbHolder.db, {
    id: USER_B,
    email: "other@jarble.ai",
    name: "Other",
    auth0Id: USER_B_AUTH0,
    emailVerified: true,
  });
}

function seedDeployment(ownerId: string, depId = "dep-mine") {
  dbHolder.raw.prepare(`
    INSERT INTO deployments (id, user_id, name, runtime, status, is_free, monthly_price_cents, llm_mode, llm_provider, managed_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(depId, ownerId, "Test Bot", "openclaw", "running", 0, 0, "byok", "openrouter", "legacy");
  return depId;
}

// ── Cross-creator authorization ─────────────────────────────────────────────

describe("deploymentSecrets — authorization", () => {
  it("getByDeployment throws NOT_FOUND when deployment belongs to another user", async () => {
    seedDeployment(USER_B, "dep-theirs");

    await expect(callerA().deploymentSecrets.getByDeployment({ deploymentId: "dep-theirs" }))
      .rejects.toThrow(TRPCError);

    try {
      await callerA().deploymentSecrets.getByDeployment({ deploymentId: "dep-theirs" });
    } catch (err: any) {
      expect(err.code).toBe("NOT_FOUND");
    }
  });

  it("save throws NOT_FOUND when deployment belongs to another user", async () => {
    seedDeployment(USER_B, "dep-theirs");

    await expect(
      callerA().deploymentSecrets.save({
        deploymentId: "dep-theirs",
        key: "MY_KEY",
        value: "v",
        scope: "shared",
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("delete throws NOT_FOUND when deployment belongs to another user", async () => {
    seedDeployment(USER_B, "dep-theirs");

    await expect(
      callerA().deploymentSecrets.delete({ deploymentId: "dep-theirs", key: "MY_KEY" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("getByDeployment throws NOT_FOUND for a deployment that does not exist", async () => {
    await expect(
      callerA().deploymentSecrets.getByDeployment({ deploymentId: "dep-ghost" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("creator can read their own deployment's secrets", async () => {
    seedDeployment(USER_A, "dep-mine");

    const secrets = await callerA().deploymentSecrets.getByDeployment({ deploymentId: "dep-mine" });
    expect(secrets).toEqual([]);
  });
});

// ── Key validation + reserved blocklist ─────────────────────────────────────

describe("deploymentSecrets — key validation", () => {
  beforeEach(() => seedDeployment(USER_A));

  it("accepts canonical UPPERCASE_UNDERSCORE keys", async () => {
    const r = await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine",
      key: "MY_API_KEY",
      value: "v",
      scope: "shared",
    });
    expect(r.success).toBe(true);
  });

  it("rejects lowercase keys (LLM-friendly hint included)", async () => {
    await expect(
      callerA().deploymentSecrets.save({
        deploymentId: "dep-mine",
        key: "my_key",
        value: "v",
        scope: "shared",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("Invalid key format") });
  });

  it("rejects keys starting with a digit", async () => {
    await expect(
      callerA().deploymentSecrets.save({
        deploymentId: "dep-mine",
        key: "1KEY",
        value: "v",
        scope: "shared",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects keys with hyphens / dots / spaces", async () => {
    for (const key of ["MY-KEY", "MY.KEY", "MY KEY", "MY:KEY"]) {
      await expect(
        callerA().deploymentSecrets.save({
          deploymentId: "dep-mine", key, value: "v", scope: "shared",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
  });

  it("rejects keys longer than 128 chars (regex max length)", async () => {
    await expect(
      callerA().deploymentSecrets.save({
        deploymentId: "dep-mine",
        key: "A" + "A".repeat(128), // 129 chars
        value: "v",
        scope: "shared",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("accepts keys at exactly the max boundary (128 chars)", async () => {
    const r = await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine",
      key: "A" + "B".repeat(127), // 128 chars total
      value: "v",
      scope: "shared",
    });
    expect(r.success).toBe(true);
  });
});

describe("deploymentSecrets — reserved env-var blocklist", () => {
  beforeEach(() => seedDeployment(USER_A));

  // Sample of the 28 reserved names — pinning a few critical ones.
  // The full set is in src/trpc/routers/deploymentSecrets.ts:RESERVED_ENV_VARS.
  const reserved = [
    "DEPLOYMENT_ID",
    "USER_ID",
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "DISCORD_BOT_TOKEN",
    "TELEGRAM_BOT_TOKEN",
    "SLACK_BOT_TOKEN",
    "JARBLE_API_URL",
    "CONFIG_WEBHOOK_SECRET",
    "OPENCLAW_GATEWAY_TOKEN",
  ];

  it.each(reserved)("rejects reserved env var %s with a clear message", async (key) => {
    await expect(
      callerA().deploymentSecrets.save({
        deploymentId: "dep-mine",
        key,
        value: "x",
        scope: "shared",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("reserved environment variable"),
    });
  });

  it("rejects reserved keys EVEN IF the format regex passes (defense in depth)", async () => {
    // Critical: if a future regex change lets a different shape through,
    // the reserved-set check is the second line of defense.
    await expect(
      callerA().deploymentSecrets.save({
        deploymentId: "dep-mine",
        key: "OPENROUTER_API_KEY",
        value: "attacker-key",
        scope: "shared",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
});

// ── Scope-aware encryption ──────────────────────────────────────────────────

describe("deploymentSecrets — scope-aware encryption", () => {
  beforeEach(() => seedDeployment(USER_A));

  it("scope=shared → encrypts via encryptApiKey before insert", async () => {
    await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine",
      key: "API_TOKEN",
      value: "raw-value",
      scope: "shared",
    });

    expect(mockEncrypt).toHaveBeenCalledWith("raw-value");

    // DB row stores the encrypted form.
    const row = dbHolder.raw.prepare("SELECT * FROM deployment_secrets WHERE deployment_id = 'dep-mine' AND key = 'API_TOKEN'").get();
    expect((row as any).value).toBe("enc:raw-value");
    expect((row as any).scope).toBe("shared");
  });

  it("scope=bot → encrypts via encryptApiKey before insert", async () => {
    await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine",
      key: "BOT_KEY",
      value: "bot-secret",
      scope: "bot",
    });

    expect(mockEncrypt).toHaveBeenCalledWith("bot-secret");
    const row = dbHolder.raw.prepare("SELECT * FROM deployment_secrets WHERE key = 'BOT_KEY'").get();
    expect((row as any).value).toBe("enc:bot-secret");
    expect((row as any).scope).toBe("bot");
  });

  it("scope=user → stores value as-is (client pre-encrypted, server can't decrypt)", async () => {
    await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine",
      key: "USER_SECRET",
      value: "client-side-encrypted-blob",
      scope: "user",
    });

    // The encryptApiKey helper is NOT called for user scope.
    expect(mockEncrypt).not.toHaveBeenCalled();
    const row = dbHolder.raw.prepare("SELECT * FROM deployment_secrets WHERE key = 'USER_SECRET'").get();
    expect((row as any).value).toBe("client-side-encrypted-blob");
    expect((row as any).scope).toBe("user");
  });

  it("scope defaults to 'shared' when not provided", async () => {
    await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine",
      key: "DEFAULTED",
      value: "v",
    });

    const row = dbHolder.raw.prepare("SELECT * FROM deployment_secrets WHERE key = 'DEFAULTED'").get();
    expect((row as any).scope).toBe("shared");
    expect(mockEncrypt).toHaveBeenCalled();
  });
});

// ── Masked-value display ────────────────────────────────────────────────────

describe("deploymentSecrets — masked display", () => {
  beforeEach(() => seedDeployment(USER_A));

  it("masks shared/bot secrets via decrypt → maskValue", async () => {
    await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine",
      key: "LONG_SECRET",
      value: "long-secret-value-12345",
      scope: "shared",
    });

    const secrets = await callerA().deploymentSecrets.getByDeployment({ deploymentId: "dep-mine" });
    const found = secrets.find((s) => s.key === "LONG_SECRET")!;
    // Mask format: first 4 + N stars + last 4. The raw value never appears.
    expect(found.maskedValue).not.toContain("long-secret-value-12345");
    expect(found.maskedValue).toMatch(/^long.*2345$/);
  });

  it("user-scope secrets show '[client-encrypted]' placeholder (server can't decrypt)", async () => {
    await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine",
      key: "USER_SCOPED",
      value: "client-encrypted-blob",
      scope: "user",
    });

    const secrets = await callerA().deploymentSecrets.getByDeployment({ deploymentId: "dep-mine" });
    const found = secrets.find((s) => s.key === "USER_SCOPED")!;
    expect(found.maskedValue).toBe("[client-encrypted]");
    // mockDecrypt was NOT called for user scope.
    expect(mockDecrypt).not.toHaveBeenCalled();
  });

  it("shared secrets that fail to decrypt fall back to '****' (corrupted DB row)", async () => {
    // Insert a row with non-decryptable garbage directly. The router
    // should swallow the decrypt error and show a safe placeholder.
    dbHolder.raw.prepare(`
      INSERT INTO deployment_secrets (id, deployment_id, key, value, source, scope)
      VALUES ('s-bad', 'dep-mine', 'CORRUPT', 'not-encrypted-format', 'user', 'shared')
    `).run();

    const secrets = await callerA().deploymentSecrets.getByDeployment({ deploymentId: "dep-mine" });
    const found = secrets.find((s) => s.key === "CORRUPT")!;
    expect(found.maskedValue).toBe("****");
  });
});

// ── Upsert behavior ─────────────────────────────────────────────────────────

describe("deploymentSecrets — upsert", () => {
  beforeEach(() => seedDeployment(USER_A));

  it("save twice with the same key UPDATES the existing row (not double-insert)", async () => {
    await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine", key: "TOK", value: "v1", scope: "shared",
    });
    await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine", key: "TOK", value: "v2", scope: "shared",
    });

    const rows = dbHolder.raw.prepare("SELECT * FROM deployment_secrets WHERE key = 'TOK'").all();
    expect(rows).toHaveLength(1);
    expect((rows[0] as any).value).toBe("enc:v2");
  });

  it("save can change scope on existing key (shared → user)", async () => {
    await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine", key: "TOK", value: "v1", scope: "shared",
    });
    await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine", key: "TOK", value: "blob", scope: "user",
    });

    const row = dbHolder.raw.prepare("SELECT * FROM deployment_secrets WHERE key = 'TOK'").get();
    expect((row as any).scope).toBe("user");
    expect((row as any).value).toBe("blob");
  });
});

// ── Per-deployment limit (50 secrets max) ───────────────────────────────────

describe("deploymentSecrets — per-deployment limit", () => {
  beforeEach(() => seedDeployment(USER_A));

  it("enforces a max of 50 secrets per deployment on NEW insert", async () => {
    // Pre-seed 50 secrets directly so we don't burn 50 round-trips.
    for (let i = 0; i < 50; i++) {
      dbHolder.raw.prepare(`
        INSERT INTO deployment_secrets (id, deployment_id, key, value, source, scope)
        VALUES (?, 'dep-mine', ?, 'enc:v', 'user', 'shared')
      `).run(`s-${i}`, `KEY_${i}`);
    }

    await expect(
      callerA().deploymentSecrets.save({
        deploymentId: "dep-mine", key: "ONE_TOO_MANY", value: "v", scope: "shared",
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringContaining("Maximum of 50"),
    });
  });

  it("UPDATES an existing key do NOT count against the limit (no new row)", async () => {
    // Pre-seed 50 secrets including the key we're going to update.
    for (let i = 0; i < 50; i++) {
      dbHolder.raw.prepare(`
        INSERT INTO deployment_secrets (id, deployment_id, key, value, source, scope)
        VALUES (?, 'dep-mine', ?, 'enc:v', 'user', 'shared')
      `).run(`s-${i}`, `KEY_${i}`);
    }

    // Updating KEY_0 must succeed even at the cap (it doesn't add a row).
    const r = await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine", key: "KEY_0", value: "updated", scope: "shared",
    });
    expect(r.success).toBe(true);

    const count = dbHolder.raw.prepare("SELECT COUNT(*) AS n FROM deployment_secrets WHERE deployment_id = 'dep-mine'").get();
    expect((count as any).n).toBe(50);
  });
});

// ── delete ──────────────────────────────────────────────────────────────────

describe("deploymentSecrets — delete", () => {
  beforeEach(() => seedDeployment(USER_A));

  it("removes the row by deploymentId + key", async () => {
    await callerA().deploymentSecrets.save({
      deploymentId: "dep-mine", key: "TO_DELETE", value: "v", scope: "shared",
    });

    const r = await callerA().deploymentSecrets.delete({
      deploymentId: "dep-mine", key: "TO_DELETE",
    });
    expect(r.success).toBe(true);

    const rows = dbHolder.raw.prepare("SELECT * FROM deployment_secrets WHERE key = 'TO_DELETE'").all();
    expect(rows).toHaveLength(0);
  });

  it("delete is a no-op (success=true) when the key doesn't exist", async () => {
    // The current behavior is success=true for missing keys (idempotent).
    const r = await callerA().deploymentSecrets.delete({
      deploymentId: "dep-mine", key: "NEVER_EXISTED",
    });
    expect(r.success).toBe(true);
  });

  it("only deletes the matching key — siblings stay", async () => {
    await callerA().deploymentSecrets.save({ deploymentId: "dep-mine", key: "KEEP_A", value: "a", scope: "shared" });
    await callerA().deploymentSecrets.save({ deploymentId: "dep-mine", key: "DELETE_ME", value: "x", scope: "shared" });
    await callerA().deploymentSecrets.save({ deploymentId: "dep-mine", key: "KEEP_B", value: "b", scope: "shared" });

    await callerA().deploymentSecrets.delete({ deploymentId: "dep-mine", key: "DELETE_ME" });

    const remaining = dbHolder.raw.prepare("SELECT key FROM deployment_secrets WHERE deployment_id = 'dep-mine'").all();
    const keys = (remaining as any[]).map((r) => r.key).sort();
    expect(keys).toEqual(["KEEP_A", "KEEP_B"]);
  });
});
