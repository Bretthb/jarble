import { db, tables } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { syncConfigsToPvc } from "../../services/configSync.js";
import { safeFireAndForget } from "../../utils/safeAsync.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const disconnectPlatformTool: McpTool = {
  name: "disconnect_platform",
  description: "Disconnect a messaging platform by removing its credentials.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: ["telegram", "discord", "slack", "whatsapp"],
        description: "The platform to disconnect",
      },
    },
    required: ["platform"],
  },
  rendersComponent: "show_platforms",
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const platform = params.platform as string;
    if (!platform) {
      return { success: false, message: "Missing platform." };
    }

    const existing = await db.query.platformCredentials.findFirst({
      where: and(
        eq(tables.platformCredentials.deploymentId, ctx.deploymentId),
        eq(tables.platformCredentials.platformId, platform),
      ),
    });

    if (!existing) {
      return { success: false, message: `${platform} is not connected.` };
    }

    await db.delete(tables.platformCredentials)
      .where(and(
        eq(tables.platformCredentials.deploymentId, ctx.deploymentId),
        eq(tables.platformCredentials.platformId, platform),
      ));

    logger.info({ deploymentId: ctx.deploymentId, platform }, "MCP: Platform disconnected");

    // Fire-and-forget config sync
    safeFireAndForget(syncConfigsToPvc(ctx.deploymentId), { operation: "syncConfigsToPvc", deploymentId: ctx.deploymentId });

    return {
      success: true,
      message: `${platform.charAt(0).toUpperCase() + platform.slice(1)} has been disconnected. The bot is restarting.`,
    };
  },
};
