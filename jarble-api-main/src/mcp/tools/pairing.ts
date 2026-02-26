import { findPodForDeployment, execInPod } from "../../k8s/index.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

const PLATFORM_ENUM = ["telegram", "discord", "slack", "whatsapp"] as const;

export const pairingListTool: McpTool = {
  name: "pairing_list",
  description:
    "List pending pairing requests for a messaging platform. Use when the user wants to see who is waiting to be approved on Telegram, Discord, Slack, or WhatsApp.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: PLATFORM_ENUM,
        description: "The messaging platform to list pairings for",
      },
    },
    required: ["platform"],
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const platform = params.platform as string;
    if (!PLATFORM_ENUM.includes(platform as any)) {
      return {
        success: false,
        message: `Invalid platform "${platform}". Must be one of: ${PLATFORM_ENUM.join(", ")}.`,
      };
    }

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false });
    if (!podName) {
      return {
        success: false,
        message: "No running pod found. The bot may still be starting up.",
      };
    }

    try {
      const output = await execInPod(podName, [
        "npx", "openclaw", "pairing", "list", platform, "--json",
      ]);

      // Try to parse output as JSON array of pairings
      try {
        const pairings = JSON.parse(output);
        return {
          success: true,
          message: `Found ${Array.isArray(pairings) ? pairings.length : 0} pairing(s) for ${platform}.`,
          data: pairings,
        };
      } catch {
        // If parse fails, return the raw output as the message
        return {
          success: true,
          message: output.trim() || `No pairings found for ${platform}.`,
        };
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ deploymentId: ctx.deploymentId, err: msg }, "MCP: pairing_list failed");
      return {
        success: false,
        message: `Failed to list pairings: ${msg}`,
      };
    }
  },
};

export const pairingApproveTool: McpTool = {
  name: "pairing_approve",
  description:
    "Approve a pending pairing request for a messaging platform. Use when the user wants to approve a specific pairing code on Telegram, Discord, Slack, or WhatsApp.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: PLATFORM_ENUM,
        description: "The messaging platform to approve the pairing for",
      },
      code: {
        type: "string",
        description: "The pairing code to approve",
      },
    },
    required: ["platform", "code"],
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const platform = params.platform as string;
    const code = params.code as string;

    if (!PLATFORM_ENUM.includes(platform as any)) {
      return {
        success: false,
        message: `Invalid platform "${platform}". Must be one of: ${PLATFORM_ENUM.join(", ")}.`,
      };
    }

    if (!code) {
      return { success: false, message: "No pairing code provided." };
    }

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false });
    if (!podName) {
      return {
        success: false,
        message: "No running pod found. The bot may still be starting up.",
      };
    }

    try {
      await execInPod(podName, [
        "npx", "openclaw", "pairing", "approve", platform, code, "--notify",
      ]);

      return {
        success: true,
        message: `Pairing code "${code}" approved for ${platform}. The user has been notified.`,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ deploymentId: ctx.deploymentId, err: msg }, "MCP: pairing_approve failed");
      return {
        success: false,
        message: `Failed to approve pairing: ${msg}`,
      };
    }
  },
};
