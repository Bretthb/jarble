/**
 * Unit tests for the `connect_platform` MCP tool.
 *
 * The tool saves messaging-platform credentials (Telegram, Discord,
 * Slack) to the platformCredentials table after encrypting them
 * with AES-256-GCM. Telegram tokens are pre-validated against the
 * Bot API's `getMe` endpoint so a typo is caught before the bot
 * restarts and fails to bind.
 *
 * Three contracts pinned:
 *
 *   1. **Encryption-before-store** — credentials MUST be encrypted
 *      via `encryptApiKey` before insert/update. A regression that
 *      stored plaintext would put bot tokens directly in the DB
 *      where they're recoverable from a backup or a SQL leak.
 *
 *   2. **Telegram pre-validation** — for `platform: "telegram"`
 *      with a botToken, the tool calls `api.telegram.org/bot{...}/getMe`
 *      and rejects on `data.ok !== true`. Without this, a typoed
 *      token would silently land on disk and the bot would crash
 *      on the next config-sync.
 *
 *   3. **Upsert pattern** — existing platform credentials are
 *      UPDATEd in place; new ones are INSERTed with a fresh nanoid.
 *      A regression that always inserted would create duplicate
 *      rows that the runtime handler would ignore (it reads only
 *      the first match).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindFirst = vi.fn();
const mockUpdate = vi.fn();
const mockSet = vi.fn();
const mockUpdateWhere = vi.fn();
const mockInsert = vi.fn();
const mockValues = vi.fn();
const mockEncryptApiKey = vi.fn();
const mockSyncConfigsToPvc = vi.fn();
const mockSafeFireAndForget = vi.fn();
const mockFetch = vi.fn();

vi.stubGlobal("fetch", mockFetch);

vi.mock("../../../db/index.js", () => ({
  db: {
    query: {
      platformCredentials: { findFirst: (...args: any[]) => mockFindFirst(...args) },
    },
    update: (...args: any[]) => {
      mockUpdate(...args);
      return { set: mockSet };
    },
    insert: (...args: any[]) => {
      mockInsert(...args);
      return { values: mockValues };
    },
  },
  tables: {
    platformCredentials: {
      deploymentId: { name: "deployment_id" },
      platformId: { name: "platform_id" },
      id: { name: "id" },
    },
  },
  dbDate: () => "2026-04-26T00:00:00Z",
}));

vi.mock("../../../utils/encryption.js", () => ({
  encryptApiKey: (...args: any[]) => mockEncryptApiKey(...args),
}));

vi.mock("../../../services/configSync.js", () => ({
  syncConfigsToPvc: (...args: any[]) => mockSyncConfigsToPvc(...args),
}));

vi.mock("../../../utils/safeAsync.js", () => ({
  safeFireAndForget: (...args: any[]) => mockSafeFireAndForget(...args),
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { connectPlatformTool } from "../../../mcp/tools/connectPlatform.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockFindFirst.mockReset();
  mockUpdate.mockReset();
  mockSet.mockReset();
  mockUpdateWhere.mockReset();
  mockInsert.mockReset();
  mockValues.mockReset();
  mockEncryptApiKey.mockReset();
  mockSyncConfigsToPvc.mockReset();
  mockSafeFireAndForget.mockReset();
  mockFetch.mockReset();

  // Defaults: no existing row, encryption returns prefixed string,
  // chained set/values resolve to undefined.
  mockFindFirst.mockResolvedValue(null);
  mockEncryptApiKey.mockReturnValue("enc:ciphertext");
  mockSet.mockReturnValue({ where: (...args: any[]) => { mockUpdateWhere(...args); return Promise.resolve(); } });
  mockValues.mockResolvedValue(undefined);
  mockSyncConfigsToPvc.mockResolvedValue(undefined);
});

const ctx: ToolContext = {
  userId: "user-1",
  deploymentId: "dep-abc",
  deployment: { id: "dep-abc", name: "My Bot" },
};

// ── Metadata ────────────────────────────────────────────────────────────────

describe("connectPlatformTool — metadata", () => {
  it("registers under the name 'connect_platform'", () => {
    expect(connectPlatformTool.name).toBe("connect_platform");
  });

  it("renders the show_platforms component", () => {
    expect(connectPlatformTool.rendersComponent).toBe("show_platforms");
  });

  it("declares platform + credentials as required parameters", () => {
    const params = connectPlatformTool.parameters as any;
    expect(params.required).toEqual(["platform", "credentials"]);
  });

  it("locks platform enum to telegram/discord/slack (NOT whatsapp — QR pairing is separate)", () => {
    const presetEnum = (connectPlatformTool.parameters as any).properties.platform.enum;
    expect(presetEnum).toEqual(["telegram", "discord", "slack"]);
  });
});

// ── Required-param guards ──────────────────────────────────────────────────

describe("connectPlatformTool — required-param guards", () => {
  it("rejects when platform is missing", async () => {
    const r = await connectPlatformTool.execute({ credentials: { botToken: "t" } }, ctx);
    expect(r.success).toBe(false);
    expect(r.message).toContain("Missing platform");
    expect(mockFetch).not.toHaveBeenCalled();
    expect(mockEncryptApiKey).not.toHaveBeenCalled();
  });

  it("rejects when credentials is missing", async () => {
    const r = await connectPlatformTool.execute({ platform: "telegram" }, ctx);
    expect(r.success).toBe(false);
    expect(r.message).toContain("Missing");
    expect(mockEncryptApiKey).not.toHaveBeenCalled();
  });
});

// ── Telegram pre-validation ─────────────────────────────────────────────────

describe("connectPlatformTool — Telegram pre-validation", () => {
  it("calls getMe with the provided botToken before storing", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: true, result: { id: 1, is_bot: true } }),
    });

    await connectPlatformTool.execute(
      { platform: "telegram", credentials: { botToken: "12345:ABC-DEF" } },
      ctx,
    );

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("api.telegram.org/bot12345:ABC-DEF/getMe");
  });

  it("rejects when getMe returns ok=false", async () => {
    mockFetch.mockResolvedValueOnce({
      json: async () => ({ ok: false, description: "Unauthorized" }),
    });

    const r = await connectPlatformTool.execute(
      { platform: "telegram", credentials: { botToken: "bad-token" } },
      ctx,
    );

    expect(r.success).toBe(false);
    expect(r.message).toContain("Invalid Telegram bot token");
    expect(r.message).toContain("Unauthorized");
    // No DB write on validation failure.
    expect(mockEncryptApiKey).not.toHaveBeenCalled();
  });

  it("rejects when fetch throws (network failure)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const r = await connectPlatformTool.execute(
      { platform: "telegram", credentials: { botToken: "any" } },
      ctx,
    );

    expect(r.success).toBe(false);
    expect(r.message).toContain("Failed to validate");
    expect(mockEncryptApiKey).not.toHaveBeenCalled();
  });

  it("does NOT pre-validate Discord (Discord API has no equivalent unauth-friendly probe)", async () => {
    await connectPlatformTool.execute(
      { platform: "discord", credentials: { botToken: "discord-token" } },
      ctx,
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("does NOT pre-validate Slack (Slack auth.test would expose another secret)", async () => {
    await connectPlatformTool.execute(
      { platform: "slack", credentials: { botToken: "xoxb-x", appToken: "xapp-x" } },
      ctx,
    );

    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// ── Encryption + Upsert ─────────────────────────────────────────────────────

describe("connectPlatformTool — encryption + upsert", () => {
  it("encrypts the credentials object as JSON before storing (NEVER plaintext)", async () => {
    await connectPlatformTool.execute(
      { platform: "discord", credentials: { botToken: "secret-bot-token" } },
      ctx,
    );

    expect(mockEncryptApiKey).toHaveBeenCalledTimes(1);
    const arg = mockEncryptApiKey.mock.calls[0][0];
    // The argument is the JSON-stringified credentials object — not
    // the raw token. The DB never sees plaintext.
    expect(arg).toBe(JSON.stringify({ botToken: "secret-bot-token" }));
  });

  it("INSERTs a new row with nanoid id when no existing platformCredential row matches", async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    await connectPlatformTool.execute(
      { platform: "discord", credentials: { botToken: "x" } },
      ctx,
    );

    expect(mockInsert).toHaveBeenCalledTimes(1);
    expect(mockUpdate).not.toHaveBeenCalled();

    const insertedRow = mockValues.mock.calls[0][0];
    expect(insertedRow.deploymentId).toBe("dep-abc");
    expect(insertedRow.platformId).toBe("discord");
    expect(insertedRow.credentials).toBe("enc:ciphertext");
    // nanoid id is present.
    expect(typeof insertedRow.id).toBe("string");
    expect(insertedRow.id.length).toBeGreaterThan(0);
  });

  it("UPDATEs an existing row when one matches (no duplicate insert)", async () => {
    mockFindFirst.mockResolvedValueOnce({ id: "existing-row-1", credentials: "enc:old" });

    await connectPlatformTool.execute(
      { platform: "discord", credentials: { botToken: "new-token" } },
      ctx,
    );

    expect(mockUpdate).toHaveBeenCalledTimes(1);
    expect(mockInsert).not.toHaveBeenCalled();

    // The set() received the new encrypted credentials + a fresh updatedAt.
    const setArg = mockSet.mock.calls[0][0];
    expect(setArg.credentials).toBe("enc:ciphertext");
    expect(setArg.updatedAt).toBe("2026-04-26T00:00:00Z");
  });

  it("returns success message with the platform name capitalized", async () => {
    const r = await connectPlatformTool.execute(
      { platform: "discord", credentials: { botToken: "x" } },
      ctx,
    );

    expect(r.success).toBe(true);
    expect(r.message).toContain("Discord credentials saved");
    expect(r.message.toLowerCase()).toContain("restart");
  });

  it("triggers config sync to PVC fire-and-forget after a successful write", async () => {
    await connectPlatformTool.execute(
      { platform: "discord", credentials: { botToken: "x" } },
      ctx,
    );

    expect(mockSafeFireAndForget).toHaveBeenCalledTimes(1);
    const ctx2 = mockSafeFireAndForget.mock.calls[0][1];
    expect(ctx2.operation).toBe("syncConfigsToPvc");
    expect(ctx2.deploymentId).toBe("dep-abc");
  });
});
