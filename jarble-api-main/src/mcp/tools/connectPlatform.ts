import { db, tables, dbDate } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { encryptApiKey } from "../../utils/encryption.js";
import { syncConfigsToPvc } from "../../services/configSync.js";
import { safeFireAndForget } from "../../utils/safeAsync.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const connectPlatformTool: McpTool = {
  name: "connect_platform",
  description:
    "Connect a messaging platform by saving its credentials. Provide the platform ID and credentials object. For Telegram: { botToken }. For Discord: { botToken }. For Slack: { botToken, appToken }. WhatsApp uses QR pairing instead.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: ["telegram", "discord", "slack"],
        description: "The messaging platform to connect",
      },
      credentials: {
        type: "object",
        description: "Platform credentials. Telegram/Discord: { botToken }. Slack: { botToken, appToken }.",
        properties: {
          botToken: { type: "string", description: "Bot token" },
          appToken: { type: "string", description: "App token (Slack only)" },
        },
      },
    },
    required: ["platform", "credentials"],
  },
  rendersComponent: "show_platforms",
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const platform = params.platform as string;
    const credentials = params.credentials as Record<string, string>;

    if (!platform || !credentials) {
      return { success: false, message: "Missing platform or credentials." };
    }

    // Validate Telegram token via getMe API
    if (platform === "telegram" && credentials.botToken) {
      try {
        const res = await fetch(`https://api.telegram.org/bot${credentials.botToken}/getMe`);
        const data = await res.json() as any;
        if (!data.ok) {
          return { success: false, message: `Invalid Telegram bot token: ${data.description || "validation failed"}` };
        }
      } catch (err) {
        return { success: false, message: "Failed to validate Telegram bot token." };
      }
    }

    const encrypted = encryptApiKey(JSON.stringify(credentials));

    // Upsert
    const existing = await db.query.platformCredentials.findFirst({
      where: and(
        eq(tables.platformCredentials.deploymentId, ctx.deploymentId),
        eq(tables.platformCredentials.platformId, platform),
      ),
    });

    if (existing) {
      await db.update(tables.platformCredentials)
        .set({ credentials: encrypted, updatedAt: dbDate() })
        .where(eq(tables.platformCredentials.id, existing.id));
    } else {
      await db.insert(tables.platformCredentials).values({
        id: nanoid(12),
        deploymentId: ctx.deploymentId,
        platformId: platform,
        credentials: encrypted,
      });
    }

    logger.info({ deploymentId: ctx.deploymentId, platform }, "MCP: Platform credentials saved");

    // Fire-and-forget config sync
    safeFireAndForget(syncConfigsToPvc(ctx.deploymentId), { operation: "syncConfigsToPvc", deploymentId: ctx.deploymentId });

    return {
      success: true,
      message: `${platform.charAt(0).toUpperCase() + platform.slice(1)} credentials saved. The bot is restarting to apply the changes.`,
    };
  },
};
