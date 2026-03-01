/**
 * MCP Server Adapter — Bridges the existing ToolRegistry to a real MCP server.
 *
 * Creates an @modelcontextprotocol/sdk McpServer instance and registers all
 * tools from the in-process ToolRegistry so they can be called over the
 * standard MCP protocol (JSON-RPC over SSE/Streamable HTTP).
 *
 * Each tool's execute() is delegated to the existing McpTool implementation;
 * results are mapped from ToolResult → CallToolResult format.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodTypeAny } from "zod";
import { mcpRegistry } from "./tools/index.js";
import type { McpTool, ToolContext } from "./toolRegistry.js";
import { db, tables } from "../db/index.js";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger.js";

// ─── JSON Schema → Zod Converter ────────────────────────────────────────────

/**
 * Converts a tool's JSON Schema `parameters` into a Zod object schema so the
 * MCP SDK advertises proper parameter names/types to clients.
 *
 * Handles the common types used by our tools: string, number, boolean, object,
 * array, and enum. Falls back to z.unknown() for unrecognized types.
 */
function jsonSchemaPropertyToZod(prop: Record<string, any>): ZodTypeAny {
  if (prop.enum) {
    return z.enum(prop.enum as [string, ...string[]]);
  }
  switch (prop.type) {
    case "string":
      return prop.description ? z.string().describe(prop.description) : z.string();
    case "number":
    case "integer":
      return prop.description ? z.number().describe(prop.description) : z.number();
    case "boolean":
      return prop.description ? z.boolean().describe(prop.description) : z.boolean();
    case "object": {
      // If the object has explicit properties, build a nested z.object()
      // (Tambo rejects z.record — dynamic-key objects aren't supported)
      if (prop.properties) {
        const nested: Record<string, ZodTypeAny> = {};
        const nestedReq = new Set<string>(prop.required || []);
        for (const [k, v] of Object.entries(prop.properties as Record<string, any>)) {
          let field = jsonSchemaPropertyToZod(v);
          if (!nestedReq.has(k)) field = field.optional() as any;
          nested[k] = field;
        }
        const obj = z.object(nested);
        return prop.description ? obj.describe(prop.description) : obj;
      }
      // No explicit properties — use passthrough object (Tambo rejects z.record)
      const obj = z.object({}).passthrough();
      return prop.description ? obj.describe(prop.description) : obj;
    }
    case "array":
      return prop.description ? z.array(z.unknown()).describe(prop.description) : z.array(z.unknown());
    default:
      return z.unknown();
  }
}

function buildInputSchema(tool: McpTool): z.ZodObject<Record<string, ZodTypeAny>> {
  const params = tool.parameters;
  if (!params?.properties) {
    return z.object({});
  }

  const shape: Record<string, ZodTypeAny> = {};
  const required = new Set<string>(Array.isArray(params.required) ? params.required : []);

  for (const [key, prop] of Object.entries(params.properties as Record<string, any>)) {
    let zodProp = jsonSchemaPropertyToZod(prop);
    if (!required.has(key)) {
      zodProp = zodProp.optional() as any;
    }
    shape[key] = zodProp;
  }

  return z.object(shape);
}

// ─── MCP Server Factory ─────────────────────────────────────────────────────

/**
 * Creates a new MCP server instance with all tools from the registry
 * bound to the given ToolContext (userId + deploymentId + deployment row).
 *
 * Each tool is registered with a Zod schema derived from its JSON Schema
 * parameters, so MCP clients can discover parameter names and types.
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
    const inputSchema = buildInputSchema(tool);

    // @ts-expect-error — deep type instantiation from MCP SDK generics
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema,
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

    if (deployment.userId !== userId) {
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
