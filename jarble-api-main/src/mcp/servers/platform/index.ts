/**
 * jarble-platform — in-process HTTP MCP server running on the API.
 *
 * Handles platform-wide state: teams, flows, team filesystem (S3-backed),
 * knowledge, subagents, deployments, marketplace. Uses DB + K8s API + S3.
 *
 * `createPlatformMcpServer(ctx)` returns an `McpServer` bound to a specific
 * deployment / user context. The streamable HTTP transport wraps it in
 * `routes/mcp.ts` (or the new unified proxy) to speak the MCP protocol.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShape } from "zod";
import { getRegisteredTools } from "./register.js";
import { validateArgs } from "../../shared/validation.js";
import { McpError } from "../../shared/errors.js";
import type { AnyToolDefinition, ToolContext, McpResult } from "../../shared/types.js";
import { createModuleLogger } from "../../../utils/logger.js";

// Side-effect imports — tools self-register on module load.
import "./tools/teams.js";
import "./tools/filesystem.js";
import "./tools/capabilities.js";
import "./tools/subagents.js";
import "./tools/knowledge.js";

const log = createModuleLogger("mcp:platform");

/** Expose the registered tool list so the unified proxy can invoke in-process. */
export function listPlatformTools(): readonly AnyToolDefinition[] {
  return getRegisteredTools();
}

export async function invokePlatformTool(
  name: string,
  rawArgs: unknown,
  ctx: ToolContext,
): Promise<McpResult> {
  const tool = getRegisteredTools().find((t) => t.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown platform tool: ${name}` }],
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
    log.warn({ tool: name, err: message }, "platform tool execution failed");
    return { content: [{ type: "text", text: message }], isError: true };
  }
}

export function createPlatformMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "jarble-platform", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  for (const tool of getRegisteredTools()) {
    // The MCP SDK expects a ZodRawShape. Our tool `inputSchema` is a full
    // ZodType — typically a ZodObject — so we hand it over via its `.shape`
    // when available, otherwise wrap it as a single-field object.
    const rawShape: ZodRawShape =
      "shape" in tool.inputSchema && typeof (tool.inputSchema as { shape?: unknown }).shape === "object"
        ? ((tool.inputSchema as unknown as { shape: ZodRawShape }).shape)
        : ({} as ZodRawShape);

    const handler = async (args: Record<string, unknown>) => {
      const result = await invokePlatformTool(tool.name, args, ctx);
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

  log.debug(
    { toolCount: getRegisteredTools().length, deploymentId: ctx.deploymentId },
    "platform MCP server created",
  );

  return server;
}
