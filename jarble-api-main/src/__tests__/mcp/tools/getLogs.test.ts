/**
 * Unit tests for the `get_logs` MCP tool.
 *
 * Fetches recent pod logs via `getDeploymentLogs`. Two contracts
 * pinned:
 *
 *   1. **Lines bound clamping** — `lines` parameter is clamped to
 *      [1, 200]. Without this, the bot could request 100k lines
 *      and OOM the API pod. Default is 50.
 *
 *   2. **Pod-not-running surfaces as `success: false`** —
 *      `getDeploymentLogs` throws when there's no pod or the K8s
 *      API can't read it. The tool catches and returns a friendly
 *      error so the chat turn doesn't crash.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetDeploymentLogs = vi.fn();

vi.mock("../../../k8s/index.js", () => ({
  getDeploymentLogs: (...args: any[]) => mockGetDeploymentLogs(...args),
}));

vi.mock("../../../utils/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { getLogsTool } from "../../../mcp/tools/getLogs.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockGetDeploymentLogs.mockReset();
});

function ctx(managedBy: any = "legacy"): ToolContext {
  return {
    userId: "user-1",
    deploymentId: "dep-abc",
    deployment: { id: "dep-abc", name: "My Bot", managedBy },
  };
}

describe("getLogsTool — metadata", () => {
  it("registers under the name 'get_logs'", () => {
    expect(getLogsTool.name).toBe("get_logs");
  });

  it("renders the show_logs component", () => {
    expect(getLogsTool.rendersComponent).toBe("show_logs");
  });

  it("declares 'lines' as the only parameter (optional)", () => {
    const params = getLogsTool.parameters as any;
    expect(params.properties.lines).toBeDefined();
    expect(params.required).toBeUndefined();
  });
});

describe("getLogsTool — lines clamping", () => {
  it("defaults to 50 lines when no lines param is provided", async () => {
    mockGetDeploymentLogs.mockResolvedValueOnce({ logs: "line1\nline2", podName: "pod-1" });

    await getLogsTool.execute({}, ctx());

    expect(mockGetDeploymentLogs).toHaveBeenCalledWith("dep-abc", 50, "legacy");
  });

  it("clamps requested lines to a max of 200 (OOM defense)", async () => {
    mockGetDeploymentLogs.mockResolvedValueOnce({ logs: "", podName: "pod-1" });

    await getLogsTool.execute({ lines: 10000 }, ctx());

    expect(mockGetDeploymentLogs).toHaveBeenCalledWith("dep-abc", 200, "legacy");
  });

  it("treats lines=0 as the default 50 (the `Number(0) || 50` short-circuit fires)", async () => {
    // The implementation is `Math.min(Math.max(Number(params.lines) || 50, 1), 200)`.
    // For 0: Number(0) is 0 → falsy → || 50 wins → 50 (NOT 1).
    // Pinning this current behavior so a future change to use ?? 50
    // (which would let 0 through and then clamp to 1) is a deliberate
    // choice with a matching test update.
    mockGetDeploymentLogs.mockResolvedValueOnce({ logs: "x", podName: "pod-1" });

    await getLogsTool.execute({ lines: 0 }, ctx());

    expect(mockGetDeploymentLogs).toHaveBeenCalledWith("dep-abc", 50, "legacy");
  });

  it("clamps negative lines to a min of 1", async () => {
    // For -5: Number(-5) is -5 → truthy → keeps -5 → Math.max(-5, 1) → 1.
    mockGetDeploymentLogs.mockResolvedValueOnce({ logs: "x", podName: "pod-1" });

    await getLogsTool.execute({ lines: -5 }, ctx());

    expect(mockGetDeploymentLogs).toHaveBeenCalledWith("dep-abc", 1, "legacy");
  });

  it("treats non-numeric lines as the default 50", async () => {
    mockGetDeploymentLogs.mockResolvedValueOnce({ logs: "", podName: "pod-1" });

    await getLogsTool.execute({ lines: "abc" }, ctx());

    expect(mockGetDeploymentLogs).toHaveBeenCalledWith("dep-abc", 50, "legacy");
  });

  it("passes through valid mid-range values unchanged", async () => {
    mockGetDeploymentLogs.mockResolvedValueOnce({ logs: "", podName: "pod-1" });

    await getLogsTool.execute({ lines: 100 }, ctx());

    expect(mockGetDeploymentLogs).toHaveBeenCalledWith("dep-abc", 100, "legacy");
  });
});

describe("getLogsTool — managedBy", () => {
  it("forwards managedBy='operator' to getDeploymentLogs", async () => {
    mockGetDeploymentLogs.mockResolvedValueOnce({ logs: "", podName: "pod-1" });

    await getLogsTool.execute({ lines: 50 }, ctx("operator"));

    expect(mockGetDeploymentLogs).toHaveBeenCalledWith("dep-abc", 50, "operator");
  });

  it("defaults managedBy to 'legacy' when not on the deployment row", async () => {
    mockGetDeploymentLogs.mockResolvedValueOnce({ logs: "", podName: "pod-1" });

    await getLogsTool.execute({}, ctx(undefined));

    expect(mockGetDeploymentLogs).toHaveBeenCalledWith("dep-abc", 50, "legacy");
  });
});

describe("getLogsTool — output shape", () => {
  it("returns success with line count + podName when logs come back", async () => {
    mockGetDeploymentLogs.mockResolvedValueOnce({
      logs: "line 1\nline 2\nline 3",
      podName: "pod-abc-1",
    });

    const r = await getLogsTool.execute({}, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("3 log lines");
    expect(r.message).toContain("pod-abc-1");
    expect(r.data).toEqual({ logs: "line 1\nline 2\nline 3", podName: "pod-abc-1" });
  });

  it("filters empty lines from the count (Boolean-truthy filter)", async () => {
    mockGetDeploymentLogs.mockResolvedValueOnce({
      logs: "line 1\n\nline 2\n\n\n",
      podName: "pod-1",
    });

    const r = await getLogsTool.execute({}, ctx());

    // Only 2 non-empty lines, even though the raw output has more newlines.
    expect(r.message).toContain("2 log lines");
  });

  it("returns success=false with friendly error when getDeploymentLogs throws", async () => {
    mockGetDeploymentLogs.mockRejectedValueOnce(new Error("No pods found"));

    const r = await getLogsTool.execute({}, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("Could not fetch logs");
    expect(r.message).toContain("No pods found");
    expect(r.message).toContain("pod may not be running");
  });

  it("does NOT throw — chat turn must not crash on log-fetch failure", async () => {
    mockGetDeploymentLogs.mockRejectedValueOnce(new Error("kaboom"));

    await expect(getLogsTool.execute({}, ctx())).resolves.toBeDefined();
  });

  it("handles non-Error rejection (string, etc.)", async () => {
    mockGetDeploymentLogs.mockRejectedValueOnce("string-error");

    const r = await getLogsTool.execute({}, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("string-error");
  });
});
