import { Router } from "express";
import { eq, and } from "drizzle-orm";
import stream from "stream";
import { nanoid } from "nanoid";
import { db, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("sse");
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { encryptApiKey } from "../utils/encryption.js";
import { syncConfigsToPvc } from "../services/configSync.js";
import { safeFireAndForget } from "../utils/safeAsync.js";
import {
  streamDeploymentLogs,
  getDeploymentPodStatus,
  findPodForDeployment,
  streamExecInPod,
} from "../k8s/index.js";
import {
  subscribe as statusCacheSubscribe,
  unsubscribeAll as statusCacheUnsubscribeAll,
  type CachedStatus,
  type StatusChangeCallback,
} from "../services/statusCache.js";

/**
 * SSE streaming routes for deployments.
 * Mounted at /api/deployments in index.ts.
 */
export const sseRouter = Router();

// ─── Per-user SSE connection limiting ────────────────────────────────────────
const MAX_SSE_CONNECTIONS_PER_USER = 10;
const activeConnections = new Map<string, number>();

function acquireConnection(userId: string): boolean {
  const count = activeConnections.get(userId) ?? 0;
  if (count >= MAX_SSE_CONNECTIONS_PER_USER) return false;
  activeConnections.set(userId, count + 1);
  return true;
}

function releaseConnection(userId: string): void {
  const count = activeConnections.get(userId) ?? 0;
  if (count <= 1) {
    activeConnections.delete(userId);
  } else {
    activeConnections.set(userId, count - 1);
  }
}

/**
 * Authenticate via Bearer header OR ?token= query param.
 * EventSource can't set headers, so query param is needed.
 */
async function authenticateSSE(req: any) {
  const authHeader = req.headers.authorization;
  const headerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const queryToken = req.query.token as string | undefined;
  const token = headerToken || queryToken;

  if (!token) return null;

  try {
    const payload = await verifyToken(token);
    return await getUserFromToken(payload);
  } catch (err) {
    log.warn({ err, authMethod: headerToken ? "header" : "query" }, "authenticateSSE: JWT verification failed");
    return null;
  }
}

// ─── SSE: Deployment log streaming ──────────────────────────────────────────
sseRouter.get("/:id/logs/stream", async (req, res) => {
  try {
    const user = await authenticateSSE(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const deploymentId = req.params.id;

    // Verify ownership
    const { deployments: deploymentsTable } = tables;
    const deployment = await db.query.deployments.findFirst({
      where: and(
        eq(deploymentsTable.id, deploymentId),
        eq(deploymentsTable.userId, user.id)
      ),
    });

    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    if (deployment.status !== "running") {
      res.status(400).json({ error: "Deployment is not running" });
      return;
    }

    // Enforce per-user SSE connection limit
    if (!acquireConnection(user.id)) {
      res.status(429).json({ error: "Too many SSE connections" });
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    // Send initial comment to establish connection
    res.write(": connected\n\n");

    // Create PassThrough stream that converts K8s log chunks to SSE events
    const logStream = new stream.PassThrough();
    let buffer = "";

    logStream.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.trim()) {
          res.write(`data: ${JSON.stringify({ line })}\n\n`);
        }
      }
    });

    logStream.on("end", () => {
      if (buffer.trim()) {
        res.write(`data: ${JSON.stringify({ line: buffer })}\n\n`);
      }
      res.write(`event: end\ndata: {}\n\n`);
      res.end();
    });

    logStream.on("error", (err) => {
      log.error({ deploymentId, err }, "Log stream error");
      res.write(`event: error\ndata: ${JSON.stringify({ message: "Stream error" })}\n\n`);
      res.end();
    });

    // Start streaming from K8s
    const tailLines = Math.min(parseInt(req.query.tailLines as string) || 100, 1000);
    let abortFn: (() => void) | null = null;

    try {
      const result = await streamDeploymentLogs(deploymentId, logStream, { tailLines });
      abortFn = result.abort;
      log.info({ deploymentId, podName: result.podName }, "Log stream started");
    } catch (err) {
      log.error({ deploymentId, err }, "Failed to start log stream");
      res.write(`event: error\ndata: ${JSON.stringify({ message: "Failed to connect to pod logs" })}\n\n`);
      res.end();
      return;
    }

    // Keep-alive ping every 25s to prevent proxy/load-balancer timeouts
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
      }
    }, 25_000);

    let logsCleaned = false;
    const cleanupLogs = () => {
      if (logsCleaned) return;
      logsCleaned = true;
      clearInterval(keepAlive);
      logStream.destroy();
      if (abortFn) abortFn();
      releaseConnection(user!.id);
    };

    // Clean up when client disconnects
    req.on("close", () => {
      log.debug({ deploymentId }, "Log stream client disconnected");
      cleanupLogs();
    });

    req.on("error", (err: Error) => {
      log.warn({ err, deploymentId }, "Log stream request error");
      cleanupLogs();
    });

    res.on("error", (err: Error) => {
      log.warn({ err, deploymentId }, "Log stream response error");
      cleanupLogs();
    });
  } catch (err) {
    log.error({ err }, "SSE log stream error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ─── SSE: WhatsApp QR code pairing ──────────────────────────────────────────
sseRouter.get("/:id/whatsapp/qr", async (req, res) => {
  let user: Awaited<ReturnType<typeof authenticateSSE>> = null;
  try {
    user = await authenticateSSE(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const deploymentId = req.params.id;

    // Verify ownership
    const { deployments: deploymentsTable, platformCredentials } = tables;
    const deployment = await db.query.deployments.findFirst({
      where: and(
        eq(deploymentsTable.id, deploymentId),
        eq(deploymentsTable.userId, user.id)
      ),
    });

    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    if (deployment.status !== "running") {
      res.status(400).json({ error: "Deployment is not running" });
      return;
    }

    // Find running pod
    const podName = await findPodForDeployment(deploymentId);
    if (!podName) {
      res.status(400).json({ error: "No running pod found for deployment" });
      return;
    }

    // Enforce per-user SSE connection limit
    if (!acquireConnection(user.id)) {
      res.status(429).json({ error: "Too many SSE connections" });
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    res.write(": connected\n\n");

    let connected = false;
    let abortFn: (() => void) | null = null;
    let pairingTimeout: ReturnType<typeof setTimeout> | null = null;

    // Heuristic: detect QR output from OpenClaw
    const isQrLine = (line: string): boolean => {
      const trimmed = line.trim();
      if (trimmed.includes("\u2584") || trimmed.includes("\u2588") || trimmed.includes("\u2580")) {
        return true;
      }
      return false;
    };

    const isConnectedLine = (line: string): boolean => {
      const lower = line.toLowerCase();
      return lower.includes("successfully logged in") ||
             lower.includes("whatsapp connected") ||
             lower.includes("connection open") ||
             lower.includes("session saved") ||
             (lower.includes("logged in") && lower.includes("whatsapp"));
    };

    // Buffer QR lines so we send a complete QR code as one event
    let qrBuffer: string[] = [];
    let inQrBlock = false;

    const flushQrBuffer = () => {
      if (qrBuffer.length > 0 && !res.writableEnded) {
        const qrAscii = qrBuffer.join("\n");
        res.write(`event: qr\ndata: ${JSON.stringify({ qr: qrAscii })}\n\n`);
        qrBuffer = [];
      }
      inQrBlock = false;
    };

    // Mark WhatsApp connected in DB
    const markConnected = async () => {
      if (connected) return;
      connected = true;
      // Clear the 90s pairing timeout - QR was scanned successfully
      if (pairingTimeout) {
        clearTimeout(pairingTimeout);
        pairingTimeout = null;
      }
      try {
        const existing = await db.query.platformCredentials.findFirst({
          where: and(
            eq(platformCredentials.deploymentId, deploymentId),
            eq(platformCredentials.platformId, "whatsapp"),
          ),
        });
        if (!existing) {
          const encrypted = encryptApiKey(JSON.stringify({}));
          await db.insert(platformCredentials).values({
            id: nanoid(12),
            deploymentId,
            platformId: "whatsapp",
            credentials: encrypted,
          });
          log.info({ deploymentId }, "WhatsApp marked as connected via QR pairing");
        }
        safeFireAndForget(syncConfigsToPvc(deploymentId), { operation: "syncConfigsToPvc", deploymentId });
      } catch (err) {
        log.error({ deploymentId, err }, "Failed to mark WhatsApp connected");
      }
    };

    const result = await streamExecInPod(
      podName,
      ["npx", "openclaw", "channels", "login", "--channel", "whatsapp"],
      (line) => {
        if (res.writableEnded) return;

        if (isQrLine(line)) {
          qrBuffer.push(line.trim());
          inQrBlock = true;
        } else {
          // Non-QR line: flush any buffered QR block first
          if (inQrBlock) flushQrBuffer();

          if (isConnectedLine(line)) {
            safeFireAndForget(markConnected(), { operation: "markConnected", deploymentId });
            res.write(`event: connected\ndata: {}\n\n`);
          } else if (line.trim()) {
            // Forward as debug log line
            res.write(`event: log\ndata: ${JSON.stringify({ line: line.trim() })}\n\n`);
          }
        }
      },
      (success, message) => {
        // Flush any remaining QR buffer on exit
        if (inQrBlock) flushQrBuffer();

        if (res.writableEnded) return;
        if (success && !connected) {
          safeFireAndForget(markConnected(), { operation: "markConnected", deploymentId });
          res.write(`event: connected\ndata: {}\n\n`);
        } else if (!success && !connected) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: message || "Pairing process exited" })}\n\n`);
        }
        res.end();
      }
    );
    abortFn = result.abort;

    log.info({ deploymentId, podName }, "WhatsApp QR pairing stream started");

    // 90-second timeout for the entire pairing session
    pairingTimeout = setTimeout(() => {
      if (!res.writableEnded && !connected) {
        res.write(`event: timeout\ndata: {}\n\n`);
        res.end();
        if (abortFn) abortFn();
      }
    }, 90_000);

    // Keep-alive ping every 25s
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
      }
    }, 25_000);

    let qrCleaned = false;
    const cleanupQr = () => {
      if (qrCleaned) return;
      qrCleaned = true;
      if (pairingTimeout) clearTimeout(pairingTimeout);
      clearInterval(keepAlive);
      if (abortFn) abortFn();
      releaseConnection(user!.id);
    };

    // Clean up when client disconnects
    req.on("close", () => {
      log.debug({ deploymentId }, "WhatsApp QR stream client disconnected");
      cleanupQr();
    });

    req.on("error", (err: Error) => {
      log.warn({ err, deploymentId }, "QR stream request error");
      cleanupQr();
    });

    res.on("error", (err: Error) => {
      log.warn({ err, deploymentId }, "QR stream response error");
      cleanupQr();
    });
  } catch (err) {
    log.error({ err }, "WhatsApp QR stream error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    } else {
      // Headers already sent - SSE connection open but broken, must close it
      if (user) releaseConnection(user.id);
      res.end();
    }
  }
});

// ─── SSE: Deployment status streaming ────────────────────────────────────────
//
// Uses a shared statusCache so that multiple SSE connections watching the same
// deployment result in only ONE K8s API call per poll interval, not N.
//
sseRouter.get("/status/stream", async (req, res) => {
  try {
    const user = await authenticateSSE(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Enforce per-user SSE connection limit
    if (!acquireConnection(user.id)) {
      res.status(429).json({ error: "Too many SSE connections" });
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-store, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    res.write(": connected\n\n");

    // Track last known statuses to only push deltas to THIS client
    const lastKnown = new Map<string, string>();

    // IDs we've subscribed to (for cleanup)
    const subscribedIds: string[] = [];

    // Callback invoked by the shared cache when a deployment's status changes
    const onStatusChange: StatusChangeCallback = (status: CachedStatus) => {
      if (res.writableEnded) return;

      const serialized = JSON.stringify(status);
      if (lastKnown.get(status.deploymentId) !== serialized) {
        lastKnown.set(status.deploymentId, serialized);
        res.write(`data: ${serialized}\n\n`);
      }
    };

    // Load user's deployments and subscribe each to the shared cache
    const { deployments: deploymentsTable } = tables;

    try {
      const userDeployments = await db.query.deployments.findMany({
        where: eq(deploymentsTable.userId, user.id),
      });

      // Subscribe to all deployments in parallel.
      // For deployments in transitional states (creating/restarting/stopping),
      // we still subscribe - the cache will query K8s and report the actual pod state.
      // For non-transitional states, the cache deduplicates across connections.
      const initialStatuses = await Promise.all(
        userDeployments.map(async (dep) => {
          const dbStatus = dep.status;
          const isTransitional = ["creating", "restarting", "stopping"].includes(dbStatus);

          if (!isTransitional && dbStatus !== "running" && dbStatus !== "failed") {
            // Stopped or other non-pollable state - use DB status directly
            return { deploymentId: dep.id, status: dbStatus };
          }

          // Subscribe to the shared cache for K8s-backed statuses
          subscribedIds.push(dep.id);
          const cached = await statusCacheSubscribe(dep.id, onStatusChange);

          // Sync K8s status back to DB if it diverged
          if (cached.status !== dbStatus
              && (cached.status === "running" || cached.status === "failed")) {
            try {
              await db.update(deploymentsTable)
                .set({
                  status: cached.status,
                  ...(cached.error ? { error: cached.error } : {}),
                })
                .where(and(
                  eq(deploymentsTable.id, dep.id),
                  eq(deploymentsTable.status, dbStatus),
                ));
            } catch (syncErr) {
              log.warn({ deploymentId: dep.id, syncErr }, "SSE status sync: failed to update DB");
            }
          }

          return cached;
        })
      );

      // Send initial snapshot
      for (const s of initialStatuses) {
        lastKnown.set(s.deploymentId, JSON.stringify(s));
      }
      res.write(`event: snapshot\ndata: ${JSON.stringify(initialStatuses)}\n\n`);
    } catch (err) {
      log.error({ err, userId: user.id }, "Failed to build initial status snapshot");
      res.write(`event: error\ndata: ${JSON.stringify({ message: "Failed to fetch deployment statuses" })}\n\n`);
      releaseConnection(user.id);
      res.end();
      return;
    }

    // Periodic check for new/removed deployments (DB-level, not K8s).
    // This handles deployments created or deleted while the stream is open.
    const deploymentSyncInterval = setInterval(async () => {
      if (res.writableEnded) {
        clearInterval(deploymentSyncInterval);
        return;
      }

      try {
        const currentDeployments = await db.query.deployments.findMany({
          where: eq(deploymentsTable.userId, user!.id),
          columns: { id: true, status: true },
        });

        const currentIds = new Set(currentDeployments.map((d) => d.id));
        const subscribedSet = new Set(subscribedIds);

        // Subscribe to newly created deployments
        for (const dep of currentDeployments) {
          if (!subscribedSet.has(dep.id)) {
            const isTransitional = ["creating", "restarting", "stopping"].includes(dep.status);
            if (isTransitional || dep.status === "running" || dep.status === "failed") {
              subscribedIds.push(dep.id);
              const cached = await statusCacheSubscribe(dep.id, onStatusChange);
              const serialized = JSON.stringify(cached);
              if (lastKnown.get(dep.id) !== serialized) {
                lastKnown.set(dep.id, serialized);
                res.write(`data: ${serialized}\n\n`);
              }
            }
          }
        }

        // Detect removed deployments
        for (const [id] of lastKnown) {
          if (!currentIds.has(id)) {
            lastKnown.delete(id);
            res.write(`data: ${JSON.stringify({ deploymentId: id, status: "not_found" })}\n\n`);
            // Unsubscribe from cache
            const idx = subscribedIds.indexOf(id);
            if (idx !== -1) {
              subscribedIds.splice(idx, 1);
              statusCacheUnsubscribeAll([id], onStatusChange);
            }
          }
        }
      } catch (err) {
        log.error({ err, userId: user!.id }, "Status stream deployment sync error");
      }
    }, 15_000); // Check for new/removed deployments every 15s (less frequent than status polling)

    // Keep-alive ping every 25s
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
      }
    }, 25_000);

    // Maximum connection lifetime: 1 hour
    const maxConnectionMs = 60 * 60 * 1000;
    const connectionTimeout = setTimeout(() => {
      log.debug({ userId: user!.id }, "Status stream max lifetime reached, closing");
      cleanup();
      res.write(`event: reconnect\ndata: {"reason":"max_lifetime"}\n\n`);
      res.end();
    }, maxConnectionMs);

    let statusCleaned = false;
    function cleanup() {
      if (statusCleaned) return;
      statusCleaned = true;
      clearInterval(deploymentSyncInterval);
      clearInterval(keepAlive);
      clearTimeout(connectionTimeout);
      // Unsubscribe from all deployments in the shared cache
      statusCacheUnsubscribeAll(subscribedIds, onStatusChange);
      releaseConnection(user!.id);
    }

    // Clean up when client disconnects
    req.on("close", () => {
      log.debug({ userId: user!.id }, "Status stream client disconnected");
      cleanup();
    });

    req.on("error", (err: Error) => {
      log.warn({ err, userId: user!.id }, "Status stream request error");
      cleanup();
    });

    res.on("error", (err: Error) => {
      log.warn({ err, userId: user!.id }, "Status stream response error");
      cleanup();
    });
  } catch (err) {
    log.error({ err }, "SSE status stream error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});
