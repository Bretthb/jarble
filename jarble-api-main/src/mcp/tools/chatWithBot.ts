import { findPodForDeployment, execInPod } from "../../k8s/index.js";
import type { ManagedBy } from "../../k8s/constants.js";
import { getContainerName } from "../../k8s/constants.js";
import { extractUIBlocks } from "../../utils/uiBlockParser.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const chatWithBotTool: McpTool = {
  name: "chat_with_bot",
  description:
    "Forward a conversational message to the OpenClaw bot running in the pod. Use this when the user wants to chat with their bot. The bot may return rich UI blocks - if so, render each as a BotCanvas component.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description: "The message to send to the bot",
      },
    },
    required: ["message"],
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const message = params.message as string;
    if (!message) {
      return { success: false, message: "No message provided." };
    }

    if (ctx.deployment.status !== "running") {
      return {
        success: false,
        message: "The bot is not running. It needs to be started before you can chat with it.",
      };
    }

    const managedBy = (ctx.deployment?.managedBy ?? "legacy") as ManagedBy;
    const containerName = getContainerName(managedBy);

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false, managedBy });
    if (!podName) {
      return {
        success: false,
        message: "No running pod found. The bot may still be starting up.",
      };
    }

    try {
      const sessionId = `jarble-web-${ctx.userId}`;
      const output = await execInPod(podName, [
        "npx", "openclaw", "agent",
        "--message", message,
        "--session-id", sessionId,
        "--json",
        "--timeout", "30",
      ], containerName);

      // Parse JSON response
      let parsed: any;
      try {
        parsed = JSON.parse(output);
      } catch {
        const jsonStart = output.indexOf("{");
        if (jsonStart >= 0) {
          try {
            parsed = JSON.parse(output.slice(jsonStart));
          } catch {
            return { success: false, message: "Bot returned an unparseable response." };
          }
        } else {
          return { success: false, message: "Bot returned a non-JSON response." };
        }
      }

      const payloads = parsed.result?.payloads || parsed.payloads || [];
      const text = payloads.map((p: any) => p.text || "").join("\n").trim();

      if (!text) {
        return { success: false, message: "Bot returned an empty response." };
      }

      // Extract UI blocks from the bot's response
      const { cleanText, uiBlocks } = extractUIBlocks(text);

      if (uiBlocks.length > 0) {
        // Return structured data so Tambo can render BotCanvas components
        return {
          success: true,
          message: cleanText || "The bot rendered UI components.",
          data: {
            uiBlocks: uiBlocks.map((b) => ({
              blockId: b.id,
              component: b.component,
              props: b.props,
              editable: b.editable,
              fileId: b.fileId,
              saveMethod: b.saveMethod,
            })),
          },
        };
      }

      return {
        success: true,
        message: text,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ deploymentId: ctx.deploymentId, err: msg }, "MCP: chat_with_bot failed");
      return {
        success: false,
        message: `Failed to reach the bot: ${msg}`,
      };
    }
  },
};
