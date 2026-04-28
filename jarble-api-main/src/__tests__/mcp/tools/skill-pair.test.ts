/**
 * Unit tests for the skill-management MCP tool pair:
 * `install_skill` and `uninstall_skill`.
 *
 * Both tools share a similar shape: validate the skillId, check
 * the deploymentSkills join row's existence, mutate, and trigger
 * a configSync if the pod is running. Three contracts pinned:
 *
 *   1. **Idempotence guards** — install rejects on already-
 *      installed; uninstall rejects on not-installed. A
 *      regression that allowed double-install would create
 *      duplicate join rows that the runtime handler would
 *      ignore (it joins by skillId), but would still corrupt
 *      the marketplace billing surface.
 *
 *   2. **configSync only fires when the deployment is running**
 *      — a stopped deployment has no pod to sync TO. A
 *      regression that always synced would burn credentials
 *      on dead pods and surface noisy logs.
 *
 *   3. **Catalog existence is verified BEFORE the join check**
 *      (install only) — installing a non-existent skill must
 *      fail with a clear "not found in catalog" error, not a
 *      foreign-key violation deep in the DB layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// Shared mocks across both tools.
const mockSkillsCatalogFindFirst = vi.fn();
const mockDeploymentSkillsFindFirst = vi.fn();
const mockInsert = vi.fn();
const mockInsertValues = vi.fn();
const mockDelete = vi.fn();
const mockDeleteWhere = vi.fn();
const mockSafeFireAndForget = vi.fn();
const mockSyncConfigsToPvc = vi.fn();

vi.mock("../../../db/index.js", () => ({
  db: {
    query: {
      skillsCatalog: { findFirst: (...args: any[]) => mockSkillsCatalogFindFirst(...args) },
      deploymentSkills: { findFirst: (...args: any[]) => mockDeploymentSkillsFindFirst(...args) },
    },
    insert: (...args: any[]) => {
      mockInsert(...args);
      return { values: mockInsertValues };
    },
    delete: (...args: any[]) => {
      mockDelete(...args);
      return { where: mockDeleteWhere };
    },
  },
  tables: {
    skillsCatalog: { id: { name: "id" } },
    deploymentSkills: {
      deploymentId: { name: "deployment_id" },
      skillId: { name: "skill_id" },
    },
  },
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

import { installSkillTool } from "../../../mcp/tools/installSkill.js";
import { uninstallSkillTool } from "../../../mcp/tools/uninstallSkill.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockSkillsCatalogFindFirst.mockReset();
  mockDeploymentSkillsFindFirst.mockReset();
  mockInsert.mockReset();
  mockInsertValues.mockReset();
  mockDelete.mockReset();
  mockDeleteWhere.mockReset();
  mockSafeFireAndForget.mockReset();
  mockSyncConfigsToPvc.mockReset();

  // Defaults: chained inserts/deletes resolve.
  mockInsertValues.mockResolvedValue(undefined);
  mockDeleteWhere.mockResolvedValue(undefined);
});

function ctx(status = "running"): ToolContext {
  return {
    userId: "user-1",
    deploymentId: "dep-abc",
    deployment: { id: "dep-abc", name: "My Bot", status },
  };
}

// ── Shared metadata ────────────────────────────────────────────────────────

describe("install_skill + uninstall_skill — shared metadata", () => {
  const tools = [
    { tool: installSkillTool, name: "install_skill" },
    { tool: uninstallSkillTool, name: "uninstall_skill" },
  ];

  it.each(tools)("$name renders the show_skills component", ({ tool }) => {
    expect(tool.rendersComponent).toBe("show_skills");
  });

  it.each(tools)("$name declares skillId as the only required parameter", ({ tool }) => {
    const params = tool.parameters as any;
    expect(params.required).toEqual(["skillId"]);
    expect(params.properties.skillId).toBeDefined();
  });

  it.each(tools)("$name rejects when skillId is missing", async ({ tool }) => {
    const r = await tool.execute({}, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("Missing skillId");
    // No DB queries on missing skillId.
    expect(mockSkillsCatalogFindFirst).not.toHaveBeenCalled();
    expect(mockDeploymentSkillsFindFirst).not.toHaveBeenCalled();
  });

  it.each(tools)("$name rejects when skillId is empty string", async ({ tool }) => {
    const r = await tool.execute({ skillId: "" }, ctx());
    expect(r.success).toBe(false);
    expect(r.message).toContain("Missing skillId");
  });
});

// ── install_skill ───────────────────────────────────────────────────────────

describe("installSkillTool", () => {
  it("rejects when skill is not in the catalog", async () => {
    mockSkillsCatalogFindFirst.mockResolvedValueOnce(null);

    const r = await installSkillTool.execute({ skillId: "skill-fake" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("not found in catalog");
    // Catalog check happens BEFORE the join check.
    expect(mockSkillsCatalogFindFirst).toHaveBeenCalledTimes(1);
    expect(mockDeploymentSkillsFindFirst).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects when skill is already installed (idempotence)", async () => {
    mockSkillsCatalogFindFirst.mockResolvedValueOnce({
      id: "skill-a",
      name: "Skill A",
    });
    mockDeploymentSkillsFindFirst.mockResolvedValueOnce({
      id: "row-1",
      skillId: "skill-a",
      deploymentId: "dep-abc",
    });

    const r = await installSkillTool.execute({ skillId: "skill-a" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("already installed");
    expect(r.message).toContain("Skill A");
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("inserts a new deploymentSkills row with nanoid id when skill is in catalog and not installed", async () => {
    mockSkillsCatalogFindFirst.mockResolvedValueOnce({
      id: "skill-a",
      name: "Skill A",
    });
    mockDeploymentSkillsFindFirst.mockResolvedValueOnce(null);

    const r = await installSkillTool.execute({ skillId: "skill-a" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("Skill A");
    expect(r.message).toContain("installed successfully");

    expect(mockInsert).toHaveBeenCalledTimes(1);
    const row = mockInsertValues.mock.calls[0][0];
    expect(row.deploymentId).toBe("dep-abc");
    expect(row.skillId).toBe("skill-a");
    // nanoid id is present.
    expect(typeof row.id).toBe("string");
    expect(row.id.length).toBeGreaterThan(0);
  });

  it("triggers configSync when the deployment is RUNNING", async () => {
    mockSkillsCatalogFindFirst.mockResolvedValueOnce({ id: "skill-a", name: "Skill A" });
    mockDeploymentSkillsFindFirst.mockResolvedValueOnce(null);

    await installSkillTool.execute({ skillId: "skill-a" }, ctx("running"));

    expect(mockSafeFireAndForget).toHaveBeenCalledTimes(1);
    expect(mockSafeFireAndForget.mock.calls[0][1]).toMatchObject({
      operation: "syncConfigsToPvc",
      deploymentId: "dep-abc",
    });
  });

  it("does NOT trigger configSync when the deployment is STOPPED (no pod to sync)", async () => {
    mockSkillsCatalogFindFirst.mockResolvedValueOnce({ id: "skill-a", name: "Skill A" });
    mockDeploymentSkillsFindFirst.mockResolvedValueOnce(null);

    await installSkillTool.execute({ skillId: "skill-a" }, ctx("stopped"));

    expect(mockSafeFireAndForget).not.toHaveBeenCalled();
  });

  it("does NOT trigger configSync for any non-running status (creating, failed, pending)", async () => {
    for (const status of ["creating", "failed", "pending", "stopping"]) {
      vi.clearAllMocks();
      mockInsertValues.mockResolvedValue(undefined);
      mockSkillsCatalogFindFirst.mockResolvedValueOnce({ id: "skill-x", name: "Skill X" });
      mockDeploymentSkillsFindFirst.mockResolvedValueOnce(null);

      await installSkillTool.execute({ skillId: "skill-x" }, ctx(status));

      expect(mockSafeFireAndForget).not.toHaveBeenCalled();
    }
  });
});

// ── uninstall_skill ─────────────────────────────────────────────────────────

describe("uninstallSkillTool", () => {
  it("rejects when skill is NOT installed (idempotence — no-op delete is an error)", async () => {
    mockDeploymentSkillsFindFirst.mockResolvedValueOnce(null);

    const r = await uninstallSkillTool.execute({ skillId: "skill-a" }, ctx());

    expect(r.success).toBe(false);
    expect(r.message).toContain("not installed");
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("does NOT verify catalog existence (uninstall doesn't care if the catalog row was deleted)", async () => {
    // If a skill is removed from the catalog, deployments still
    // need to be able to uninstall their orphan join row. Pin
    // that the catalog check is NOT in this path.
    mockDeploymentSkillsFindFirst.mockResolvedValueOnce({
      id: "row-1",
      skillId: "skill-orphan",
      deploymentId: "dep-abc",
    });

    await uninstallSkillTool.execute({ skillId: "skill-orphan" }, ctx());

    expect(mockSkillsCatalogFindFirst).not.toHaveBeenCalled();
  });

  it("deletes the deploymentSkills row and returns success", async () => {
    mockDeploymentSkillsFindFirst.mockResolvedValueOnce({
      id: "row-1",
      skillId: "skill-a",
      deploymentId: "dep-abc",
    });

    const r = await uninstallSkillTool.execute({ skillId: "skill-a" }, ctx());

    expect(r.success).toBe(true);
    expect(r.message).toContain("uninstalled successfully");
    expect(mockDelete).toHaveBeenCalledTimes(1);
    // Delete is filtered by both deploymentId AND skillId.
    expect(mockDeleteWhere).toHaveBeenCalledTimes(1);
  });

  it("triggers configSync when the deployment is RUNNING", async () => {
    mockDeploymentSkillsFindFirst.mockResolvedValueOnce({
      id: "row-1",
      skillId: "skill-a",
      deploymentId: "dep-abc",
    });

    await uninstallSkillTool.execute({ skillId: "skill-a" }, ctx("running"));

    expect(mockSafeFireAndForget).toHaveBeenCalledTimes(1);
  });

  it("does NOT trigger configSync when the deployment is STOPPED", async () => {
    mockDeploymentSkillsFindFirst.mockResolvedValueOnce({
      id: "row-1",
      skillId: "skill-a",
      deploymentId: "dep-abc",
    });

    await uninstallSkillTool.execute({ skillId: "skill-a" }, ctx("stopped"));

    expect(mockSafeFireAndForget).not.toHaveBeenCalled();
  });
});
