import { db, tables, dbDate } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { syncConfigsToPvc } from "../../services/configSync.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const updateSystemPromptTool: McpTool = {
  name: "update_system_prompt",
  description:
    "View or update the bot's system prompt / personality. If no new prompt is provided, returns the current prompt.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The new system prompt text. Omit to just view the current prompt.",
      },
    },
  },
  rendersComponent: "show_system_prompt",
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const newPrompt = params.prompt as string | undefined;

    if (!newPrompt) {
      return {
        success: true,
        message: `Current system prompt: "${ctx.deployment.systemPrompt || "(not set)"}"`,
        data: { systemPrompt: ctx.deployment.systemPrompt || "" },
      };
    }

    await db.update(tables.deployments)
      .set({ systemPrompt: newPrompt, updatedAt: dbDate() })
      .where(eq(tables.deployments.id, ctx.deploymentId));

    logger.info({ deploymentId: ctx.deploymentId }, "MCP: System prompt updated");

    // File-only change — configSync writes soul.md without restart
    if (ctx.deployment.status === "running") {
      void syncConfigsToPvc(ctx.deploymentId);
    }

    return {
      success: true,
      message: "System prompt updated successfully.",
    };
  },
};
