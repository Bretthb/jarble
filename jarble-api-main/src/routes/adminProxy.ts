/**
 * Admin Proxy — Exposes OpenClaw's built-in Control UI and chat.inject
 * to deployment owners through the Jarble API.
 *
 * Endpoints:
 *   POST /api/deployments/:id/inject     — Admin whisper (chat.inject)
 *   GET  /api/deployments/:id/admin/*    — Control UI HTTP proxy
 *
 * WS:
 *   /ws/admin?token=<JWT>&deploymentId=<ID>  — Control UI WS proxy
 *
 * Auth: Bearer JWT (REST) or query param token (WS). Owner-only.
 */
import http from "http";
import { Router, Request, Response } from "express";
import { WebSocketServer, WebSocket } from "ws";
import { URL } from "url";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { getPodAddress } from "../k8s/index.js";
import { injectViaGateway } from "../services/openclawGateway.js";
import { createModuleLogger } from "../utils/logger.js";
import type { ManagedBy } from "../k8s/constants.js";

const log = createModuleLogger("adminProxy");
const { deployments } = tables;

// ── Helpers ─────────────────────────────────────────────────────────────────

async function authenticateAndGetDeployment(req: Request) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  const payload = await verifyToken(token);
  const user = await getUserFromToken(payload);
  if (!user) return null;

  const deploymentId = req.params.id;
  const deployment = await db.query.deployments.findFirst({
    where: and(eq(deployments.id, deploymentId), eq(deployments.userId, user.id)),
  });

  if (!deployment) return null;
  return { user, deployment };
}

// ── REST Router ─────────────────────────────────────────────────────────────

export const adminProxyRouter = Router();

/**
 * POST /api/deployments/:id/inject
 *
 * Inject an assistant/system message into a running conversation.
 * Body: { message: string, sessionKey?: string, role?: "assistant" | "system" }
 */
adminProxyRouter.post("/:id/inject", async (req: Request, res: Response) => {
  try {
    const auth = await authenticateAndGetDeployment(req);
    if (!auth) {
      res.status(401).json({ error: "Unauthorized or deployment not found" });
      return;
    }

    const { message, sessionKey, role } = req.body;
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Missing required field: message" });
      return;
    }

    const validRole = role === "system" ? "system" : "assistant";
    const managedBy = (auth.deployment.managedBy ?? "legacy") as ManagedBy;
    const podAddr = await getPodAddress(auth.deployment.id, managedBy);

    if (!podAddr) {
      res.status(503).json({ error: "Deployment pod is not running" });
      return;
    }

    await injectViaGateway(
      { ip: podAddr.ip, port: podAddr.port, gatewayToken: podAddr.gatewayToken, sessionKey },
      message,
      validRole,
    );

    log.info({ deploymentId: auth.deployment.id, role: validRole, hasSession: !!sessionKey }, "Admin inject sent");
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "Admin inject failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Inject failed" });
  }
});

/**
 * GET /api/deployments/:id/admin/*
 *
 * Reverse-proxy HTTP requests to the pod's OpenClaw Control UI (port 18789).
 * The Control UI is a Vite SPA — the initial HTML, JS, and CSS are served here.
 */
adminProxyRouter.get("/:id/admin", handleAdminProxy);
adminProxyRouter.get("/:id/admin/*", handleAdminProxy);

async function handleAdminProxy(req: Request, res: Response) {
  try {
    const auth = await authenticateAndGetDeployment(req);
    if (!auth) {
      res.status(401).json({ error: "Unauthorized or deployment not found" });
      return;
    }

    const managedBy = (auth.deployment.managedBy ?? "legacy") as ManagedBy;
    const podAddr = await getPodAddress(auth.deployment.id, managedBy);
    if (!podAddr) {
      res.status(503).json({ error: "Deployment pod is not running" });
      return;
    }

    // Strip the /api/deployments/:id/admin prefix to get the path on the pod
    const prefix = `/api/deployments/${auth.deployment.id}/admin`;
    let targetPath = req.originalUrl.slice(req.originalUrl.indexOf(prefix) + prefix.length) || "/";

    const targetUrl = `http://${podAddr.ip}:${podAddr.port}${targetPath}`;
    log.debug({ deploymentId: auth.deployment.id, targetUrl }, "Admin proxy HTTP");

    const proxyRes = await fetch(targetUrl, {
      headers: {
        "Authorization": `Bearer ${podAddr.gatewayToken}`,
        "Accept": req.headers.accept || "*/*",
      },
      signal: AbortSignal.timeout(15_000),
    });

    // Forward status and key headers
    res.status(proxyRes.status);
    const contentType = proxyRes.headers.get("content-type");
    if (contentType) res.setHeader("Content-Type", contentType);
    const cacheControl = proxyRes.headers.get("cache-control");
    if (cacheControl) res.setHeader("Cache-Control", cacheControl);

    // Pipe the body
    const body = await proxyRes.arrayBuffer();
    res.send(Buffer.from(body));
  } catch (err) {
    log.error({ err }, "Admin proxy HTTP failed");
    res.status(502).json({ error: "Failed to reach pod Control UI" });
  }
}

// ── WebSocket Proxy ─────────────────────────────────────────────────────────

/**
 * Attach the /ws/admin WebSocket proxy to the HTTP server.
 *
 * The frontend's embedded Control UI connects its WS here instead of directly
 * to the pod. We authenticate the user, resolve the pod, and create a
 * bidirectional WS pipe.
 */
export function attachAdminWsProxy(server: http.Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (request, socket, head) => {
    const url = new URL(request.url || "", `http://${request.headers.host}`);
    if (url.pathname !== "/ws/admin") return;

    const token = url.searchParams.get("token");
    const deploymentId = url.searchParams.get("deploymentId");

    if (!token || !deploymentId) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    // Authenticate
    let userId: string;
    try {
      const payload = await verifyToken(token);
      const user = await getUserFromToken(payload);
      if (!user) throw new Error("User not found");
      userId = user.id;
    } catch {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    // Verify ownership
    const deployment = await db.query.deployments.findFirst({
      where: and(eq(deployments.id, deploymentId), eq(deployments.userId, userId)),
    });
    if (!deployment) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    // Resolve pod
    const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
    const podAddr = await getPodAddress(deploymentId, managedBy);
    if (!podAddr) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }

    // Upgrade the client connection
    wss.handleUpgrade(request, socket, head, (clientWs) => {
      // Connect to the pod's OpenClaw gateway WS
      const podWsUrl = `ws://${podAddr.ip}:${podAddr.port}`;
      const podWs = new WebSocket(podWsUrl, {
        origin: `http://${podAddr.ip}:${podAddr.port}`,
        handshakeTimeout: 10_000,
      });

      let podReady = false;
      const buffered: Buffer[] = [];

      // Pipe client → pod
      clientWs.on("message", (data) => {
        if (podReady && podWs.readyState === WebSocket.OPEN) {
          podWs.send(data);
        } else {
          buffered.push(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer));
        }
      });

      // Pod connected — flush buffer and start piping pod → client
      podWs.on("open", () => {
        podReady = true;
        for (const msg of buffered) podWs.send(msg);
        buffered.length = 0;
      });

      podWs.on("message", (data) => {
        if (clientWs.readyState === WebSocket.OPEN) {
          clientWs.send(data);
        }
      });

      // Teardown: close the other side when either side disconnects
      clientWs.on("close", () => { podWs.close(); });
      clientWs.on("error", () => { podWs.close(); });
      podWs.on("close", () => { clientWs.close(); });
      podWs.on("error", () => { clientWs.close(); });

      log.info({ deploymentId, userId }, "Admin WS proxy established");
    });
  });
}
