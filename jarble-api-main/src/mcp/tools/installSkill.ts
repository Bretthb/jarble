import { db, tables } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { syncConfigsToPvc } from "../../services/configSync.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const installSkillTool: McpTool = {
  name: "install_skill",
  description: "Install a skill on this deployment by skill ID.",
  parameters: {
    type: "object",
    properties: {
      skillId: { type: "string", description: "The skill catalog ID to install" },
    },
    required: ["skillId"],
  },
  rendersComponent: "show_skills",
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const skillId = params.skillId as string;
    if (!skillId) {
      return { success: false, message: "Missing skillId." };
    }

    // Verify skill exists
    const skill = await db.query.skillsCatalog.findFirst({
      where: eq(tables.skillsCatalog.id, skillId),
    });
    if (!skill) {
      return { success: false, message: `Skill "${skillId}" not found in catalog.` };
    }

    // Check not already installed
    const existing = await db.query.deploymentSkills.findFirst({
      where: and(
        eq(tables.deploymentSkills.deploymentId, ctx.deploymentId),
        eq(tables.deploymentSkills.skillId, skillId),
      ),
    });
    if (existing) {
      return { success: false, message: `Skill "${(skill as any).name}" is already installed.` };
    }

    await db.insert(tables.deploymentSkills).values({
      id: nanoid(12),
      deploymentId: ctx.deploymentId,
      skillId,
    });

    logger.info({ deploymentId: ctx.deploymentId, skillId }, "MCP: Skill installed");

    if (ctx.deployment.status === "running") {
      void syncConfigsToPvc(ctx.deploymentId);
    }

    return {
      success: true,
      message: `Skill "${(skill as any).name}" installed successfully.`,
    };
  },
};
