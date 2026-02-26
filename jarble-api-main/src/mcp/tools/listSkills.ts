import { db, tables } from "../../db/index.js";
import { eq } from "drizzle-orm";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const listSkillsTool: McpTool = {
  name: "list_skills",
  description:
    "List all available skills from the catalog and which ones are installed on this deployment.",
  parameters: {
    type: "object",
    properties: {},
  },
  rendersComponent: "show_skills",
  async execute(_params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const catalog = await db.query.skillsCatalog.findMany();
    const installed = await db.query.deploymentSkills.findMany({
      where: eq(tables.deploymentSkills.deploymentId, ctx.deploymentId),
    });

    const installedIds = new Set(installed.map((ds) => ds.skillId));

    const skills = catalog.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      installed: installedIds.has(s.id),
    }));

    const installedCount = skills.filter((s) => s.installed).length;

    return {
      success: true,
      message: `${skills.length} skills available, ${installedCount} installed.`,
      data: { skills },
    };
  },
};
