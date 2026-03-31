/**
 * Orchestration WebSocket - /ws/orchestration
 *
 * Pushes real-time orchestration events to the frontend when the bot
 * delegates work to subagents, platform agents, or team members.
 *
 * Auth: JWT token in query param `?token=<JWT>&deploymentId=<ID>`
 *
 * Follows the same pattern as chatControl.ts / terminal.ts for WS setup.
 */

import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import {
  agentCallEvents,
  type OrchestrationStepEvent,
  type OrchestrationStepEndEvent,
} from "../utils/agentCallEvents.js";
import { createModuleLogger } from "../utils/logger.js";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";

const log = createModuleLogger("orchestration");

// ── Connection limits ──────────────────────────────────────────────────────
const MAX_CONNECTIONS_PER_DEPLOYMENT = 3;
const PING_INTERVAL_MS = 30_000;

// Track active connections per deployment
const deploymentConnections = new Map<string, number>();

function acquireConnection(deploymentId: string): string | null {
  const count = deploymentConnections.get(deploymentId) ?? 0;
  if (count >= MAX_CONNECTIONS_PER_DEPLOYMENT) {
    return "Too many orchestration connections for this deployment (max 3)";
  }
  deploymentConnections.set(deploymentId, count + 1);
  return null;
}

function releaseConnection(deploymentId: string): void {
  const count = deploymentConnections.get(deploymentId) ?? 0;
  if (count <= 1) {
    deploymentConnections.delete(deploymentId);
  } else {
    deploymentConnections.set(deploymentId, count - 1);
  }
}

// ── Message types ──────────────────────────────────────────────────────────

interface ClientMessage {
  type: "cancel" | "ping";
  stepId?: string;
}

interface ServerMessage {
  type: "step.start" | "step.end" | "pong" | "error";
  [key: string]: unknown;
}

function sendJson(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Attach WebSocket server to HTTP server ─────────────────────────────────

export function attachOrchestrationWs(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request, socket, head) => {
    // Only handle /ws/orchestration
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname !== "/ws/orchestration") return;

    const token = url.searchParams.get("token");
    const deploymentId = url.searchParams.get("deploymentId");

    if (!token || !deploymentId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    // Authenticate
    let user: Awaited<ReturnType<typeof getUserFromToken>>;
    try {
      const payload = await verifyToken(token);
      user = await getUserFromToken(payload);
    } catch (err) {
      log.warn({ err }, "Orchestration WS auth failed");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!user) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Verify deployment ownership
    const deployment = await db.query.deployments.findFirst({
      where: and(
        eq(tables.deployments.id, deploymentId),
        eq(tables.deployments.userId, user.id),
      ),
    });

    if (!deployment) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    // Check connection limits
    const limitError = acquireConnection(deploymentId);
    if (limitError) {
      socket.write("HTTP/1.1 429 Too Many Requests\r\n\r\n");
      socket.destroy();
      return;
    }

    // Accept the WebSocket connection
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, { user, deploymentId });
    });
  });

  wss.on("connection", (ws: WebSocket, _request: http.IncomingMessage, ctx: { user: { id: string }; deploymentId: string }) => {
    const { user, deploymentId } = ctx;
    log.info({ deploymentId, userId: user.id }, "Orchestration WS connected");

    // ── Subscribe to orchestration events ──────────────────────────────
    const onStepStart = (event: OrchestrationStepEvent) => {
      if (event.deploymentId !== deploymentId) return;
      sendJson(ws, { type: "step.start", ...event });
    };

    const onStepEnd = (event: OrchestrationStepEndEvent) => {
      if (event.deploymentId !== deploymentId) return;
      sendJson(ws, { type: "step.end", ...event });
    };

    agentCallEvents.on("orchestration:step:start", onStepStart);
    agentCallEvents.on("orchestration:step:end", onStepEnd);

    // ── Ping/pong keepalive ────────────────────────────────────────────
    const pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, PING_INTERVAL_MS);

    // ── Cleanup ────────────────────────────────────────────────────────
    const cleanup = () => {
      agentCallEvents.off("orchestration:step:start", onStepStart);
      agentCallEvents.off("orchestration:step:end", onStepEnd);
      clearInterval(pingTimer);
      releaseConnection(deploymentId);
    };

    // ── Handle client messages ─────────────────────────────────────────
    ws.on("message", (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());

        switch (msg.type) {
          case "cancel": {
            // Store for future use - log for now
            log.info({ deploymentId, stepId: msg.stepId }, "Client requested step cancellation");
            break;
          }
          case "ping": {
            sendJson(ws, { type: "pong" });
            break;
          }
          default: {
            sendJson(ws, { type: "error", message: "Unknown message type" });
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      log.debug({ deploymentId, userId: user.id }, "Orchestration WS disconnected");
      cleanup();
    });

    ws.on("error", (err) => {
      log.warn({ err, deploymentId }, "Orchestration WS error");
      cleanup();
    });
  });

  log.info("Orchestration WebSocket server attached at /ws/orchestration");
}
