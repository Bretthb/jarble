import { db, tables } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { syncConfigsToPvc } from "../../services/configSync.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const uninstallSkillTool: McpTool = {
  name: "uninstall_skill",
  description: "Uninstall a skill from this deployment by skill ID.",
  parameters: {
    type: "object",
    properties: {
      skillId: { type: "string", description: "The skill catalog ID to uninstall" },
    },
    required: ["skillId"],
  },
  rendersComponent: "show_skills",
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const skillId = params.skillId as string;
    if (!skillId) {
      return { success: false, message: "Missing skillId." };
    }

    const existing = await db.query.deploymentSkills.findFirst({
      where: and(
        eq(tables.deploymentSkills.deploymentId, ctx.deploymentId),
        eq(tables.deploymentSkills.skillId, skillId),
      ),
    });

    if (!existing) {
      return { success: false, message: "Skill is not installed on this deployment." };
    }

    await db.delete(tables.deploymentSkills)
      .where(and(
        eq(tables.deploymentSkills.deploymentId, ctx.deploymentId),
        eq(tables.deploymentSkills.skillId, skillId),
      ));

    logger.info({ deploymentId: ctx.deploymentId, skillId }, "MCP: Skill uninstalled");

    if (ctx.deployment.status === "running") {
      void syncConfigsToPvc(ctx.deploymentId);
    }

    return {
      success: true,
      message: "Skill uninstalled successfully.",
    };
  },
};
