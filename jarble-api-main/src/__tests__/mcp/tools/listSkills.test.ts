/**
 * Unit tests for the `list_skills` MCP tool.
 *
 * Returns the global skills catalog plus a per-skill `installed`
 * flag indicating whether THIS deployment has it installed. The
 * pattern is "join two queries on the deploymentId" — the
 * skillsCatalog is global, but the installed-set is scoped.
 *
 * Pinned: a regression that joined wrong (e.g. ANY deployment's
 * installed set) would mark every skill as installed for every
 * bot, defeating the marketplace's point.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCatalogFindMany = vi.fn();
const mockDeploymentSkillsFindMany = vi.fn();

vi.mock("../../../db/index.js", () => ({
  db: {
    query: {
      skillsCatalog: { findMany: (...args: any[]) => mockCatalogFindMany(...args) },
      deploymentSkills: { findMany: (...args: any[]) => mockDeploymentSkillsFindMany(...args) },
    },
  },
  tables: {
    deploymentSkills: { deploymentId: { name: "deployment_id" } },
  },
}));

import { listSkillsTool } from "../../../mcp/tools/listSkills.js";
import type { ToolContext } from "../../../mcp/toolRegistry.js";

beforeEach(() => {
  mockCatalogFindMany.mockReset();
  mockDeploymentSkillsFindMany.mockReset();
});

const ctx: ToolContext = {
  userId: "user-1",
  deploymentId: "dep-abc",
  deployment: { id: "dep-abc", name: "My Bot" },
};

describe("listSkillsTool", () => {
  it("registers under the name 'list_skills'", () => {
    expect(listSkillsTool.name).toBe("list_skills");
  });

  it("renders the show_skills component", () => {
    expect(listSkillsTool.rendersComponent).toBe("show_skills");
  });

  it("returns empty list when catalog is empty", async () => {
    mockCatalogFindMany.mockResolvedValueOnce([]);
    mockDeploymentSkillsFindMany.mockResolvedValueOnce([]);

    const r = await listSkillsTool.execute({}, ctx);

    expect(r.success).toBe(true);
    expect(r.message).toContain("0 skills available, 0 installed");
    expect((r.data as any).skills).toEqual([]);
  });

  it("marks skills as installed=true when their id is in deploymentSkills", async () => {
    mockCatalogFindMany.mockResolvedValueOnce([
      { id: "skill-a", name: "Skill A", description: "A" },
      { id: "skill-b", name: "Skill B", description: "B" },
      { id: "skill-c", name: "Skill C", description: "C" },
    ]);
    mockDeploymentSkillsFindMany.mockResolvedValueOnce([
      { skillId: "skill-a" },
      { skillId: "skill-c" },
    ]);

    const r = await listSkillsTool.execute({}, ctx);

    expect(r.success).toBe(true);
    expect(r.message).toContain("3 skills available, 2 installed");
    const skills = (r.data as any).skills;
    expect(skills).toEqual([
      { id: "skill-a", name: "Skill A", description: "A", installed: true },
      { id: "skill-b", name: "Skill B", description: "B", installed: false },
      { id: "skill-c", name: "Skill C", description: "C", installed: true },
    ]);
  });

  it("scopes the installed set by ctx.deploymentId (NOT a global join)", async () => {
    mockCatalogFindMany.mockResolvedValueOnce([]);
    mockDeploymentSkillsFindMany.mockResolvedValueOnce([]);

    await listSkillsTool.execute({}, ctx);

    // The deployment-skills query MUST have a `where` clause —
    // a regression that fetched ALL deploymentSkills would mark
    // skills as installed across deployments.
    expect(mockDeploymentSkillsFindMany).toHaveBeenCalledTimes(1);
    expect(mockDeploymentSkillsFindMany.mock.calls[0][0]).toHaveProperty("where");
  });

  it("the catalog query has NO where clause (catalog is global)", async () => {
    mockCatalogFindMany.mockResolvedValueOnce([]);
    mockDeploymentSkillsFindMany.mockResolvedValueOnce([]);

    await listSkillsTool.execute({}, ctx);

    // Pin that the catalog is fetched globally — adding a where
    // clause would silently shrink the catalog the bot sees.
    const arg = mockCatalogFindMany.mock.calls[0][0];
    expect(arg).toBeUndefined();
  });
});
