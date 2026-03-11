import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import stream from "stream";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { findPodForDeployment, execClient } from "../k8s/index.js";
import { NAMESPACE, LEGACY_CONTAINER_NAME } from "../k8s/constants.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("terminal");

// ── Connection limits ──────────────────────────────────────────────────────
const MAX_TERMINALS_PER_USER = 3;
const MAX_TERMINALS_PER_DEPLOYMENT = 1;
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const PING_INTERVAL_MS = 30_000;

// Track active sessions
const userSessions = new Map<string, number>();
const deploymentSessions = new Set<string>();

function acquireSession(userId: string, deploymentId: string): string | null {
  const userCount = userSessions.get(userId) ?? 0;
  if (userCount >= MAX_TERMINALS_PER_USER) return "Too many terminal sessions (max 3)";
  if (deploymentSessions.has(deploymentId)) return "Terminal already open for this deployment";
  userSessions.set(userId, userCount + 1);
  deploymentSessions.add(deploymentId);
  return null;
}

function releaseSession(userId: string, deploymentId: string): void {
  const count = userSessions.get(userId) ?? 0;
  if (count <= 1) {
    userSessions.delete(userId);
  } else {
    userSessions.set(userId, count - 1);
  }
  deploymentSessions.delete(deploymentId);
}

// ── Message types ──────────────────────────────────────────────────────────
interface ClientMessage {
  type: "input" | "resize" | "ping";
  data?: string;
  cols?: number;
  rows?: number;
}

function sendJson(ws: WebSocket, msg: Record<string, unknown>) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Attach WebSocket server to HTTP server ─────────────────────────────────
export function attachTerminalWs(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request, socket, head) => {
    // Only handle /ws/terminal
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname !== "/ws/terminal") return;

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
      log.warn({ err }, "Terminal WS auth failed");
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

    if (deployment.status !== "running") {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    // Check connection limits
    const limitError = acquireSession(user.id, deploymentId);
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

  wss.on("connection", async (ws: WebSocket, _request: http.IncomingMessage, ctx: { user: { id: string }; deploymentId: string }) => {
    const { user, deploymentId } = ctx;
    log.info({ deploymentId, userId: user.id }, "Terminal WS connected");

    let cleanedUp = false;
    let sessionTimer: ReturnType<typeof setTimeout> | null = null;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let execWs: any = null;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;

      if (sessionTimer) clearTimeout(sessionTimer);
      if (pingTimer) clearInterval(pingTimer);
      try { execWs?.close?.(); } catch {}
      releaseSession(user.id, deploymentId);
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
      log.info({ deploymentId, userId: user.id }, "Terminal WS cleaned up");
    };

    // Session timeout
    sessionTimer = setTimeout(() => {
      sendJson(ws, { type: "error", message: "Session timed out (30 min limit)" });
      sendJson(ws, { type: "exit" });
      cleanup();
    }, SESSION_TIMEOUT_MS);

    // Keep-alive ping/pong
    pingTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, PING_INTERVAL_MS);

    ws.on("close", cleanup);
    ws.on("error", (err) => {
      log.warn({ err, deploymentId }, "Terminal WS error");
      cleanup();
    });

    // Find pod
    let podName: string | null;
    try {
      podName = await findPodForDeployment(deploymentId, { requireReady: false });
    } catch (err) {
      log.error({ err, deploymentId }, "Failed to find pod for terminal");
      sendJson(ws, { type: "error", message: "Failed to find pod" });
      sendJson(ws, { type: "exit" });
      cleanup();
      return;
    }

    if (!podName) {
      sendJson(ws, { type: "error", message: "No running pod found" });
      sendJson(ws, { type: "exit" });
      cleanup();
      return;
    }

    // Open K8s exec with TTY
    const stdout = new stream.PassThrough();
    const stderr = new stream.PassThrough();
    const stdinStream = new stream.PassThrough();

    // Pipe K8s output → WebSocket
    stdout.on("data", (chunk: Buffer) => {
      sendJson(ws, { type: "output", data: chunk.toString() });
    });

    stderr.on("data", (chunk: Buffer) => {
      sendJson(ws, { type: "output", data: chunk.toString() });
    });

    // Start a bash shell scoped to OpenClaw CLI usage:
    // - Custom prompt (openclaw>)
    // - Alias so `openclaw` works without `npx`
    // - Working directory set to /data
    // - Welcome message with available commands
    const shellInit = [
      "/bin/bash", "-c",
      [
        // Write a custom rcfile with alias + colored prompt + cd /data
        `cat > /tmp/.oclawrc << 'RCEOF'`,
        `alias openclaw='npx openclaw'`,
        `export PS1='\\[\\033[36m\\]openclaw\\[\\033[0m\\]> '`,
        `cd /data`,
        `RCEOF`,
        // Print welcome message using printf (echo doesn't interpret escapes)
        `printf '\\n  \\033[36mOpenClaw Terminal\\033[0m\\n'`,
        `printf '  Type \\033[1mopenclaw --help\\033[0m for available commands\\n\\n'`,
        // Start bash with our rcfile
        `exec bash --rcfile /tmp/.oclawrc`,
      ].join("\n"),
    ];

    try {
      execWs = await execClient.exec(
        NAMESPACE,
        podName,
        LEGACY_CONTAINER_NAME,
        shellInit,
        stdout,
        stderr,
        stdinStream,
        true, // tty
        (status) => {
          log.info({ deploymentId, podName, status: status.status }, "Terminal exec exited");
          sendJson(ws, { type: "exit" });
          cleanup();
        },
      );

      sendJson(ws, { type: "connected", podName });
      log.info({ deploymentId, podName }, "OpenClaw terminal session started");
    } catch (err) {
      log.error({ err, deploymentId, podName }, "Failed to exec into pod");
      sendJson(ws, { type: "error", message: "Failed to open shell in pod" });
      sendJson(ws, { type: "exit" });
      cleanup();
      return;
    }

    // Handle client messages
    ws.on("message", (raw) => {
      try {
        const msg: ClientMessage = JSON.parse(raw.toString());

        switch (msg.type) {
          case "input":
            if (msg.data) {
              stdinStream.write(msg.data);
            }
            break;
          case "resize":
            // K8s exec resize requires the exec WebSocket to support it
            // The @kubernetes/client-node Exec doesn't expose resize natively,
            // but the TTY will use default dimensions. This is a best-effort.
            break;
          case "ping":
            sendJson(ws, { type: "pong" });
            break;
        }
      } catch {
        // Ignore malformed messages
      }
    });
  });

  log.info("Terminal WebSocket server attached at /ws/terminal");
}
