/**
 * Unit tests for the `get_platforms` MCP tool.
 *
 * The tool is the read-side counterpart to `connect_platform`. It
 * lists every connected messaging platform with masked credentials
 * (so the bot can show "your Slack is connected" without ever
 * leaking the actual token to the LLM context). Two contracts:
 *
 *   1. **Credentials are NEVER returned in plaintext** — the
 *      decrypt → mask pipeline is the security boundary that
 *      keeps secrets out of the bot's context window. A
 *      regression that returned the raw decrypted token would
 *      leak it into transcripts and chat-session storage.
 *
 *   2. **Disconnected platforms surface as a complement set** of
 *      the canonical list ["telegram", "discord", "slack",
 *      "whatsapp"]. Lets the bot answer "what can I connect?"
 *      from the same tool call.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();
const mockDecryptApiKey = vi.fn();

vi.mock("../../../db/index.js", () => ({
  db: {
    query: {
      platformCredentials: { findMany: (...args: any[]) => mockFindMany(...args) },
    },
  },
  tables: {
    platformCredentials: { deploymentId: { name: "deployment_id" } },
  },
}));

vi.mock("../../../utils/encryption.js", () => ({
  decryptApiKey: (...args: any[]) => mockDecryptApiKey(...args),
}));

import { getPlatformsTool } from "../../../mcp/tools/getPlatforms.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockFindMany.mockReset();
  mockDecryptApiKey.mockReset();
});

const ctx: ToolContext = {
  userId: "user-1",
  deploymentId: "dep-abc",
  deployment: { id: "dep-abc", name: "My Bot" },
};

describe("getPlatformsTool — metadata", () => {
  it("registers under the name 'get_platforms'", () => {
    expect(getPlatformsTool.name).toBe("get_platforms");
  });

  it("renders the show_platforms component", () => {
    expect(getPlatformsTool.rendersComponent).toBe("show_platforms");
  });

  it("declares no required parameters (read-only tool)", () => {
    expect(getPlatformsTool.parameters).toEqual({ type: "object", properties: {} });
  });
});

describe("getPlatformsTool — output shape", () => {
  it("returns 'none' when no platforms are connected, all four in disconnected", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const r = await getPlatformsTool.execute({}, ctx);

    expect(r.success).toBe(true);
    expect(r.message).toContain("Connected platforms: none");
    expect((r.data as any).connected).toEqual([]);
    expect((r.data as any).disconnected).toEqual([
      "telegram", "discord", "slack", "whatsapp",
    ]);
  });

  it("lists connected platforms with masked credentials", async () => {
    mockFindMany.mockResolvedValueOnce([
      { platformId: "telegram", credentials: "enc:tg" },
      { platformId: "discord", credentials: "enc:dc" },
    ]);
    mockDecryptApiKey
      .mockReturnValueOnce(JSON.stringify({ botToken: "12345:LongTelegramTokenAAAA" }))
      .mockReturnValueOnce(JSON.stringify({ botToken: "discord-secret-token-1234" }));

    const r = await getPlatformsTool.execute({}, ctx);

    expect(r.success).toBe(true);
    expect(r.message).toContain("telegram, discord");
    expect((r.data as any).connected).toHaveLength(2);
    // Disconnected = canonical 4 minus the 2 connected.
    expect((r.data as any).disconnected.sort()).toEqual(["slack", "whatsapp"].sort());
  });

  it("masks credentials — the raw decrypted token is NEVER in the output", async () => {
    const raw = "12345:LongTelegramTokenAAAA";
    mockFindMany.mockResolvedValueOnce([
      { platformId: "telegram", credentials: "enc:tg" },
    ]);
    mockDecryptApiKey.mockReturnValueOnce(JSON.stringify({ botToken: raw }));

    const r = await getPlatformsTool.execute({}, ctx);

    const serialized = JSON.stringify(r);
    // Critical: the raw token MUST NOT appear anywhere in the response.
    expect(serialized).not.toContain(raw);
    // The masked form preserves the first 4 + last 4 chars.
    const masked = (r.data as any).connected[0].maskedCredentials.botToken as string;
    expect(masked.startsWith("1234")).toBe(true);
    expect(masked.endsWith("AAAA")).toBe(true);
    expect(masked).toContain("*");
  });

  it("uses '****' fallback for short credentials (≤10 chars)", async () => {
    mockFindMany.mockResolvedValueOnce([
      { platformId: "discord", credentials: "enc:short" },
    ]);
    mockDecryptApiKey.mockReturnValueOnce(JSON.stringify({ botToken: "abc123" }));

    const r = await getPlatformsTool.execute({}, ctx);

    expect((r.data as any).connected[0].maskedCredentials.botToken).toBe("****");
  });

  it("handles decryption failure gracefully — platform appears with empty masked creds", async () => {
    mockFindMany.mockResolvedValueOnce([
      { platformId: "discord", credentials: "enc:bogus" },
    ]);
    mockDecryptApiKey.mockImplementationOnce(() => {
      throw new Error("decrypt failed");
    });

    const r = await getPlatformsTool.execute({}, ctx);

    // Tool must NOT throw — caller is in the chat turn.
    expect(r.success).toBe(true);
    expect((r.data as any).connected[0].platformId).toBe("discord");
    expect((r.data as any).connected[0].maskedCredentials).toEqual({});
  });

  it("masks Slack BOTH botToken and appToken", async () => {
    mockFindMany.mockResolvedValueOnce([
      { platformId: "slack", credentials: "enc:slack" },
    ]);
    mockDecryptApiKey.mockReturnValueOnce(JSON.stringify({
      botToken: "xoxb-AAAAAAAAAAAA-BBBBBBBBBBBB",
      appToken: "xapp-CCCCCCCCCCCC-DDDDDDDDDDDD",
    }));

    const r = await getPlatformsTool.execute({}, ctx);
    const masked = (r.data as any).connected[0].maskedCredentials;

    expect(masked.botToken).toMatch(/\*/);
    expect(masked.appToken).toMatch(/\*/);
    expect(masked.botToken).not.toContain("AAAAAAAAAAAA");
    expect(masked.appToken).not.toContain("CCCCCCCCCCCC");
  });

  it("queries the DB filtered by ctx.deploymentId", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await getPlatformsTool.execute({}, ctx);

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    expect(mockFindMany.mock.calls[0][0]).toHaveProperty("where");
  });
});
