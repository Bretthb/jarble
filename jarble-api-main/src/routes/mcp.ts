/**
 * MCP Streamable HTTP Endpoint - Serves MCP protocol at /api/mcp/:deploymentId
 *
 * Exposes the Jarble deployment management tools (from mcpServer.ts) over
 * the standard MCP Streamable HTTP transport so external MCP clients (Claude
 * Desktop, Cursor, Tambo, etc.) can connect and call tools.
 *
 * Three handlers:
 *   POST /:deploymentId  - MCP requests (initialize, tool calls)
 *   GET  /:deploymentId  - SSE stream for server-to-client notifications
 *   DELETE /:deploymentId - Close/terminate session
 *
 * Sessions are keyed by the `mcp-session-id` response header and cleaned
 * up after 30 minutes of inactivity (checked every 5 minutes).
 */

import { Router, type Request, type Response } from "express";
import { randomUUID } from "crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createMcpServer, buildToolContext } from "../mcp/mcpServer.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("mcp");

// ─── Types ──────────────────────────────────────────────────────────────────

interface McpSession {
  transport: StreamableHTTPServerTransport;
  deploymentId: string;
  userId: string;
  createdAt: Date;
  lastAccessedAt: Date;
}

// ─── Session Store ──────────────────────────────────────────────────────────

const sessions = new Map<string, McpSession>();

/** TTL for idle sessions: 30 minutes */
const SESSION_TTL_MS = 30 * 60 * 1000;

/** Cleanup interval: every 5 minutes */
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

/** Periodic cleanup of stale sessions */
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions) {
    if (now - session.lastAccessedAt.getTime() > SESSION_TTL_MS) {
      log.info(
        { sessionId, deploymentId: session.deploymentId },
        "MCP session expired, closing transport",
      );
      session.transport.close().catch((err) => {
        log.warn({ err, sessionId }, "Error closing expired MCP transport");
      });
      sessions.delete(sessionId);
    }
  }
}, CLEANUP_INTERVAL_MS);

// Don't let the timer prevent process exit
cleanupTimer.unref();

// ─── Auth Helper ────────────────────────────────────────────────────────────

/**
 * Authenticate the request via Bearer JWT. Returns the internal user ID
 * on success, or sends an error response and returns null.
 */
async function authenticate(
  req: Request,
  res: Response,
): Promise<string | null> {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!bearerToken) {
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Unauthorized: missing Bearer token" },
      id: null,
    });
    return null;
  }

  try {
    const payload = await verifyToken(bearerToken);
    const user = await getUserFromToken(payload);
    if (!user) {
      res.status(401).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Unauthorized: user not found" },
        id: null,
      });
      return null;
    }
    return user.id;
  } catch (err) {
    log.debug({ err }, "MCP auth: token verification failed");
    res.status(401).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Unauthorized: invalid token" },
      id: null,
    });
    return null;
  }
}

// ─── Router ─────────────────────────────────────────────────────────────────

export const mcpRouter = Router();

// ── POST /:deploymentId - MCP requests (initialize, tool calls) ─────────

mcpRouter.post("/:deploymentId", async (req: Request, res: Response) => {
  const { deploymentId } = req.params;

  // 1. Authenticate
  const userId = await authenticate(req, res);
  if (!userId) return; // response already sent

  // 2. Check for existing session
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    // Reuse existing transport
    const session = sessions.get(sessionId)!;
    session.lastAccessedAt = new Date();

    try {
      await session.transport.handleRequest(req, res, req.body);
    } catch (err) {
      log.error(
        { err, sessionId, deploymentId },
        "MCP POST: error handling request on existing session",
      );
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
    return;
  }

  // 3. New session - must be an initialization request
  if (!isInitializeRequest(req.body)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Bad Request: no valid session ID and not an initialization request",
      },
      id: null,
    });
    return;
  }

  // 4. Build tool context (verifies deployment exists + ownership)
  const ctx = await buildToolContext(userId, deploymentId);
  if (!ctx) {
    res.status(404).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Deployment not found or access denied",
      },
      id: null,
    });
    return;
  }

  // 5. Create transport + server
  try {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (newSessionId: string) => {
        log.info(
          { sessionId: newSessionId, deploymentId, userId },
          "MCP session initialized",
        );
        // Store session keyed by the transport-generated session ID
        sessions.set(newSessionId, {
          transport,
          deploymentId,
          userId,
          createdAt: new Date(),
          lastAccessedAt: new Date(),
        });
      },
    });

    // Clean up session on transport close
    transport.onclose = () => {
      const sid = transport.sessionId;
      if (sid && sessions.has(sid)) {
        log.info({ sessionId: sid, deploymentId }, "MCP transport closed, removing session");
        sessions.delete(sid);
      }
    };

    transport.onerror = (error) => {
      log.error(
        { error: error.message, deploymentId },
        "MCP transport error",
      );
    };

    // 6. Create MCP server and connect
    const server = createMcpServer(ctx);
    await server.connect(transport);

    // 7. Handle the initialization request
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    log.error(
      { err, deploymentId },
      "MCP POST: error during session initialization",
    );
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// ── GET /:deploymentId - SSE stream for server-to-client notifications ──

mcpRouter.get("/:deploymentId", async (req: Request, res: Response) => {
  // 1. Authenticate
  const userId = await authenticate(req, res);
  if (!userId) return;

  // 2. Look up session
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Invalid or missing session ID",
      },
      id: null,
    });
    return;
  }

  const session = sessions.get(sessionId)!;
  session.lastAccessedAt = new Date();

  try {
    await session.transport.handleRequest(req, res);
  } catch (err) {
    log.error(
      { err, sessionId },
      "MCP GET: error handling SSE stream request",
    );
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }
});

// ── DELETE /:deploymentId - Close session ───────────────────────────────

mcpRouter.delete("/:deploymentId", async (req: Request, res: Response) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (!sessionId || !sessions.has(sessionId)) {
    res.status(400).json({
      jsonrpc: "2.0",
      error: {
        code: -32000,
        message: "Invalid or missing session ID",
      },
      id: null,
    });
    return;
  }

  const session = sessions.get(sessionId)!;

  log.info(
    { sessionId, deploymentId: session.deploymentId },
    "MCP DELETE: closing session",
  );

  try {
    await session.transport.handleRequest(req, res);
  } catch (err) {
    log.error(
      { err, sessionId },
      "MCP DELETE: error handling session termination",
    );
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  }

  // Ensure cleanup regardless of transport.handleRequest outcome
  try {
    await session.transport.close();
  } catch {
    // transport.onclose callback handles session map removal
  }
  sessions.delete(sessionId);
});
