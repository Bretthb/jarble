/**
 * Service Stream — SSE endpoint for real-time service data updates.
 *
 * Consumers subscribe to a service's mutations via Server-Sent Events.
 * When any consumer (or the host) executes a mutating skill, all
 * subscribers receive the event in real-time.
 *
 * Route: GET /api/services/stream/:serviceId
 *
 * Auth: Same dual-auth as serviceExecution (Bearer JWT or X-Gateway-Token).
 * The subscriber must have the service installed (serviceCredentials exist).
 *
 * Query params:
 *   - token: Bearer JWT (alternative to Authorization header, for EventSource)
 *   - deploymentId: required
 *
 * Events:
 *   - "connected" — initial connection confirmation with current state
 *   - "mutation"  — a skill was executed, includes skill name + result
 *   - "ping"      — keepalive every 30s
 */

import { Router, type Request, type Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { subscribe, getStoreSnapshot } from "../services/devHandlerRuntime.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";

const log = createModuleLogger("service-stream");

export const serviceStreamRouter = Router();

const KEEPALIVE_INTERVAL_MS = 30_000;
const MAX_CONNECTIONS_PER_SERVICE = 50;

// Track active connections per service for limit enforcement
const activeConnections = new Map<string, number>();

function sendEvent(res: Response, event: string, data: unknown): boolean {
  if (res.writableEnded) return false;
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

serviceStreamRouter.get(
  "/stream/:serviceId",
  async (req: Request, res: Response) => {
    const { serviceId } = req.params;
    const deploymentId =
      (req.query.deploymentId as string) ||
      (req.headers["x-deployment-id"] as string);

    if (!deploymentId) {
      res.status(400).json({ error: "Missing deploymentId" });
      return;
    }

    // ── Auth ──────────────────────────────────────────────────────────────
    // Support token in query param (EventSource can't set headers)
    const bearerToken =
      (req.query.token as string) ||
      (req.headers.authorization?.startsWith("Bearer ")
        ? req.headers.authorization.slice(7)
        : null);
    const gatewayToken = req.headers["x-gateway-token"] as string | undefined;

    if (bearerToken) {
      try {
        const payload = await verifyToken(bearerToken);
        const user = await getUserFromToken(payload);
        if (!user) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        const deployment = await db.query.deployments.findFirst({
          where: eq(tables.deployments.id, deploymentId),
        });
        if (!deployment || deployment.userId !== user.id) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
      } catch {
        res.status(401).json({ error: "Invalid token" });
        return;
      }
    } else if (gatewayToken) {
      const deployment = await db.query.deployments.findFirst({
        where: eq(tables.deployments.id, deploymentId),
      });
      if (!deployment) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      // In dev mode, deployment existence is sufficient
    } else {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // ── Verify service is installed ───────────────────────────────────────
    const creds = await db.query.serviceCredentials.findFirst({
      where: and(
        eq(tables.serviceCredentials.deploymentId, deploymentId),
        eq(tables.serviceCredentials.packageId, serviceId),
      ),
    });

    if (!creds) {
      res.status(404).json({
        error: "Service not installed on this deployment",
      });
      return;
    }

    // ── Connection limit ─────────────────────────────────────────────────
    const currentCount = activeConnections.get(serviceId) ?? 0;
    if (currentCount >= MAX_CONNECTIONS_PER_SERVICE) {
      res.status(429).json({ error: "Too many stream connections" });
      return;
    }
    activeConnections.set(serviceId, currentCount + 1);

    // ── Start SSE ────────────────────────────────────────────────────────
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    log.info(
      { serviceId, deploymentId, connections: currentCount + 1 },
      "Service stream: client connected",
    );

    // Send initial state
    const snapshot = getStoreSnapshot(serviceId);
    sendEvent(res, "connected", {
      serviceId,
      deploymentId,
      state: snapshot,
      timestamp: new Date().toISOString(),
    });

    // Subscribe to mutations
    const unsubscribe = subscribe(serviceId, (event) => {
      const sent = sendEvent(res, "mutation", {
        skillName: event.skillName,
        data: event.data,
        timestamp: event.timestamp,
      });
      if (!sent) {
        cleanup();
      }
    });

    // Keepalive ping
    const pingInterval = setInterval(() => {
      if (!sendEvent(res, "ping", { timestamp: new Date().toISOString() })) {
        cleanup();
      }
    }, KEEPALIVE_INTERVAL_MS);

    // Cleanup on disconnect
    let cleaned = false;
    function cleanup() {
      if (cleaned) return;
      cleaned = true;
      unsubscribe();
      clearInterval(pingInterval);
      const count = activeConnections.get(serviceId) ?? 1;
      activeConnections.set(serviceId, Math.max(0, count - 1));
      log.info({ serviceId, deploymentId }, "Service stream: client disconnected");
      if (!res.writableEnded) {
        res.end();
      }
    }

    req.on("close", cleanup);
    req.on("error", cleanup);
  },
);
