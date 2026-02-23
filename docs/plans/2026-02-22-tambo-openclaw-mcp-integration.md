# Tambo + OpenClaw MCP Integration — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect Tambo to OpenClaw via real MCP protocol, giving users full "monitor" visibility into their bot's capabilities — chat, config, data, UI, filesystem.

**Architecture:** An MCP server in the Jarble API wraps the existing 18 MCP-inspired tools (already in `jarble-api-main/src/mcp/tools/`) into real MCP protocol using `@modelcontextprotocol/sdk`. Exposed at `/api/mcp/:deploymentId` with Streamable HTTP transport. Tambo connects via `mcpServers` prop on TamboProvider. Infrastructure tools (start/stop/restart/delete) stay as Tambo `defineTool()`.

**Tech Stack:** `@modelcontextprotocol/sdk` (server), `@tambo-ai/react` (client), Express, Zod

**Key Discovery:** 18 tools already exist in `jarble-api-main/src/mcp/tools/` with a custom `McpTool` interface. These tools need DB access, K8s API, and configSync — they can only run in the API, not inside the pod. The design approved "Pod MCP Server" but the practical implementation hosts the MCP server in the API (which proxies to pods via kubectl exec for pod-specific operations like chat, file access, and CLI commands). From Tambo's perspective, the result is identical — tools are discovered automatically via MCP.

---

## Task 1: Install MCP SDK in API

**Files:**
- Modify: `jarble-api-main/package.json`

**Step 1: Install dependencies**

Run:
```bash
cd jarble-api-main && npm install @modelcontextprotocol/sdk@^1.24.0
```

**Step 2: Verify installation**

Run:
```bash
cd jarble-api-main && node -e "const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js'); console.log('MCP SDK loaded:', typeof McpServer)"
```
Expected: `MCP SDK loaded: function`

**Step 3: Commit**

```bash
git add jarble-api-main/package.json jarble-api-main/package-lock.json
git commit -m "deps: add @modelcontextprotocol/sdk for MCP server"
```

---

## Task 2: Create MCP Server Adapter

Bridge the existing `ToolRegistry` (custom interface) to a real MCP server using `@modelcontextprotocol/sdk`.

**Files:**
- Create: `jarble-api-main/src/mcp/mcpServer.ts`

**Step 1: Write the MCP server adapter**

This file creates a real `McpServer` and registers all tools from the existing `ToolRegistry`, translating between the custom `McpTool` interface and MCP's `registerTool()` API.

```typescript
/**
 * Real MCP Server — wraps the existing ToolRegistry tools into
 * a @modelcontextprotocol/sdk McpServer with Streamable HTTP transport.
 *
 * Each deployment gets its own server session with userId + deploymentId context.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { mcpRegistry } from "./tools/index.js";
import type { ToolContext } from "./toolRegistry.js";
import { db, tables } from "../db/index.js";
import { eq } from "drizzle-orm";
import { logger } from "../utils/logger.js";

/**
 * Create a new MCP server instance pre-configured with all registered tools.
 * Each connection gets a fresh server with deployment-scoped context.
 */
export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer(
    { name: "jarble-openclaw", version: "1.0.0" },
    { capabilities: { logging: {} } }
  );

  // Register each tool from the existing registry
  for (const tool of mcpRegistry.getAll()) {
    // Convert JSON Schema parameters to a pass-through Zod schema.
    // The existing tools use raw JSON Schema; MCP SDK expects Zod.
    // We use z.object({}).passthrough() so any params are accepted,
    // and the tool's own execute() handles validation.
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: z.object({}).passthrough(),
      },
      async (params: Record<string, unknown>) => {
        try {
          const result = await tool.execute(params, ctx);

          // Map our ToolResult to MCP CallToolResult
          const content: Array<{ type: "text"; text: string }> = [
            { type: "text", text: result.message },
          ];

          // If tool returns structured data, include it as JSON
          if (result.data) {
            content.push({
              type: "text",
              text: JSON.stringify(result.data),
            });
          }

          return {
            content,
            isError: !result.success,
          };
        } catch (err: any) {
          logger.error(
            { tool: tool.name, deploymentId: ctx.deploymentId, err: err.message },
            "MCP tool execution error"
          );
          return {
            content: [{ type: "text", text: `Tool error: ${err.message}` }],
            isError: true,
          };
        }
      }
    );
  }

  return server;
}

/**
 * Build a ToolContext from userId + deploymentId.
 * Fetches the deployment from DB and verifies ownership.
 * Returns null if deployment not found or user doesn't own it.
 */
export async function buildToolContext(
  userId: string,
  deploymentId: string
): Promise<ToolContext | null> {
  const deployment = await db.query.deployments.findFirst({
    where: eq(tables.deployments.id, deploymentId),
  });

  if (!deployment) return null;
  if ((deployment as any).userId !== userId) return null;

  return {
    userId,
    deploymentId,
    deployment,
  };
}
```

**Step 2: Verify TypeScript compiles**

Run:
```bash
cd jarble-api-main && npx tsc --noEmit src/mcp/mcpServer.ts 2>&1 | head -20
```
Expected: No errors (or only pre-existing errors from other files).

**Step 3: Commit**

```bash
git add jarble-api-main/src/mcp/mcpServer.ts
git commit -m "feat: MCP server adapter wrapping existing tool registry"
```

---

## Task 3: Create Express MCP Endpoint

Wire the MCP server to an Express route at `/api/mcp/:deploymentId` with Auth0 JWT verification and Streamable HTTP transport.

**Files:**
- Create: `jarble-api-main/src/routes/mcp.ts`
- Modify: `jarble-api-main/src/index.ts` (mount route)

**Step 1: Create the MCP route handler**

```typescript
/**
 * MCP Endpoint — Streamable HTTP transport for Tambo's mcpServers.
 *
 * GET  /api/mcp/:deploymentId — SSE stream (MCP notifications + tool results)
 * POST /api/mcp/:deploymentId — MCP requests (tool calls)
 * DELETE /api/mcp/:deploymentId — Close session
 *
 * Auth: Bearer JWT (Auth0) — same as all other API endpoints.
 */
import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer, buildToolContext } from "../mcp/mcpServer.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { logger } from "../utils/logger.js";

export const mcpRouter = Router();

// ─── Session store — maps sessionId → { transport, deploymentId } ────────────

interface McpSession {
  transport: StreamableHTTPServerTransport;
  deploymentId: string;
  userId: string;
  createdAt: number;
}

const sessions = new Map<string, McpSession>();

// Clean up stale sessions every 5 minutes (sessions older than 30 min)
const SESSION_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
      logger.debug({ sessionId: id }, "MCP session expired");
    }
  }
}, 5 * 60 * 1000);

// ─── Auth middleware ─────────────────────────────────────────────────────────

async function authenticateRequest(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!bearerToken) return null;

  try {
    const payload = await verifyToken(bearerToken);
    const user = await getUserFromToken(payload);
    return user?.id || null;
  } catch {
    return null;
  }
}

// ─── POST — MCP requests (initialize, tool calls) ───────────────────────────

mcpRouter.post("/:deploymentId", async (req: Request, res: Response) => {
  const { deploymentId } = req.params;
  const userId = await authenticateRequest(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  // Check for existing session
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    // Existing session — forward request to transport
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res, req.body);
    return;
  }

  // New session — create MCP server + transport
  const ctx = await buildToolContext(userId, deploymentId);
  if (!ctx) {
    res.status(404).json({ error: "Deployment not found or access denied" });
    return;
  }

  const server = createMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  // Store session after transport generates its ID
  transport.onclose = () => {
    // Find and remove this session
    for (const [id, s] of sessions) {
      if (s.transport === transport) {
        sessions.delete(id);
        logger.debug({ sessionId: id, deploymentId }, "MCP session closed");
        break;
      }
    }
  };

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);

  // After handleRequest, the transport has a sessionId we can store
  const newSessionId = res.getHeader("mcp-session-id") as string | undefined;
  if (newSessionId) {
    sessions.set(newSessionId, {
      transport,
      deploymentId,
      userId,
      createdAt: Date.now(),
    });
    logger.info({ sessionId: newSessionId, deploymentId }, "MCP session created");
  }
});

// ─── GET — SSE stream for server-to-client notifications ─────────────────────

mcpRouter.get("/:deploymentId", async (req: Request, res: Response) => {
  const userId = await authenticateRequest(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({ error: "No active session. Send POST first to initialize." });
    return;
  }

  const session = sessions.get(sessionId)!;
  await session.transport.handleRequest(req, res);
});

// ─── DELETE — Close session ──────────────────────────────────────────────────

mcpRouter.delete("/:deploymentId", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;
  if (sessionId && sessions.has(sessionId)) {
    const session = sessions.get(sessionId)!;
    await session.transport.close();
    sessions.delete(sessionId);
  }
  res.status(200).json({ ok: true });
});
```

**Step 2: Mount the route in index.ts**

Add to `jarble-api-main/src/index.ts` after the existing route imports:

```typescript
import { mcpRouter } from "./routes/mcp.js";
```

And mount it after the other routes (before the health check):

```typescript
app.use("/api/mcp", mcpRouter);
```

**Step 3: Verify TypeScript compiles**

Run:
```bash
cd jarble-api-main && npx tsc --noEmit 2>&1 | head -30
```
Expected: No new errors.

**Step 4: Smoke test — start the API and hit the endpoint**

Run:
```bash
cd jarble-api-main && npm run dev:test
```

In another terminal, test the endpoint returns proper MCP response:
```bash
curl -X POST http://localhost:3001/api/mcp/test-deployment-id \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <test-token>" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0"}}}'
```
Expected: 401 Unauthorized (no valid token) or MCP initialize response with tools if auth passes.

**Step 5: Commit**

```bash
git add jarble-api-main/src/routes/mcp.ts jarble-api-main/src/index.ts
git commit -m "feat: MCP Streamable HTTP endpoint at /api/mcp/:deploymentId"
```

---

## Task 4: Add PVC Filesystem Tools

Add new tools for browsing and reading files on the deployment's PVC, using kubectl exec.

**Files:**
- Create: `jarble-api-main/src/mcp/tools/listFiles.ts`
- Create: `jarble-api-main/src/mcp/tools/readFile.ts`
- Create: `jarble-api-main/src/mcp/tools/writeFile.ts`
- Modify: `jarble-api-main/src/mcp/tools/index.ts` (register new tools)

**Step 1: Create listFiles tool**

```typescript
/**
 * list_files — Browse directories on the deployment PVC via kubectl exec.
 */
import { findPodForDeployment, execInPod } from "../../k8s/index.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

const ALLOWED_BASE = "/data";
const BLOCKED_DIRS = ["/data/runtime/node_modules", "/data/.npm"];

function isPathSafe(path: string): boolean {
  const normalized = path.replace(/\/+/g, "/").replace(/\/$/, "");
  if (!normalized.startsWith(ALLOWED_BASE)) return false;
  if (normalized.includes("..")) return false;
  for (const blocked of BLOCKED_DIRS) {
    if (normalized.startsWith(blocked)) return false;
  }
  return true;
}

export const listFilesTool: McpTool = {
  name: "list_files",
  description:
    "List files and directories on the bot's PVC. Path must be under /data/. Returns file names, sizes, and types.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory path to list (default: /data/)",
      },
    },
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const path = (params.path as string) || "/data";

    if (!isPathSafe(path)) {
      return { success: false, message: `Path "${path}" is not allowed. Must be under /data/ and not in blocked directories.` };
    }

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false });
    if (!podName) {
      return { success: false, message: "No running pod found." };
    }

    try {
      const output = await execInPod(podName, [
        "ls", "-la", "--time-style=iso", path,
      ]);
      return {
        success: true,
        message: `Contents of ${path}:\n${output}`,
        data: { path, listing: output },
      };
    } catch (err: any) {
      logger.warn({ deploymentId: ctx.deploymentId, path, err: err.message }, "list_files failed");
      return { success: false, message: `Failed to list ${path}: ${err.message}` };
    }
  },
};
```

**Step 2: Create readFile tool**

```typescript
/**
 * read_file — Read a file from the deployment PVC via kubectl exec.
 */
import { findPodForDeployment, execInPod } from "../../k8s/index.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

const ALLOWED_BASE = "/data";
const MAX_SIZE_BYTES = 1_000_000; // 1MB

function isPathSafe(path: string): boolean {
  const normalized = path.replace(/\/+/g, "/").replace(/\/$/, "");
  if (!normalized.startsWith(ALLOWED_BASE)) return false;
  if (normalized.includes("..")) return false;
  return true;
}

export const readFileTool: McpTool = {
  name: "read_file",
  description:
    "Read a file from the bot's PVC. Path must be under /data/. Max 1MB. Returns the file content as text.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute file path on the PVC (e.g. /data/config/soul.md)",
      },
    },
    required: ["path"],
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const path = params.path as string;
    if (!path) {
      return { success: false, message: "Missing required parameter 'path'." };
    }

    if (!isPathSafe(path)) {
      return { success: false, message: `Path "${path}" is not allowed. Must be under /data/.` };
    }

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false });
    if (!podName) {
      return { success: false, message: "No running pod found." };
    }

    try {
      // Check file size first
      const sizeOutput = await execInPod(podName, ["stat", "-c", "%s", path]);
      const size = parseInt(sizeOutput.trim(), 10);
      if (size > MAX_SIZE_BYTES) {
        return {
          success: false,
          message: `File is ${(size / 1024 / 1024).toFixed(1)}MB, exceeds 1MB limit. Use list_files to browse.`,
        };
      }

      const content = await execInPod(podName, ["cat", path]);
      return {
        success: true,
        message: content || "(empty file)",
        data: { path, size, content },
      };
    } catch (err: any) {
      logger.warn({ deploymentId: ctx.deploymentId, path, err: err.message }, "read_file failed");
      return { success: false, message: `Failed to read ${path}: ${err.message}` };
    }
  },
};
```

**Step 3: Create writeFile tool**

```typescript
/**
 * write_file — Write content to a file on the deployment PVC via kubectl exec.
 */
import { findPodForDeployment, execInPodWithStdin } from "../../k8s/index.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

const ALLOWED_BASE = "/data";
const BLOCKED_PATHS = ["/data/.initialized", "/data/runtime", "/data/.npm"];
const MAX_SIZE_BYTES = 1_000_000; // 1MB

function isWriteSafe(path: string): boolean {
  const normalized = path.replace(/\/+/g, "/").replace(/\/$/, "");
  if (!normalized.startsWith(ALLOWED_BASE)) return false;
  if (normalized.includes("..")) return false;
  for (const blocked of BLOCKED_PATHS) {
    if (normalized === blocked || normalized.startsWith(blocked + "/")) return false;
  }
  return true;
}

export const writeFileTool: McpTool = {
  name: "write_file",
  description:
    "Write content to a file on the bot's PVC. Path must be under /data/. Cannot write to .initialized, runtime/, or .npm/. Max 1MB.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute file path on the PVC (e.g. /data/config/soul.md)",
      },
      content: {
        type: "string",
        description: "The file content to write",
      },
    },
    required: ["path", "content"],
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const path = params.path as string;
    const content = params.content as string;

    if (!path || content === undefined) {
      return { success: false, message: "Missing required parameters 'path' and 'content'." };
    }

    if (!isWriteSafe(path)) {
      return { success: false, message: `Cannot write to "${path}". Blocked or outside /data/.` };
    }

    if (content.length > MAX_SIZE_BYTES) {
      return { success: false, message: `Content exceeds 1MB limit.` };
    }

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false });
    if (!podName) {
      return { success: false, message: "No running pod found." };
    }

    try {
      await execInPodWithStdin(
        podName,
        ["sh", "-c", `cat > '${path.replace(/'/g, "'\\''")}'`],
        content
      );

      logger.info({ deploymentId: ctx.deploymentId, path, size: content.length }, "write_file: success");
      return {
        success: true,
        message: `File written to ${path} (${content.length} bytes).`,
      };
    } catch (err: any) {
      logger.warn({ deploymentId: ctx.deploymentId, path, err: err.message }, "write_file failed");
      return { success: false, message: `Failed to write ${path}: ${err.message}` };
    }
  },
};
```

**Step 4: Register new tools in index.ts**

Add to `jarble-api-main/src/mcp/tools/index.ts`:

```typescript
import { listFilesTool } from "./listFiles.js";
import { readFileTool } from "./readFile.js";
import { writeFileTool } from "./writeFile.js";

// Filesystem tools
mcpRegistry.register(listFilesTool);
mcpRegistry.register(readFileTool);
mcpRegistry.register(writeFileTool);
```

**Step 5: Verify TypeScript compiles**

Run:
```bash
cd jarble-api-main && npx tsc --noEmit 2>&1 | head -20
```

**Step 6: Commit**

```bash
git add jarble-api-main/src/mcp/tools/listFiles.ts jarble-api-main/src/mcp/tools/readFile.ts jarble-api-main/src/mcp/tools/writeFile.ts jarble-api-main/src/mcp/tools/index.ts
git commit -m "feat: add PVC filesystem tools (list_files, read_file, write_file)"
```

---

## Task 5: Add Pairing CLI Tools

Add tools for managing OpenClaw pairing via the CLI.

**Files:**
- Create: `jarble-api-main/src/mcp/tools/pairing.ts`
- Modify: `jarble-api-main/src/mcp/tools/index.ts`

**Step 1: Create pairing tools**

```typescript
/**
 * Pairing tools — list and approve OpenClaw pairings via CLI.
 */
import { findPodForDeployment, execInPod } from "../../k8s/index.js";
import { logger } from "../../utils/logger.js";
import type { McpTool, ToolResult, ToolContext } from "../toolRegistry.js";

export const pairingListTool: McpTool = {
  name: "pairing_list",
  description:
    "List pending and active pairings for a messaging platform. Shows pairing codes and status.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: ["telegram", "discord", "slack", "whatsapp"],
        description: "The messaging platform to list pairings for",
      },
    },
    required: ["platform"],
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const platform = params.platform as string;
    if (!platform) {
      return { success: false, message: "Missing required parameter 'platform'." };
    }

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false });
    if (!podName) {
      return { success: false, message: "No running pod found." };
    }

    try {
      const output = await execInPod(podName, [
        "npx", "openclaw", "pairing", "list", platform, "--json",
      ]);

      let pairings: any[];
      try {
        pairings = JSON.parse(output);
      } catch {
        return { success: true, message: output || "No pairings found.", data: { pairings: [] } };
      }

      return {
        success: true,
        message: `${pairings.length} pairing(s) for ${platform}.`,
        data: { platform, pairings },
      };
    } catch (err: any) {
      logger.warn({ deploymentId: ctx.deploymentId, platform, err: err.message }, "pairing_list failed");
      return { success: false, message: `Failed to list pairings: ${err.message}` };
    }
  },
};

export const pairingApproveTool: McpTool = {
  name: "pairing_approve",
  description:
    "Approve a pending pairing for a messaging platform. Requires the platform and pairing code.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: ["telegram", "discord", "slack", "whatsapp"],
        description: "The messaging platform",
      },
      code: {
        type: "string",
        description: "The pairing code to approve",
      },
    },
    required: ["platform", "code"],
  },
  async execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const platform = params.platform as string;
    const code = params.code as string;

    if (!platform || !code) {
      return { success: false, message: "Missing required parameters 'platform' and 'code'." };
    }

    const podName = await findPodForDeployment(ctx.deploymentId, { requireReady: false });
    if (!podName) {
      return { success: false, message: "No running pod found." };
    }

    try {
      const output = await execInPod(podName, [
        "npx", "openclaw", "pairing", "approve", platform, code, "--notify",
      ]);

      logger.info({ deploymentId: ctx.deploymentId, platform, code }, "pairing_approve: success");
      return {
        success: true,
        message: `Pairing approved for ${platform}. ${output}`,
      };
    } catch (err: any) {
      logger.warn({ deploymentId: ctx.deploymentId, platform, code, err: err.message }, "pairing_approve failed");
      return { success: false, message: `Failed to approve pairing: ${err.message}` };
    }
  },
};
```

**Step 2: Register in index.ts**

Add to `jarble-api-main/src/mcp/tools/index.ts`:

```typescript
import { pairingListTool, pairingApproveTool } from "./pairing.js";

// Pairing tools
mcpRegistry.register(pairingListTool);
mcpRegistry.register(pairingApproveTool);
```

**Step 3: Commit**

```bash
git add jarble-api-main/src/mcp/tools/pairing.ts jarble-api-main/src/mcp/tools/index.ts
git commit -m "feat: add pairing_list and pairing_approve MCP tools"
```

---

## Task 6: Install Tambo MCP Dependencies in Frontend

**Files:**
- Modify: `Jarble-mvp/package.json`

**Step 1: Install MCP peer dependencies**

Run:
```bash
cd Jarble-mvp && npm install @modelcontextprotocol/sdk@^1.24.0 zod-to-json-schema@^3.25.0
```

Note: Check if `@tambo-ai/react` already bundles these. If `@tambo-ai/react/mcp` import works without them, skip this step.

**Step 2: Verify the MCP subpath import works**

Run:
```bash
cd Jarble-mvp && node -e "import('@tambo-ai/react/mcp').then(m => console.log('MCPTransport:', Object.keys(m))).catch(e => console.log('Error:', e.message))"
```

If this fails, check `@tambo-ai/react` package exports to find the correct import path for `MCPTransport`.

**Step 3: Commit**

```bash
git add Jarble-mvp/package.json Jarble-mvp/package-lock.json
git commit -m "deps: add MCP SDK peer deps for Tambo MCP integration"
```

---

## Task 7: Update DeploymentTamboProvider to Use MCP

Connect Tambo to the API's MCP endpoint. Refactor tools to only keep infrastructure tools.

**Files:**
- Modify: `Jarble-mvp/components/DeploymentTamboProvider.tsx`
- Modify: `Jarble-mvp/lib/tambo-tools.ts`
- Modify: `Jarble-mvp/lib/tambo.ts`

**Step 1: Refactor tambo-tools.ts — keep only infrastructure tools**

Remove the `chatWithBot` tool, `callPodProxy`, `onUIBlocks`, and all SSE parsing. Keep only:
- `startDeployment`
- `stopDeployment`
- `restartDeployment`
- `deleteDeployment`
- `changeLlmApiKey`
- `getDeploymentLogs`
- `getDeploymentStatus`

The chat, UI, config, data, and filesystem tools are now provided by the MCP server.

Remove from `tambo-tools.ts`:
- `UIBlockResult` interface and related types
- `onUIBlocks` / `emitUIBlocks` / `listeners` (UI block side-channel)
- `JARBLE_UI_FENCE` regex and `BOT_TO_TAMBO_NAME` mapping
- `callPodProxy` function
- The `chatWithBot` tool definition

**Step 2: Update DeploymentTamboProvider to add mcpServers**

```tsx
"use client";

import { useMemo, useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { TamboProvider, type ContextHelpers } from "@tambo-ai/react";
import { tamboComponents, createTamboTools } from "@/lib/tambo";
import { API_URL } from "@/lib/trpc";

const TAMBO_API_KEY = process.env.NEXT_PUBLIC_TAMBO_API_KEY!;

const AGENT_INSTRUCTIONS = `You are Jarble, connected to the user's OpenClaw bot via MCP.

The bot exposes its full capabilities through MCP tools:
- chat_with_bot: Talk to the bot directly
- get_deployment_info, get_platforms, list_skills: View bot status and configuration
- update_system_prompt, update_llm_config: Modify bot settings
- connect_platform, disconnect_platform: Manage messaging integrations
- install_skill, uninstall_skill: Manage bot skills
- render_ui, define_component, list_components: Create visual dashboards
- list_files, read_file, write_file: Browse the bot's filesystem
- get_logs: View pod logs for debugging
- pairing_list, pairing_approve: Manage platform pairings

ROUTING:
- ALL user messages and questions → use chat_with_bot (let the bot handle it)
- The ONLY exceptions are infrastructure actions the bot CANNOT do:
  • restart/stop/start/delete → use infrastructure tools (these control the pod)
  • change API key → use changeLlmApiKey
  • show pod logs or check if pod is running → use getDeploymentLogs / getDeploymentStatus

For destructive actions (restart, stop, delete), ALWAYS render ConfirmAction first.
Present the bot's text response naturally — the frontend handles markdown rendering.`;

interface DeploymentTamboProviderProps {
  deploymentId: string;
  deploymentName: string;
  children: React.ReactNode;
}

export default function DeploymentTamboProvider({
  deploymentId,
  deploymentName,
  children,
}: DeploymentTamboProviderProps) {
  const { user, getAccessTokenSilently } = useAuth0();

  const tools = useMemo(
    () => createTamboTools(deploymentId),
    [deploymentId]
  );

  const contextHelpers: ContextHelpers = useMemo(
    () => ({
      agentInstructions: () => AGENT_INSTRUCTIONS,
      deploymentContext: () => ({
        deploymentId,
        deploymentName,
      }),
    }),
    [deploymentId, deploymentName]
  );

  // MCP server configuration — connects to the API's MCP endpoint
  // which wraps all OpenClaw tools via the @modelcontextprotocol/sdk
  const mcpServers = useMemo(() => {
    // We need the auth token for MCP requests.
    // Tambo's customHeaders is evaluated per-request if it's a function,
    // but the current API uses a static object. We'll set the token
    // on first render and rely on Tambo refreshing connections.
    return [
      {
        url: `${API_URL}/api/mcp/${deploymentId}`,
        serverKey: "openclaw",
        // Note: customHeaders needs a valid token. If Tambo supports
        // async header resolution, use getAccessTokenSilently().
        // Otherwise, we'll need to handle token refresh differently.
        customHeaders: {},
        transport: "streamable-http" as const,
      },
    ];
  }, [deploymentId]);

  return (
    <TamboProvider
      apiKey={TAMBO_API_KEY}
      userKey={user?.sub || "anonymous"}
      components={tamboComponents}
      tools={tools}
      mcpServers={mcpServers}
      contextHelpers={contextHelpers}
      autoGenerateThreadName={false}
      initialMessages={[
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: `Hey! I'm connected to **${deploymentName}** via MCP. Talk to your bot through me — I'll render its responses. I can also manage config, platforms, skills, and restart/stop the pod if needed.`,
            },
          ],
        },
      ]}
    >
      {children}
    </TamboProvider>
  );
}
```

**Important:** The exact `mcpServers` prop format and `transport` value need to be verified against the installed `@tambo-ai/react` version. Check the package's TypeScript types:
```bash
cd Jarble-mvp && grep -r "mcpServers" node_modules/@tambo-ai/react/dist/ | head -10
```

Also verify the `MCPTransport` enum or string values:
```bash
cd Jarble-mvp && grep -r "MCPTransport\|transport.*sse\|transport.*http" node_modules/@tambo-ai/react/dist/ | head -10
```

**Step 3: Handle Auth Token for MCP**

The MCP endpoint requires a Bearer token. Tambo's `customHeaders` may not support async token resolution. If not, we need to fetch the token before rendering TamboProvider:

```tsx
// In DeploymentTamboProvider, before the return:
const [authToken, setAuthToken] = useState<string | null>(null);

useEffect(() => {
  getAccessTokenSilently().then(setAuthToken).catch(() => {});
}, [getAccessTokenSilently]);

// In mcpServers config:
customHeaders: authToken ? { Authorization: `Bearer ${authToken}` } : {},
```

And conditionally render TamboProvider only when `authToken` is available, or let MCP connections fail gracefully and retry.

**Step 4: Verify build**

Run:
```bash
cd Jarble-mvp && npm run check
```
Expected: No new TypeScript errors.

**Step 5: Commit**

```bash
git add Jarble-mvp/components/DeploymentTamboProvider.tsx Jarble-mvp/lib/tambo-tools.ts Jarble-mvp/lib/tambo.ts
git commit -m "feat: connect Tambo to MCP server, refactor to infrastructure-only tools"
```

---

## Task 8: Clean Up Legacy Chat Plumbing

Remove the old chat proxy route and UI block side-channel now that MCP handles everything.

**Files:**
- Modify: `jarble-api-main/src/index.ts` (remove tamboAgent import if fully replaced)
- Modify: `Jarble-mvp/lib/tambo-tools.ts` (verify chatWithBot removed)
- Modify: `Jarble-mvp/app/d/[id]/page.tsx` (remove onUIBlocks subscription if present)

**Step 1: Check what page.tsx uses from the old system**

Read `Jarble-mvp/app/d/[id]/page.tsx` and remove any `onUIBlocks` subscriptions or `callPodProxy`-related code. The MCP chat_with_bot tool now returns results through Tambo's standard rendering pipeline.

**Step 2: Keep tamboAgent.ts for backward compatibility (for now)**

Don't delete `tamboAgent.ts` yet — keep it as a fallback. Once MCP is verified working end-to-end, it can be removed in a follow-up PR.

**Step 3: Commit**

```bash
git add -A
git commit -m "refactor: clean up legacy UI block side-channel, chat proxied via MCP"
```

---

## Task 9: End-to-End Integration Test

Manual testing checklist (no automated test — this is integration across 3 systems):

**Step 1: Start API with MCP endpoint**
```bash
cd jarble-api-main && npm run dev:test
```

**Step 2: Start frontend**
```bash
cd Jarble-mvp && npm run dev
```

**Step 3: Verify MCP tools are discovered**
- Open browser, navigate to a deployment page
- Open browser DevTools Network tab
- Look for requests to `/api/mcp/{deploymentId}`
- Verify the MCP initialize response includes all registered tools

**Step 4: Test chat through MCP**
- Type a message in the Tambo chat
- Verify the message goes through MCP `chat_with_bot` tool
- Verify the bot responds

**Step 5: Test config tools**
- Ask "what's my system prompt?" — should use `update_system_prompt` (read mode)
- Ask "what platforms are connected?" — should use `get_platforms`
- Ask "list my skills" — should use `list_skills`

**Step 6: Test filesystem tools**
- Ask "list files in /data/" — should use `list_files`
- Ask "read /data/config/soul.md" — should use `read_file`

**Step 7: Test infrastructure tools (still via Tambo defineTool)**
- Ask "restart my bot" — should render ConfirmAction component
- Ask "show pod logs" — should use `getDeploymentLogs` infrastructure tool

---

## Summary of Changes

### New Files
| File | Purpose |
|------|---------|
| `jarble-api-main/src/mcp/mcpServer.ts` | MCP server adapter wrapping ToolRegistry |
| `jarble-api-main/src/routes/mcp.ts` | Express route with Streamable HTTP transport + auth |
| `jarble-api-main/src/mcp/tools/listFiles.ts` | PVC directory listing tool |
| `jarble-api-main/src/mcp/tools/readFile.ts` | PVC file reading tool |
| `jarble-api-main/src/mcp/tools/writeFile.ts` | PVC file writing tool |
| `jarble-api-main/src/mcp/tools/pairing.ts` | OpenClaw pairing management tools |

### Modified Files
| File | Change |
|------|--------|
| `jarble-api-main/src/index.ts` | Mount `/api/mcp` route |
| `jarble-api-main/src/mcp/tools/index.ts` | Register 5 new tools |
| `Jarble-mvp/components/DeploymentTamboProvider.tsx` | Add mcpServers config, update agent instructions |
| `Jarble-mvp/lib/tambo-tools.ts` | Remove chatWithBot, keep infrastructure tools only |
| `Jarble-mvp/lib/tambo.ts` | Remove chatWithBot re-export |

### Dependencies
| Package | Where | Version |
|---------|-------|---------|
| `@modelcontextprotocol/sdk` | jarble-api-main | ^1.24.0 |
| `@modelcontextprotocol/sdk` | Jarble-mvp (peer dep) | ^1.24.0 |
| `zod-to-json-schema` | Jarble-mvp (peer dep) | ^3.25.0 |

### Tool Count
- **Existing tools (wrapped):** 18 (chat, config, platforms, skills, lifecycle, UI, logs, WhatsApp QR)
- **New tools:** 5 (list_files, read_file, write_file, pairing_list, pairing_approve)
- **Total MCP tools:** 23
- **Infrastructure tools (Tambo defineTool):** 7 (start, stop, restart, delete, changeLlmApiKey, getDeploymentLogs, getDeploymentStatus)

## Sources

- [MCP TypeScript SDK — Server Docs](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/docs/server.md)
- [Tambo MCP Server Guide](https://github.com/tambo-ai/tambo/blob/main/docs/content/docs/guides/connect-mcp-servers.mdx)
- [Tambo MCP Template](https://github.com/tambo-ai/mcp-template)
- [MCP Transports — Streamable HTTP](https://modelcontextprotocol.io/legacy/concepts/transports)
