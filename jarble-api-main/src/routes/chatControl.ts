/**
 * Chat Control WebSocket — /ws/chat
 *
 * Lightweight control channel for chat operations that don't fit in SSE:
 * - Stop generation (abort active SSE run)
 * - Typing indicators
 * - Ping/pong keep-alive
 *
 * Auth: JWT token in query param `?token=<JWT>&deploymentId=<ID>`
 * Feature-gated: only active when ENABLE_CHAT_WS is set.
 *
 * Follows the same pattern as terminal.ts for WS setup.
 */

import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { sessionManager } from "../services/chatSessionManager.js";
import { createModuleLogger } from "../utils/logger.js";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";

const log = createModuleLogger("chatControl");

// ── Message types ──────────────────────────────────────────────────────────

interface ClientMessage {
  type: "stop" | "typing" | "ping";
  isTyping?: boolean;
}

interface ServerMessage {
  type: "pong" | "stopped" | "error";
  message?: string;
}

function sendJson(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Attach WebSocket server to HTTP server ─────────────────────────────────

export function attachChatControlWs(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request, socket, head) => {
    // Only handle /ws/chat
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname !== "/ws/chat") return;

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
      log.warn({ err }, "Chat control WS auth failed");
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

    // Accept the WebSocket connection
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request, { user, deploymentId });
    });
  });

  wss.on("connection", (ws: WebSocket, _request: http.IncomingMessage, ctx: { user: { id: string }; deploymentId: string }) => {
    const { user, deploymentId } = ctx;
    log.info({ deploymentId, userId: user.id }, "Chat control WS connected");

    ws.on("message", (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());

        switch (msg.type) {
          case "stop": {
            const aborted = sessionManager.abortRun(deploymentId);
            sendJson(ws, { type: "stopped", message: aborted ? "Generation stopped" : "No active generation" });
            break;
          }
          case "typing": {
            sessionManager.setTyping(deploymentId, msg.isTyping ?? false);
            break;
          }
          case "ping": {
            sendJson(ws, { type: "pong" });
            break;
          }
          default: {
            sendJson(ws, { type: "error", message: `Unknown message type` });
          }
        }
      } catch {
        // Ignore malformed messages
      }
    });

    ws.on("close", () => {
      log.debug({ deploymentId, userId: user.id }, "Chat control WS disconnected");
    });

    ws.on("error", (err) => {
      log.warn({ err, deploymentId }, "Chat control WS error");
    });
  });

  log.info("Chat control WebSocket server attached at /ws/chat");
}
