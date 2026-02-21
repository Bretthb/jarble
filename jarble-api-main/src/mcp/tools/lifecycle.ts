/**
 * Lifecycle tools — restart, stop, start.
 *
 * These tools do NOT execute the action. They render a confirm_action
 * component so the user can click Confirm in the UI. The actual lifecycle
 * mutation is triggered by the frontend via tRPC.
 */
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const restartBotTool: McpTool = {
  name: "restart_bot",
  description:
    "Request a restart of the bot. Shows a confirmation dialog — does NOT execute immediately. Use when the user asks to restart or reboot.",
  parameters: {
    type: "object",
    properties: {},
  },
  rendersComponent: "confirm_action",
  async execute(_params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return {
      success: true,
      message: `Showing restart confirmation for "${ctx.deployment.name}". The user needs to click Confirm to proceed.`,
      data: { action: "restart", deploymentId: ctx.deploymentId },
    };
  },
};

export const stopBotTool: McpTool = {
  name: "stop_bot",
  description:
    "Request to stop the bot. Shows a confirmation dialog — does NOT execute immediately. Use when the user asks to stop or shut down.",
  parameters: {
    type: "object",
    properties: {},
  },
  rendersComponent: "confirm_action",
  async execute(_params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return {
      success: true,
      message: `Showing stop confirmation for "${ctx.deployment.name}". The user needs to click Confirm to proceed.`,
      data: { action: "stop", deploymentId: ctx.deploymentId },
    };
  },
};

export const startBotTool: McpTool = {
  name: "start_bot",
  description:
    "Request to start a stopped bot. Shows a confirmation dialog — does NOT execute immediately. Use when the user asks to start the bot.",
  parameters: {
    type: "object",
    properties: {},
  },
  rendersComponent: "confirm_action",
  async execute(_params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    return {
      success: true,
      message: `Showing start confirmation for "${ctx.deployment.name}". The user needs to click Confirm to proceed.`,
      data: { action: "start", deploymentId: ctx.deploymentId },
    };
  },
};
