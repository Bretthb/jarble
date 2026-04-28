/**
 * Unit tests for the pairing MCP tool pair: `pairing_list` and
 * `pairing_approve`. Both delegate to the in-pod `openclaw
 * pairing` CLI via `execInPod`.
 *
 * Three contracts pinned:
 *
 *   1. **Platform enum is the trust boundary** — both tools
 *      reject any platform that isn't in [telegram, discord,
 *      slack, whatsapp]. A regression that loosened the check
 *      would let an attacker pass a shell-metachar string into
 *      the `npx openclaw pairing list ${platform}` exec args.
 *      The enum check is the ONLY validation between user
 *      input and the exec command line.
 *
 *   2. **JSON-parse fallback** — pairing_list expects the CLI
 *      to emit a JSON array. If the parse fails, the tool MUST
 *      fall back to returning the raw stdout instead of
 *      throwing — older OpenClaw versions emit text-formatted
 *      output with the same CLI flag. Without the fallback,
 *      every pairing_list call against an old image would
 *      surface "Failed to list pairings: Unexpected token..."
 *
 *   3. **Approve passes `--notify` flag** — the CLI must be
 *      invoked with `--notify` so the user gets a confirmation
 *      message. A regression that dropped the flag would
 *      silently approve pairings without any user feedback.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFindPodForDeployment = vi.fn();
const mockExecInPod = vi.fn();

vi.mock("../../../k8s/index.js", () => ({
  findPodForDeployment: (...args: any[]) => mockFindPodForDeployment(...args),
  execInPod: (...args: any[]) => mockExecInPod(...args),
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { pairingListTool, pairingApproveTool } from "../../../mcp/tools/pairing.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockFindPodForDeployment.mockReset();
  mockExecInPod.mockReset();
  mockFindPodForDeployment.mockResolvedValue("dep-pod-1");
});

function ctx(managedBy: any = "legacy"): ToolContext {
  return {
    userId: "user-1",
    deploymentId: "dep-abc",
    deployment: { id: "dep-abc", name: "My Bot", managedBy },
  };
}

const VALID_PLATFORMS = ["telegram", "discord", "slack", "whatsapp"] as const;

// ── Shared metadata ────────────────────────────────────────────────────────

describe("pairing tools — shared metadata", () => {
  const tools = [
    { tool: pairingListTool, name: "pairing_list" },
    { tool: pairingApproveTool, name: "pairing_approve" },
  ];

  it.each(tools)("$name has 'platform' as a required parameter", ({ tool }) => {
    const params = tool.parameters as any;
    expect(params.required).toContain("platform");
  });

  it.each(tools)("$name locks platform enum to telegram/discord/slack/whatsapp", ({ tool }) => {
    const enumVals = (tool.parameters as any).properties.platform.enum;
    expect(enumVals).toEqual(["telegram", "discord", "slack", "whatsapp"]);
  });
});

// ── Platform enum trust boundary ────────────────────────────────────────────

describe("pairing tools — platform enum trust boundary", () => {
  it("pairing_list rejects an out-of-enum platform without touching exec", async () => {
    const r = await pairingListTool.execute({ platform: "facebook" }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("Invalid platform");
    // CRITICAL: must reject BEFORE findPodForDeployment + execInPod.
    expect(mockFindPodForDeployment).not.toHaveBeenCalled();
    expect(mockExecInPod).not.toHaveBeenCalled();
  });

  it("pairing_list rejects a shell-metachar platform string", async () => {
    // The platform string flows directly into `npx openclaw pairing
    // list ${platform}`. The enum check is the only thing stopping
    // an attacker from passing `; rm -rf /` here.
    const r = await pairingListTool.execute(
      { platform: "telegram; rm -rf /" },
      ctx(),
    );
    expect(r.success).toBe(false);
    expect(r.message).toContain("Invalid platform");
    expect(mockExecInPod).not.toHaveBeenCalled();
  });

  it("pairing_approve rejects an out-of-enum platform without touching exec", async () => {
    const r = await pairingApproveTool.execute(
      { platform: "facebook", code: "1234" },
      ctx(),
    );
    expect(r.success).toBe(false);
    expect(r.message).toContain("Invalid platform");
    expect(mockExecInPod).not.toHaveBeenCalled();
  });

  it.each(VALID_PLATFORMS)("pairing_list ACCEPTS %s and calls the CLI with --json", async (platform) => {
    mockExecInPod.mockResolvedValueOnce("[]");

    await pairingListTool.execute({ platform }, ctx());

    expect(mockExecInPod).toHaveBeenCalledTimes(1);
    expect(mockExecInPod.mock.calls[0][1]).toEqual([
      "npx", "openclaw", "pairing", "list", platform, "--json",
    ]);
  });
});

// ── pairing_list — JSON parse fallback ──────────────────────────────────────

describe("pairingListTool — JSON parse fallback", () => {
  it("returns parsed array as data when CLI emits valid JSON", async () => {
    const pairings = [
      { username: "alice", code: "1234" },
      { username: "bob", code: "5678" },
    ];
    mockExecInPod.mockResolvedValueOnce(JSON.stringify(pairings));

    const r = await pairingListTool.execute({ platform: "telegram" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("2 pairing(s)");
    expect(r.data).toEqual(pairings);
  });

  it("returns 0 count for an empty JSON array", async () => {
    mockExecInPod.mockResolvedValueOnce("[]");

    const r = await pairingListTool.execute({ platform: "discord" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("0 pairing(s)");
    expect(r.data).toEqual([]);
  });

  it("falls back to raw stdout when CLI emits non-JSON (older OpenClaw versions)", async () => {
    mockExecInPod.mockResolvedValueOnce(
      "Pending pairings:\n  - alice (code: 1234)\n  - bob (code: 5678)",
    );

    const r = await pairingListTool.execute({ platform: "slack" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("Pending pairings:");
    expect(r.message).toContain("alice");
    // No data field on the fallback path — only the message.
    expect(r.data).toBeUndefined();
  });

  it("uses the platform name in the empty-fallback message when CLI returns whitespace", async () => {
    mockExecInPod.mockResolvedValueOnce("   \n  ");

    const r = await pairingListTool.execute({ platform: "whatsapp" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("No pairings found for whatsapp");
  });

  it("handles non-array JSON (object instead of array) — counts as 0", async () => {
    // Defensive: if the CLI emits an object (e.g. {error: ...}), the
    // count check uses Array.isArray and falls back to 0.
    mockExecInPod.mockResolvedValueOnce(JSON.stringify({ error: "no pairings" }));

    const r = await pairingListTool.execute({ platform: "telegram" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("0 pairing(s)");
  });
});

// ── pairing_list — error handling ───────────────────────────────────────────

describe("pairingListTool — error handling", () => {
  it("returns no-pod error when findPodForDeployment returns null", async () => {
    mockFindPodForDeployment.mockResolvedValueOnce(null);

    const r = await pairingListTool.execute({ platform: "telegram" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("No running pod");
    expect(mockExecInPod).not.toHaveBeenCalled();
  });

  it("returns success=false when execInPod throws (NEVER throws)", async () => {
    mockExecInPod.mockRejectedValueOnce(new Error("CLI not found"));

    const r = await pairingListTool.execute({ platform: "telegram" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("Failed to list pairings");
    expect(r.message).toContain("CLI not found");
  });

  it("uses operator container name when managedBy='operator'", async () => {
    mockExecInPod.mockResolvedValueOnce("[]");

    await pairingListTool.execute({ platform: "telegram" }, ctx("operator"));

    expect(mockExecInPod.mock.calls[0][2]).toBe("openclaw");
  });
});

// ── pairing_approve — required params ───────────────────────────────────────

describe("pairingApproveTool — required params", () => {
  it("declares platform AND code as required", () => {
    const params = pairingApproveTool.parameters as any;
    expect(params.required).toEqual(["platform", "code"]);
  });

  it("rejects when code is missing", async () => {
    const r = await pairingApproveTool.execute({ platform: "telegram" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("No pairing code provided");
    expect(mockFindPodForDeployment).not.toHaveBeenCalled();
    expect(mockExecInPod).not.toHaveBeenCalled();
  });

  it("rejects when code is empty string", async () => {
    const r = await pairingApproveTool.execute(
      { platform: "telegram", code: "" },
      ctx(),
    );

    expect(r.success).toBe(false);
    expect(r.message).toContain("No pairing code provided");
  });

  it("checks platform validity BEFORE checking code presence", async () => {
    // Order matters for error messages: bad-platform should win
    // over missing-code so the LLM gets the most useful first
    // error to fix.
    const r = await pairingApproveTool.execute(
      { platform: "facebook", code: undefined },
      ctx(),
    );

    expect(r.success).toBe(false);
    expect(r.message).toContain("Invalid platform");
    expect(r.message).not.toContain("No pairing code");
  });
});

// ── pairing_approve — execution ─────────────────────────────────────────────

describe("pairingApproveTool — execution", () => {
  it("invokes the CLI with the --notify flag (so the user is notified)", async () => {
    mockExecInPod.mockResolvedValueOnce("");

    await pairingApproveTool.execute(
      { platform: "telegram", code: "12345" },
      ctx(),
    );

    expect(mockExecInPod).toHaveBeenCalledTimes(1);
    expect(mockExecInPod.mock.calls[0][1]).toEqual([
      "npx", "openclaw", "pairing", "approve", "telegram", "12345", "--notify",
    ]);
  });

  it("returns success message including the platform + code", async () => {
    mockExecInPod.mockResolvedValueOnce("");

    const r = await pairingApproveTool.execute(
      { platform: "discord", code: "98765" },
      ctx(),
    );

    expect(r.success).toBe(true);
    expect(r.message).toContain("98765");
    expect(r.message).toContain("discord");
    expect(r.message).toContain("approved");
    expect(r.message).toContain("notified");
  });

  it("returns no-pod error when findPodForDeployment returns null", async () => {
    mockFindPodForDeployment.mockResolvedValueOnce(null);

    const r = await pairingApproveTool.execute(
      { platform: "telegram", code: "1234" },
      ctx(),
    );

    expect(r.success).toBe(false);
    expect(r.message).toContain("No running pod");
    expect(mockExecInPod).not.toHaveBeenCalled();
  });

  it("returns success=false when execInPod throws (NEVER throws)", async () => {
    mockExecInPod.mockRejectedValueOnce(new Error("CLI returned non-zero exit"));

    const r = await pairingApproveTool.execute(
      { platform: "telegram", code: "1234" },
      ctx(),
    );

    expect(r.success).toBe(false);
    expect(r.message).toContain("Failed to approve");
    expect(r.message).toContain("CLI returned non-zero exit");
  });

  it("does NOT pre-validate the code format — that's the CLI's job", async () => {
    // The pairing code's format/length/charset is enforced by the
    // OpenClaw CLI on the pod. The MCP tool just passes it through.
    // This test pins that current behavior so a future tightening
    // (e.g. add a regex) is deliberate and accompanied by docs.
    mockExecInPod.mockResolvedValueOnce("");

    const r = await pairingApproveTool.execute(
      { platform: "telegram", code: "anything-the-user-typed" },
      ctx(),
    );

    expect(r.success).toBe(true);
    expect(mockExecInPod.mock.calls[0][1][5]).toBe("anything-the-user-typed");
  });
});
