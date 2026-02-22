import { Router } from "express";
import { eq, and } from "drizzle-orm";
import stream from "stream";
import { nanoid } from "nanoid";
import { db, tables } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { encryptApiKey } from "../utils/encryption.js";
import { syncConfigsToPvc } from "../services/configSync.js";
import {
  streamDeploymentLogs,
  getDeploymentPodStatus,
  findPodForDeployment,
  streamExecInPod,
} from "../k8s/index.js";

/**
 * SSE streaming routes for deployments.
 * Mounted at /api/deployments in index.ts.
 */
export const sseRouter = Router();

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
  } catch {
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

    if ((deployment as any).status !== "running") {
      res.status(400).json({ error: "Deployment is not running" });
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
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
      logger.error({ deploymentId, err }, "Log stream error");
      res.write(`event: error\ndata: ${JSON.stringify({ message: "Stream error" })}\n\n`);
      res.end();
    });

    // Start streaming from K8s
    const tailLines = Math.min(parseInt(req.query.tailLines as string) || 100, 1000);
    let abortFn: (() => void) | null = null;

    try {
      const result = await streamDeploymentLogs(deploymentId, logStream, { tailLines });
      abortFn = result.abort;
      logger.info({ deploymentId, podName: result.podName }, "Log stream started");
    } catch (err) {
      logger.error({ deploymentId, err }, "Failed to start log stream");
      res.write(`event: error\ndata: ${JSON.stringify({ message: "Failed to connect to pod logs" })}\n\n`);
      res.end();
      return;
    }

    // Keep-alive ping every 30s to prevent proxy/load-balancer timeouts
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
      }
    }, 30_000);

    // Clean up when client disconnects
    req.on("close", () => {
      logger.debug({ deploymentId }, "Log stream client disconnected");
      clearInterval(keepAlive);
      logStream.destroy();
      if (abortFn) abortFn();
    });
  } catch (err) {
    logger.error({ err }, "SSE log stream error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ─── SSE: WhatsApp QR code pairing ──────────────────────────────────────────
sseRouter.get("/:id/whatsapp/qr", async (req, res) => {
  try {
    const user = await authenticateSSE(req);
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

    if ((deployment as any).status !== "running") {
      res.status(400).json({ error: "Deployment is not running" });
      return;
    }

    // Find running pod
    const podName = await findPodForDeployment(deploymentId);
    if (!podName) {
      res.status(400).json({ error: "No running pod found for deployment" });
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    res.write(": connected\n\n");

    let connected = false;
    let abortFn: (() => void) | null = null;

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
      try {
        const existing = await db.query.platformCredentials.findFirst({
          where: and(
            eq(platformCredentials.deploymentId, deploymentId),
            eq(platformCredentials.platformId, "whatsapp"),
          ),
        });
        if (!existing) {
          const encrypted = encryptApiKey(JSON.stringify({}));
          await (db as any).insert(platformCredentials).values({
            id: nanoid(12),
            deploymentId,
            platformId: "whatsapp",
            credentials: encrypted,
          });
          logger.info({ deploymentId }, "WhatsApp marked as connected via QR pairing");
        }
        void syncConfigsToPvc(deploymentId);
      } catch (err) {
        logger.error({ deploymentId, err }, "Failed to mark WhatsApp connected");
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
            void markConnected();
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
          void markConnected();
          res.write(`event: connected\ndata: {}\n\n`);
        } else if (!success && !connected) {
          res.write(`event: error\ndata: ${JSON.stringify({ message: message || "Pairing process exited" })}\n\n`);
        }
        res.end();
      }
    );
    abortFn = result.abort;

    logger.info({ deploymentId, podName }, "WhatsApp QR pairing stream started");

    // 90-second timeout for the entire pairing session
    const timeout = setTimeout(() => {
      if (!res.writableEnded && !connected) {
        res.write(`event: timeout\ndata: {}\n\n`);
        res.end();
        if (abortFn) abortFn();
      }
    }, 90_000);

    // Keep-alive ping every 30s
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
      }
    }, 30_000);

    // Clean up when client disconnects
    req.on("close", () => {
      logger.debug({ deploymentId }, "WhatsApp QR stream client disconnected");
      clearTimeout(timeout);
      clearInterval(keepAlive);
      if (abortFn) abortFn();
    });
  } catch (err) {
    logger.error({ err }, "WhatsApp QR stream error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});

// ─── SSE: Deployment status streaming ────────────────────────────────────────
sseRouter.get("/status/stream", async (req, res) => {
  try {
    const user = await authenticateSSE(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    // Set SSE headers
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    res.write(": connected\n\n");

    // Track last known statuses to only push deltas
    const lastKnown = new Map<string, string>();

    // Helper: build status snapshot for all user deployments
    async function buildStatusSnapshot() {
      const { deployments: deploymentsTable } = tables;
      const userDeployments = await db.query.deployments.findMany({
        where: eq(deploymentsTable.userId, user!.id),
      });

      const results: Array<{
        deploymentId: string;
        status: string;
        restarts?: number;
        error?: string;
      }> = [];

      for (const dep of userDeployments) {
        const d = dep as any;
        const dbStatus = d.status as string;

        const isTransitional = ["creating", "restarting", "stopping"].includes(dbStatus);
        if (!isTransitional && (dbStatus === "running" || dbStatus === "failed")) {
          try {
            const podStatus = await getDeploymentPodStatus(d.id);
            results.push({
              deploymentId: d.id,
              status: podStatus.status,
              restarts: podStatus.restarts,
              error: podStatus.error,
            });

            if (podStatus.status !== dbStatus
                && (podStatus.status === "running" || podStatus.status === "failed")) {
              try {
                await (db as any).update(deploymentsTable)
                  .set({
                    status: podStatus.status,
                    ...(podStatus.error ? { error: podStatus.error } : {}),
                  })
                  .where(and(
                    eq(deploymentsTable.id, d.id),
                    eq(deploymentsTable.status, dbStatus as any),
                  ));
              } catch (syncErr) {
                logger.warn({ deploymentId: d.id, syncErr }, "SSE status sync: failed to update DB");
              }
            }
          } catch {
            results.push({ deploymentId: d.id, status: dbStatus });
          }
        } else {
          results.push({ deploymentId: d.id, status: dbStatus });
        }
      }

      return results;
    }

    // Send initial snapshot
    try {
      const snapshot = await buildStatusSnapshot();
      for (const s of snapshot) {
        lastKnown.set(s.deploymentId, JSON.stringify(s));
      }
      res.write(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`);
    } catch (err) {
      logger.error({ err, userId: user.id }, "Failed to build initial status snapshot");
      res.write(`event: error\ndata: ${JSON.stringify({ message: "Failed to fetch deployment statuses" })}\n\n`);
      res.end();
      return;
    }

    // Poll for changes every 5 seconds
    const pollInterval = setInterval(async () => {
      if (res.writableEnded) {
        clearInterval(pollInterval);
        return;
      }

      try {
        const current = await buildStatusSnapshot();

        for (const s of current) {
          const serialized = JSON.stringify(s);
          if (lastKnown.get(s.deploymentId) !== serialized) {
            lastKnown.set(s.deploymentId, serialized);
            res.write(`data: ${serialized}\n\n`);
          }
        }

        // Detect removed deployments
        const currentIds = new Set(current.map((s) => s.deploymentId));
        for (const [id] of lastKnown) {
          if (!currentIds.has(id)) {
            lastKnown.delete(id);
            res.write(`data: ${JSON.stringify({ deploymentId: id, status: "not_found" })}\n\n`);
          }
        }
      } catch (err) {
        logger.error({ err, userId: user.id }, "Status stream poll error");
      }
    }, 5_000);

    // Keep-alive ping every 30s
    const keepAlive = setInterval(() => {
      if (!res.writableEnded) {
        res.write(": ping\n\n");
      }
    }, 30_000);

    // Maximum connection lifetime: 1 hour
    const maxConnectionMs = 60 * 60 * 1000;
    const connectionTimeout = setTimeout(() => {
      logger.debug({ userId: user!.id }, "Status stream max lifetime reached, closing");
      clearInterval(pollInterval);
      clearInterval(keepAlive);
      res.write(`event: reconnect\ndata: {"reason":"max_lifetime"}\n\n`);
      res.end();
    }, maxConnectionMs);

    // Clean up when client disconnects
    req.on("close", () => {
      logger.debug({ userId: user!.id }, "Status stream client disconnected");
      clearInterval(pollInterval);
      clearInterval(keepAlive);
      clearTimeout(connectionTimeout);
    });
  } catch (err) {
    logger.error({ err }, "SSE status stream error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
});
