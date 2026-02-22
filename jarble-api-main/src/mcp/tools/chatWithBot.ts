import { findPodForDeployment, execInPod } from "../../k8s/index.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const chatWithBotTool: McpTool = {
  name: "chat_with_bot",
  description:
    "Forward a conversational message to the OpenClaw bot running in the pod. Use this when the user wants to chat with their bot (not manage it). For example: greetings, jokes, questions directed at the bot's persona.",
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

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false });
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
      ]);

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

      return {
        success: true,
        message: text,
      };
    } catch (err: any) {
      logger.warn({ deploymentId: ctx.deploymentId, err: err.message }, "MCP: chat_with_bot failed");
      return {
        success: false,
        message: `Failed to reach the bot: ${err.message}`,
      };
    }
  },
};
