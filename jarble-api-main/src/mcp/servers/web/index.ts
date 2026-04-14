/**
 * jarble-web — in-process HTTP MCP server running on the API.
 *
 * Stateless external API wrappers: web_search, wikipedia, dictionary, etc.
 * Can be disabled per deployment. All handlers should be pure functions of
 * their args — no DB, no K8s, no pod state.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { getRegisteredTools } from "./register.js";
import { validateArgs } from "../../shared/validation.js";
import { McpError } from "../../shared/errors.js";
import type { AnyToolDefinition, ToolContext, McpResult } from "../../shared/types.js";
import { createModuleLogger } from "../../../utils/logger.js";

// Side-effect imports — tools self-register on module load. The barrel
// under `./tools/index.ts` re-exports every tool file for side effects so
// adding a new tool only requires touching the barrel (and the file itself).
/* __JARBLE_WEB_TOOL_IMPORTS__ */
import "./tools/index.js";

const log = createModuleLogger("mcp:web");

export function listWebTools(): readonly AnyToolDefinition[] {
  return getRegisteredTools();
}

export async function invokeWebTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<McpResult> {
  const tool = getRegisteredTools().find((t) => t.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown web tool: ${name}` }],
      isError: true,
    };
  }
  try {
    const args = validateArgs(tool.inputSchema, rawArgs ?? {}, name);
    return (await tool.handler(args, ctx)) as McpResult;
  } catch (err) {
    const message =
      err instanceof McpError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    log.warn({ tool: name, err: message }, "web tool execution failed");
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

export function createWebMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "jarble-web", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  for (const tool of getRegisteredTools()) {
    const rawShape: ZodRawShape =
      "shape" in tool.inputSchema && typeof (tool.inputSchema as { shape?: unknown }).shape === "object"
        ? ((tool.inputSchema as unknown as { shape: ZodRawShape }).shape)
        : ({} as ZodRawShape);

    const handler = async (args: Record<string, unknown>) => {
      const result = await invokeWebTool(tool.name, args, ctx);
      return result as unknown as {
        content: Array<{ type: "text"; text: string }>;
        isError?: boolean;
      };
    };
    server.registerTool(
      tool.name,
      { description: tool.description, inputSchema: rawShape },
      handler,
    );
  }

  log.debug({ toolCount: getRegisteredTools().length }, "web MCP server created");
  return server;
}
