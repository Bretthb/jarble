/**
 * Shared MCP types used by all three servers (local, platform, web).
 *
 * These types are the contract between the refactored MCP system and its
 * tool authors. Tools everywhere import `ToolDefinition`, declare their
 * `server` scope, and are picked up automatically by the matching server's
 * registry.
 */

import type { z } from "zod";
import type { Logger } from "pino";
import type { DbClient } from "../../db/index.js";

export type McpServerScope = "local" | "platform" | "web";

/** Minimal deployment shape a tool needs to resolve pod/PVC context. */
export interface ToolDeploymentRef {
  id: string;
  userId: string;
  managedBy?: string | null;
  status?: string | null;
  [key: string]: unknown;
}

/**
 * Context passed to every tool handler. Mirrors the shape used by the
 * existing `mcp/toolRegistry.ts:ToolContext` so migration is mechanical.
 */
export interface ToolContext {
  deploymentId: string;
  userId: string;
  deployment: ToolDeploymentRef;
  db: DbClient;
  log: Logger;
}

/** MCP-style content part. Matches `@modelcontextprotocol/sdk` CallToolResult. */
export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; text: string; mimeType?: string } };

export interface McpResult {
  content: McpContent[];
  isError?: boolean;
  structuredContent?: { [key: string]: unknown };
}

/**
 * A tool definition is the single source of truth for one tool.
 *
 * - `inputSchema` is a Zod v3 schema. Platform + web servers feed it straight
 *   into the MCP SDK; the local server converts it to JSON Schema at bundle time.
 * - `handler` receives validated args and returns an `McpResult`.
 * - `server` tags which runtime owns the tool. Only the matching server's
 *   `register.ts` will accept it.
 */
export interface ToolDefinition<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = McpResult,
> {
  name: string;
  description: string;
  server: McpServerScope;
  inputSchema: z.ZodType<TArgs>;
  handler: (args: TArgs, ctx: ToolContext) => Promise<TResult>;
}

export type AnyToolDefinition = ToolDefinition<Record<string, unknown>, McpResult>;

export type ToolHandler<
  TArgs extends Record<string, unknown> = Record<string, unknown>,
  TResult = McpResult,
> = ToolDefinition<TArgs, TResult>["handler"];
