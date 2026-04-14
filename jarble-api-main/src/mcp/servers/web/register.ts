/**
 * Web-server tool registry. See `local/register.ts` for the pattern.
 */

import type { AnyToolDefinition, ToolDefinition } from "../../shared/types.js";
import { McpError } from "../../shared/errors.js";

const tools: AnyToolDefinition[] = [];
const seen = new Set<string>();

export function registerTool<
  TArgs extends Record<string, unknown>,
  TResult,
>(tool: ToolDefinition<TArgs, TResult>): void {
  if (tool.server !== "web") {
    throw new McpError(
      "INTERNAL",
      `Tool "${tool.name}" declared server="${tool.server}" but was registered on the web server.`,
    );
  }
  if (seen.has(tool.name)) {
    throw new McpError(
      "INTERNAL",
      `Tool "${tool.name}" is already registered on the web server.`,
    );
  }
  seen.add(tool.name);
  tools.push(tool as unknown as AnyToolDefinition);
}

export function getRegisteredTools(): readonly AnyToolDefinition[] {
  return tools;
}
