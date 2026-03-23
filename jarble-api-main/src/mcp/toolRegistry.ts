/**
 * MCP-inspired Tool Registry — In-process tool system for the chat agent.
 *
 * Tools are registered at startup and executed server-side during
 * the multi-turn LLM tool calling loop in tamboAgent.ts.
 *
 * Each tool can optionally declare `rendersComponent` to emit a
 * TOOL_CALL SSE event that the frontend renders as a UI card.
 */

import type { LlmToolDefinition } from "../services/llmProxy.js";

// ─── Core Types ──────────────────────────────────────────────────────────────

export interface ToolResult {
  success: boolean;
  data?: unknown;
  message: string; // Human-readable summary for the LLM
  /** Optional SSE side-effect events to emit to the frontend after tool execution. */
  sseEvents?: Array<{ name: string; value: unknown }>;
}

export interface ToolContext {
  userId: string;
  deploymentId: string;
  deployment: any; // DB row (pre-fetched in tamboAgent.ts)
}

export interface McpTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  /** If set, the frontend renders this component (e.g. "show_platforms") */
  rendersComponent?: string;
  execute: (params: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
}

// ─── Registry ────────────────────────────────────────────────────────────────

export class ToolRegistry {
  private tools = new Map<string, McpTool>();

  register(tool: McpTool): void {
    this.tools.set(tool.name, tool);
  }

  get(name: string): McpTool | undefined {
    return this.tools.get(name);
  }

  getAll(): McpTool[] {
    return Array.from(this.tools.values());
  }

  /** Convert registered tools to LLM-compatible tool definitions. */
  toLlmToolDefinitions(): LlmToolDefinition[] {
    return this.getAll().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }
}
