import { db, tables } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { decryptApiKey } from "../../utils/encryption.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

function maskCredential(value: string): string {
  if (value.length <= 10) return "****";
  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`;
}

export const getPlatformsTool: McpTool = {
  name: "get_platforms",
  description:
    "List connected messaging platforms and their status. Use when user asks about integrations, platforms, or connections.",
  parameters: {
    type: "object",
    properties: {},
  },
  rendersComponent: "show_platforms",
  async execute(_params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const creds = await db.query.platformCredentials.findMany({
      where: eq(tables.platformCredentials.deploymentId, ctx.deploymentId),
    });

    const platforms = (creds as any[]).map((cred) => {
      let masked: Record<string, string> = {};
      try {
        const decrypted = decryptApiKey(cred.credentials);
        const parsed = JSON.parse(decrypted);
        for (const [key, value] of Object.entries(parsed)) {
          masked[key] = typeof value === "string" && value.length > 0 ? maskCredential(value) : "";
        }
      } catch {
        // skip
      }
      return { platformId: cred.platformId, maskedCredentials: masked };
    });

    const connected = platforms.map((p) => p.platformId);
    const allPlatforms = ["telegram", "discord", "slack", "whatsapp"];
    const disconnected = allPlatforms.filter((p) => !connected.includes(p));

    return {
      success: true,
      message: `Connected platforms: ${connected.length > 0 ? connected.join(", ") : "none"}. Available to connect: ${disconnected.join(", ")}.`,
      data: { connected: platforms, disconnected },
    };
  },
};
