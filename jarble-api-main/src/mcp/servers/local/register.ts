/**
 * Local-server tool registry.
 *
 * Tools in `./tools/*.ts` call `registerTool(...)` at module top level.
 * The stdio entry point imports them, triggering registration as a side
 * effect, then reads `getRegisteredTools()` to build the tools/list response.
 */

import type { AnyToolDefinition, ToolDefinition } from "../../shared/types.js";
import { McpError } from "../../shared/errors.js";

const tools: AnyToolDefinition[] = [];
const seen = new Set<string>();

export function registerTool<
  TArgs extends Record<string, unknown>,
  TResult,
>(tool: ToolDefinition<TArgs, TResult>): void {
  if (tool.server !== "local") {
    throw new McpError(
      "INTERNAL",
      `Tool "${tool.name}" declared server="${tool.server}" but was registered on the local server.`,
    );
  }
  if (seen.has(tool.name)) {
    throw new McpError(
      "INTERNAL",
      `Tool "${tool.name}" is already registered on the local server.`,
    );
  }
  seen.add(tool.name);
  tools.push(tool as unknown as AnyToolDefinition);
}

export function getRegisteredTools(): readonly AnyToolDefinition[] {
  return tools;
}
