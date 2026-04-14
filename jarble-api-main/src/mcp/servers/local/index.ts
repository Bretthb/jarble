#!/usr/bin/env node
/**
 * jarble-local — stdio MCP server, runs inside the deployment pod.
 *
 * Handles pod-local state (memory, artifacts, canvas files, per-pod secrets,
 * service hosting). Bundled by `src/mcp/build.ts` into a single JS file
 * dropped onto the pod PVC.
 *
 * Protocol handling matches the existing `mcp/jarble-ui-server.js` (JSON-RPC
 * 2.0 over newline-delimited stdio) so mcporter and other MCP clients
 * behave identically once a tool is moved over.
 */

import { zodToJsonSchema } from "zod-to-json-schema";
import { getRegisteredTools } from "./register.js";
import { validateArgs } from "../../shared/validation.js";
import { McpError } from "../../shared/errors.js";
import type { AnyToolDefinition, ToolContext, McpResult } from "../../shared/types.js";

// Side-effect imports: each tool module self-registers on import.
// The build step replaces this block with an explicit import list — see build.ts.
/* __JARBLE_LOCAL_TOOL_IMPORTS__ */

const PROTOCOL_VERSION = "2024-11-05";
const SERVER_NAME = "jarble-local";
const SERVER_VERSION = "0.1.0";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function toToolListEntry(tool: AnyToolDefinition) {
  // Cast: zod-to-json-schema types its output with a complex generic chain
  // that TS can't resolve in a reasonable depth; at runtime this is a plain
  // JSON-Schema object which is all the MCP protocol needs.
  const schema = zodToJsonSchema(tool.inputSchema as never, {
    target: "jsonSchema7",
    $refStrategy: "none",
  }) as Record<string, unknown>;
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: schema,
  };
}

/**
 * Build a minimal ToolContext for stdio mode. Inside the pod we don't have
 * DB access; the placeholder values get replaced when a tool actually needs
 * them (e.g. a local tool that shells out to the pod filesystem can rely on
 * deploymentId + logging only).
 *
 * Tools that genuinely need DB access must run on the platform server.
 */
function buildStdioContext(): ToolContext {
  const deploymentId = process.env.JARBLE_DEPLOYMENT_ID ?? "local";
  const userId = process.env.JARBLE_USER_ID ?? "local";
  const log = {
    info: (...a: unknown[]) => process.stderr.write(`[info] ${JSON.stringify(a)}\n`),
    warn: (...a: unknown[]) => process.stderr.write(`[warn] ${JSON.stringify(a)}\n`),
    error: (...a: unknown[]) => process.stderr.write(`[error] ${JSON.stringify(a)}\n`),
    debug: (...a: unknown[]) => process.stderr.write(`[debug] ${JSON.stringify(a)}\n`),
    child: () => log,
  };
  return {
    deploymentId,
    userId,
    deployment: { id: deploymentId, userId },
    // DB is not available inside the pod; tools needing it belong on platform.
    db: undefined as never,
    log: log as never,
  };
}

export async function executeTool(name: string, rawArgs: unknown): Promise<McpResult> {
  const tool = getRegisteredTools().find((t) => t.name === name);
  if (!tool) {
    return {
      content: [{ type: "text", text: `Unknown tool: ${name}` }],
      isError: true,
    };
  }
  try {
    const args = validateArgs(tool.inputSchema, rawArgs ?? {}, name);
    const ctx = buildStdioContext();
    const result = await tool.handler(args, ctx);
    return result as McpResult;
  } catch (err) {
    const message =
      err instanceof McpError
        ? `${err.code}: ${err.message}`
        : err instanceof Error
          ? err.message
          : String(err);
    return {
      content: [{ type: "text", text: message }],
      isError: true,
    };
  }
}

async function handleMessage(msg: JsonRpcRequest): Promise<JsonRpcResponse | null> {
  const { id = null, method, params } = msg;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    };
  }

  if (method === "notifications/initialized") {
    return null;
  }

  if (method === "tools/list") {
    return {
      jsonrpc: "2.0",
      id,
      result: { tools: getRegisteredTools().map(toToolListEntry) },
    };
  }

  if (method === "tools/call") {
    const toolName = (params?.name as string) ?? "";
    const toolArgs = (params?.arguments as Record<string, unknown>) ?? {};
    const result = await executeTool(toolName, toolArgs);
    return { jsonrpc: "2.0", id, result };
  }

  if (method === "ping") {
    return { jsonrpc: "2.0", id, result: {} };
  }

  if (id !== null && id !== undefined) {
    return {
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    };
  }
  return null;
}

function startStdioLoop(): void {
  let buffer = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let idx: number;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;

      let msg: JsonRpcRequest;
      try {
        msg = JSON.parse(line);
      } catch {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: null,
            error: { code: -32700, message: "Parse error" },
          }) + "\n",
        );
        continue;
      }

      handleMessage(msg)
        .then((response) => {
          if (response) process.stdout.write(JSON.stringify(response) + "\n");
        })
        .catch((err) => {
          if (msg.id !== undefined && msg.id !== null) {
            process.stdout.write(
              JSON.stringify({
                jsonrpc: "2.0",
                id: msg.id,
                error: {
                  code: -32603,
                  message: err instanceof Error ? err.message : String(err),
                },
              }) + "\n",
            );
          }
        });
    }
  });

  process.stdin.on("end", () => process.exit(0));
  process.on("uncaughtException", (err) => {
    process.stderr.write(`[jarble-local] Uncaught: ${err.message}\n`);
  });
}

// Start the stdio loop unless the host opted out via env (e.g. tests that
// import this module just to reach `executeTool`).
if (process.env.JARBLE_LOCAL_MCP_NO_AUTOSTART !== "1") {
  startStdioLoop();
}

export { startStdioLoop };
