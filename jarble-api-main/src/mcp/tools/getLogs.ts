import { getDeploymentLogs } from "../../k8s/index.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const getLogsTool: McpTool = {
  name: "get_logs",
  description: "Fetch recent logs from the deployment pod. Use when the user asks to see logs or debug output.",
  parameters: {
    type: "object",
    properties: {
      lines: {
        type: "number",
        description: "Number of log lines to fetch (default 50, max 200)",
      },
    },
  },
  rendersComponent: "show_logs",
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const lines = Math.min(Math.max(Number(params.lines) || 50, 1), 200);

    try {
      const result = await getDeploymentLogs(ctx.deploymentId, lines);
      const logLines = result.logs.split("\n").filter(Boolean);

      return {
        success: true,
        message: `Fetched ${logLines.length} log lines from pod ${result.podName}.`,
        data: { logs: result.logs, podName: result.podName },
      };
    } catch (err: any) {
      logger.warn({ deploymentId: ctx.deploymentId, err: err.message }, "MCP: Failed to fetch logs");
      return {
        success: false,
        message: `Could not fetch logs: ${err.message}. The pod may not be running.`,
      };
    }
  },
};
