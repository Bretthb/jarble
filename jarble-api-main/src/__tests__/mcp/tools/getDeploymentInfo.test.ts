/**
 * Unit tests for the `get_deployment_info` MCP tool.
 *
 * The tool is the bot's "show me my own status" surface — it reads
 * the pre-fetched deployment row from ctx + queries the DB for
 * connected platforms + returns a `show_status` rendering hint.
 *
 * Two contracts pinned:
 *
 *   1. **`rendersComponent: "show_status"`** — the frontend
 *      dispatches on this string to render the status card. A typo
 *      regression would break the bot's "what's my status?" flow.
 *
 *   2. **The data shape** — id, name, status, runtime, llmProvider,
 *      llmModel, llmMode, systemPrompt, description,
 *      connectedPlatforms — is the contract the show_status card
 *      reads. A field rename would silently empty out part of the
 *      card.
 *
 * The single DB query (platformCredentials by deploymentId) is
 * mocked so the test runs without DATABASE_URL.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindMany = vi.fn();

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

import { getDeploymentInfoTool } from "../../../mcp/tools/getDeploymentInfo.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockFindMany.mockReset();
});

function ctx(overrides: Partial<any> = {}): ToolContext {
  return {
    userId: "user-1",
    deploymentId: "dep-abc",
    deployment: {
      id: "dep-abc",
      name: "My Bot",
      status: "running",
      runtime: "openclaw",
      llmProvider: "openrouter",
      llmModel: "claude-sonnet-4",
      llmMode: "byok",
      systemPrompt: "You are helpful.",
      description: "Test bot",
      ...overrides,
    },
  };
}

describe("getDeploymentInfoTool — metadata", () => {
  it("registers under the name 'get_deployment_info'", () => {
    expect(getDeploymentInfoTool.name).toBe("get_deployment_info");
  });

  it("renders the show_status component", () => {
    expect(getDeploymentInfoTool.rendersComponent).toBe("show_status");
  });

  it("description mentions status / info / overview (LLM trigger keywords)", () => {
    const desc = getDeploymentInfoTool.description.toLowerCase();
    const matchesAny = ["status", "info", "overview"].some((kw) => desc.includes(kw));
    expect(matchesAny).toBe(true);
  });

  it("declares no required parameters", () => {
    expect(getDeploymentInfoTool.parameters).toEqual({ type: "object", properties: {} });
  });
});

describe("getDeploymentInfoTool — execute", () => {
  it("returns success with a human-readable message and the full data shape", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const r = await getDeploymentInfoTool.execute({}, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("My Bot");
    expect(r.message).toContain("running");
    expect(r.message).toContain("openclaw");
    // Empty platforms → "none".
    expect(r.message.toLowerCase()).toContain("none");

    expect(r.data).toEqual({
      id: "dep-abc",
      name: "My Bot",
      status: "running",
      runtime: "openclaw",
      llmProvider: "openrouter",
      llmModel: "claude-sonnet-4",
      llmMode: "byok",
      systemPrompt: "You are helpful.",
      description: "Test bot",
      connectedPlatforms: [],
    });
  });

  it("includes connected platforms in the data + message when present", async () => {
    mockFindMany.mockResolvedValueOnce([
      { platformId: "discord" },
      { platformId: "telegram" },
    ]);

    const r = await getDeploymentInfoTool.execute({}, ctx());

    expect(r.data).toMatchObject({ connectedPlatforms: ["discord", "telegram"] });
    expect(r.message).toContain("discord");
    expect(r.message).toContain("telegram");
  });

  it("renders 'none' when llmProvider / llmModel are null", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    const r = await getDeploymentInfoTool.execute(
      {},
      ctx({ llmProvider: null, llmModel: null }),
    );

    // The message includes "LLM: none/none" fallback for the bot's UX.
    expect(r.message).toContain("none/none");
  });

  it("queries platformCredentials filtered by the ctx deploymentId", async () => {
    mockFindMany.mockResolvedValueOnce([]);

    await getDeploymentInfoTool.execute({}, ctx());

    expect(mockFindMany).toHaveBeenCalledTimes(1);
    // The findMany call must include a where clause — we don't pin the
    // exact drizzle eq() shape (private to the ORM), but we verify the
    // function got called with an object that has a `where` key.
    const callArg = mockFindMany.mock.calls[0][0];
    expect(callArg).toHaveProperty("where");
  });

  it("does NOT leak ctx.userId in the response (only the deployment-row fields are surfaced)", async () => {
    // Privacy / least-disclosure: the `show_status` card is shown to
    // the user. Their own userId is fine in principle, but pinning
    // current shape means a future change that added userId would
    // need to update this assertion.
    mockFindMany.mockResolvedValueOnce([]);

    const r = await getDeploymentInfoTool.execute({}, ctx());

    expect((r.data as any).userId).toBeUndefined();
  });
});
