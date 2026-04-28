/**
 * Unit tests for two small MCP tools:
 * - `disconnect_platform` (companion to connect_platform)
 * - `get_whatsapp_qr` (initiates QR pairing)
 *
 * Both tools are small but each pin a different invariant:
 *
 *   1. **disconnect_platform — idempotent guard before delete**
 *      A regression that always deleted (even when no row existed)
 *      would still produce a success message, but the bot would
 *      report "disconnected" for a platform it was never connected
 *      to. The `findFirst → if (!existing) return` flow is the
 *      contract that lets the LLM see a friendly "X is not
 *      connected" instead of a fake success.
 *
 *   2. **get_whatsapp_qr — running-status precondition**
 *      The tool MUST refuse when the deployment is not running.
 *      The QR stream is hosted by the pod itself; if the pod
 *      isn't up there's no socket to bind to, so a fake-success
 *      here would let the user click "Scan QR" against a dead
 *      endpoint and get a confused error 30 seconds later.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mocks
const mockFindFirst = vi.fn();
const mockDelete = vi.fn();
const mockDeleteWhere = vi.fn();
const mockFindPodForDeployment = vi.fn();
const mockSyncConfigsToPvc = vi.fn();
const mockSafeFireAndForget = vi.fn();

vi.mock("../../../db/index.js", () => ({
  db: {
    query: {
      platformCredentials: { findFirst: (...args: any[]) => mockFindFirst(...args) },
    },
    delete: (...args: any[]) => {
      mockDelete(...args);
      return { where: mockDeleteWhere };
    },
  },
  tables: {
    platformCredentials: {
      deploymentId: { name: "deployment_id" },
      platformId: { name: "platform_id" },
    },
  },
}));

vi.mock("../../../k8s/index.js", () => ({
  findPodForDeployment: (...args: any[]) => mockFindPodForDeployment(...args),
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

import { disconnectPlatformTool } from "../../../mcp/tools/disconnectPlatform.js";
import { getWhatsappQrTool } from "../../../mcp/tools/getWhatsappQr.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockFindFirst.mockReset();
  mockDelete.mockReset();
  mockDeleteWhere.mockReset();
  mockFindPodForDeployment.mockReset();
  mockSyncConfigsToPvc.mockReset();
  mockSafeFireAndForget.mockReset();

  mockDeleteWhere.mockResolvedValue(undefined);
});

function ctx(overrides: Partial<any> = {}): ToolContext {
  return {
    userId: "user-1",
    deploymentId: "dep-abc",
    deployment: {
      id: "dep-abc",
      name: "My Bot",
      status: "running",
      managedBy: "legacy",
      ...overrides,
    },
  };
}

// ── disconnect_platform — metadata ──────────────────────────────────────────

describe("disconnectPlatformTool — metadata", () => {
  it("registers under the name 'disconnect_platform'", () => {
    expect(disconnectPlatformTool.name).toBe("disconnect_platform");
  });

  it("renders the show_platforms component (matches connect_platform)", () => {
    expect(disconnectPlatformTool.rendersComponent).toBe("show_platforms");
  });

  it("declares platform as required", () => {
    const params = disconnectPlatformTool.parameters as any;
    expect(params.required).toEqual(["platform"]);
  });

  it("locks platform enum to telegram/discord/slack/whatsapp (INCLUDES whatsapp, unlike connect_platform)", () => {
    // connect_platform's enum is just [telegram, discord, slack] —
    // WhatsApp uses QR pairing not credential save. But disconnect
    // covers all four because WhatsApp's pairing state ALSO lives in
    // platformCredentials and needs to be removable.
    const enumVals = (disconnectPlatformTool.parameters as any).properties.platform.enum;
    expect(enumVals).toEqual(["telegram", "discord", "slack", "whatsapp"]);
  });
});

// ── disconnect_platform — execute ───────────────────────────────────────────

describe("disconnectPlatformTool — execute", () => {
  it("rejects when platform param is missing", async () => {
    const r = await disconnectPlatformTool.execute({}, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("Missing platform");
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("rejects when no row exists for the platform (idempotence guard)", async () => {
    mockFindFirst.mockResolvedValueOnce(null);

    const r = await disconnectPlatformTool.execute({ platform: "discord" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("discord is not connected");
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockSafeFireAndForget).not.toHaveBeenCalled();
  });

  it("deletes the platformCredentials row and returns success", async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: "row-1",
      deploymentId: "dep-abc",
      platformId: "discord",
    });

    const r = await disconnectPlatformTool.execute({ platform: "discord" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("Discord has been disconnected");
    expect(r.message.toLowerCase()).toContain("restart");
    expect(mockDelete).toHaveBeenCalledTimes(1);
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
  });

  it("triggers configSync after deletion (always — disconnect always restarts)", async () => {
    mockFindFirst.mockResolvedValueOnce({
      id: "row-1",
      deploymentId: "dep-abc",
      platformId: "telegram",
    });

    await disconnectPlatformTool.execute({ platform: "telegram" }, ctx());

    expect(mockSafeFireAndForget).toHaveBeenCalledTimes(1);
    expect(mockSafeFireAndForget.mock.calls[0][1]).toMatchObject({
      operation: "syncConfigsToPvc",
      deploymentId: "dep-abc",
    });
  });

  it("capitalizes the platform name in the success message", async () => {
    // 'whatsapp' → 'Whatsapp', 'slack' → 'Slack', etc.
    for (const platform of ["telegram", "discord", "slack", "whatsapp"]) {
      vi.clearAllMocks();
      mockDeleteWhere.mockResolvedValue(undefined);
      mockFindFirst.mockResolvedValueOnce({ id: "row", deploymentId: "dep-abc", platformId: platform });

      const r = await disconnectPlatformTool.execute({ platform }, ctx());

      const expectedCapitalized = platform.charAt(0).toUpperCase() + platform.slice(1);
      expect(r.message.startsWith(expectedCapitalized)).toBe(true);
    }
  });

  it("disconnect — UNLIKE connect_platform — does NOT condition configSync on running status", async () => {
    // connect_platform does sync regardless of status; disconnect
    // does the same. Both tools want the credentials removed from
    // the on-disk config even on a stopped deployment so the next
    // start picks up the cleared state. Pin this behavior so a
    // future change that gates on `status === "running"` (matching
    // installSkill etc.) is deliberate.
    mockFindFirst.mockResolvedValueOnce({ id: "row", deploymentId: "dep-abc", platformId: "discord" });

    await disconnectPlatformTool.execute(
      { platform: "discord" },
      ctx({ status: "stopped" }),
    );

    expect(mockSafeFireAndForget).toHaveBeenCalledTimes(1);
  });
});

// ── get_whatsapp_qr — metadata ──────────────────────────────────────────────

describe("getWhatsappQrTool — metadata", () => {
  it("registers under the name 'get_whatsapp_qr'", () => {
    expect(getWhatsappQrTool.name).toBe("get_whatsapp_qr");
  });

  it("does NOT declare a rendersComponent (frontend handles QR via SSE)", () => {
    // The QR stream is rendered by a separate SSE-aware component, NOT a
    // server-emitted UI block. Pin the absence so a future addition is
    // deliberate.
    expect(getWhatsappQrTool.rendersComponent).toBeUndefined();
  });

  it("declares no required parameters", () => {
    expect((getWhatsappQrTool.parameters as any).required).toBeUndefined();
  });
});

// ── get_whatsapp_qr — execute ───────────────────────────────────────────────

describe("getWhatsappQrTool — execute", () => {
  it("rejects when the deployment is not running (precondition guard)", async () => {
    const r = await getWhatsappQrTool.execute({}, ctx({ status: "stopped" }));

    expect(r.success).toBe(false);
    expect(r.message).toContain("must be running");
    expect(r.message.toLowerCase()).toContain("start the bot");
    // K8s lookup MUST NOT happen if precondition fails.
    expect(mockFindPodForDeployment).not.toHaveBeenCalled();
  });

  it("rejects across all non-running statuses (creating, failed, pending, initializing, stopping)", async () => {
    for (const status of ["creating", "failed", "pending", "initializing", "stopping", "stopped"]) {
      vi.clearAllMocks();
      const r = await getWhatsappQrTool.execute({}, ctx({ status }));
      expect(r.success).toBe(false);
      expect(r.message).toContain("must be running");
      expect(mockFindPodForDeployment).not.toHaveBeenCalled();
    }
  });

  it("rejects when no pod is found (deployment marked running but K8s sees no pod)", async () => {
    mockFindPodForDeployment.mockResolvedValueOnce(null);

    const r = await getWhatsappQrTool.execute({}, ctx({ status: "running" }));

    expect(r.success).toBe(false);
    expect(r.message).toContain("No running pod");
  });

  it("returns success when running + pod is found, with instructions to use the QR button", async () => {
    mockFindPodForDeployment.mockResolvedValueOnce("dep-pod-1");

    const r = await getWhatsappQrTool.execute({}, ctx({ status: "running" }));

    expect(r.success).toBe(true);
    expect(r.message).toContain("WhatsApp pairing is available");
    expect(r.message).toContain("QR pairing button");
  });

  it("forwards managedBy='operator' to findPodForDeployment", async () => {
    mockFindPodForDeployment.mockResolvedValueOnce("dep-pod-1");

    await getWhatsappQrTool.execute({}, ctx({ status: "running", managedBy: "operator" }));

    const callArg = mockFindPodForDeployment.mock.calls[0][1];
    expect(callArg).toMatchObject({ managedBy: "operator", requireReady: false });
  });

  it("defaults managedBy to 'legacy' when not on the deployment row", async () => {
    mockFindPodForDeployment.mockResolvedValueOnce("dep-pod-1");

    await getWhatsappQrTool.execute({}, ctx({ status: "running", managedBy: undefined }));

    const callArg = mockFindPodForDeployment.mock.calls[0][1];
    expect(callArg.managedBy).toBe("legacy");
  });

  it("does NOT touch the DB or trigger configSync (purely a precondition + pod lookup)", async () => {
    mockFindPodForDeployment.mockResolvedValueOnce("dep-pod-1");

    await getWhatsappQrTool.execute({}, ctx({ status: "running" }));

    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockSafeFireAndForget).not.toHaveBeenCalled();
  });
});
