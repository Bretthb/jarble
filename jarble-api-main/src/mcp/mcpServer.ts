/**
 * MCP Server Adapter — Bridges the existing ToolRegistry to a real MCP server.
 *
 * Creates an @modelcontextprotocol/sdk McpServer instance and registers all
 * 18 tools from the in-process ToolRegistry so they can be called over the
 * standard MCP protocol (JSON-RPC over SSE/Streamable HTTP).
 *
 * Each tool's execute() is delegated to the existing McpTool implementation;
 * results are mapped from ToolResult → CallToolResult format.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mcpRegistry } from "./tools/index.js";
import type { ToolContext } from "./toolRegistry.js";
import { db, tables } from "../db/index.js";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger.js";

// ─── MCP Server Factory ─────────────────────────────────────────────────────

/**
 * Creates a new MCP server instance with all tools from the registry
 * bound to the given ToolContext (userId + deploymentId + deployment row).
 *
 * Each tool is registered using `server.registerTool()` with a passthrough
 * input schema — the existing tool implementations handle their own
 * parameter validation internally.
 */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    {
      name: "jarble-deployment",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  const tools = mcpRegistry.getAll();

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: z.object({}).passthrough(),
      },
      async (args) => {
        try {
          const result = await tool.execute(
            args as Record<string, unknown>,
            ctx,
          );

          const content: Array<{ type: "text"; text: string }> = [
            { type: "text" as const, text: result.message },
          ];

          if (result.data !== undefined) {
            content.push({
              type: "text" as const,
              text: JSON.stringify(result.data),
            });
          }

          return {
            content,
            isError: !result.success,
          };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Unknown tool error";
          logger.error(
            { err, tool: tool.name, deploymentId: ctx.deploymentId },
            `MCP tool execution failed: ${tool.name}`,
          );
          return {
            content: [{ type: "text" as const, text: message }],
            isError: true,
          };
        }
      },
    );
  }

  logger.debug(
    { toolCount: tools.length, deploymentId: ctx.deploymentId },
    "MCP server created with registered tools",
  );

  return server;
}

// ─── Context Builder ─────────────────────────────────────────────────────────

/**
 * Builds a ToolContext by fetching the deployment from the database and
 * verifying ownership.
 *
 * @returns The ToolContext if the deployment exists and belongs to the user,
 *          or null otherwise.
 */
export async function buildToolContext(
  userId: string,
  deploymentId: string,
): Promise<ToolContext | null> {
  try {
    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, deploymentId),
    });

    if (!deployment) {
      logger.warn(
        { userId, deploymentId },
        "buildToolContext: deployment not found",
      );
      return null;
    }

    if ((deployment as any).userId !== userId) {
      logger.warn(
        { userId, deploymentId },
        "buildToolContext: ownership mismatch",
      );
      return null;
    }

    return { userId, deploymentId, deployment };
  } catch (err) {
    logger.error(
      { err, userId, deploymentId },
      "buildToolContext: database query failed",
    );
    return null;
  }
}
