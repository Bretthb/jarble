/**
 * Bot Ask - sandbox components ask the bot contextual questions.
 *
 * POST /api/deployments/:id/bridge/ask
 * Auth: Bearer JWT (user must own the deployment)
 *
 * This enables sandbox components to ask the bot questions like
 * "What company is the user asking about?" without polluting the
 * main conversation history. Each ask uses an isolated session key.
 *
 * Rate limits: 10 requests/min, 3 concurrent per deployment.
 */
import { Router, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { chatViaGateway } from "../services/openclawGateway.js";
import { findPodForDeployment } from "../k8s/index.js";
import { readCurrentSecretData } from "../k8s/index.js";
import { createModuleLogger } from "../utils/logger.js";

const logger = createModuleLogger("botAsk");

export const botAskRouter = Router();

// ── Rate limiting state ──────────────────────────────────────────────────
// In-memory per-deployment rate limiting. Resets on server restart.
const rateLimitWindows = new Map<string, number[]>(); // deploymentId -> timestamps
const concurrentCounts = new Map<string, number>(); // deploymentId -> active count
const MAX_ASKS_PER_MIN = 10;
const MAX_CONCURRENT = 3;

function checkRateLimit(deploymentId: string): { allowed: boolean; error?: string } {
  const now = Date.now();

  // Check concurrent
  const concurrent = concurrentCounts.get(deploymentId) ?? 0;
  if (concurrent >= MAX_CONCURRENT) {
    return { allowed: false, error: `Too many concurrent asks (${MAX_CONCURRENT} max)` };
  }

  // Check per-minute window
  let window = rateLimitWindows.get(deploymentId) ?? [];
  window = window.filter((t) => now - t < 60_000);
  if (window.length >= MAX_ASKS_PER_MIN) {
    return { allowed: false, error: `Ask rate limit exceeded (${MAX_ASKS_PER_MIN}/min)` };
  }

  window.push(now);
  rateLimitWindows.set(deploymentId, window);
  return { allowed: true };
}

// ── Route ────────────────────────────────────────────────────────────────

botAskRouter.post("/:id/bridge/ask", async (req: Request, res: Response) => {
  const { id: deploymentId } = req.params;
  const { question, cardId } = req.body;

  if (!question || typeof question !== "string") {
    res.status(400).json({ error: "Missing required field: question" });
    return;
  }

  if (question.length > 500) {
    res.status(400).json({ error: "Question too long (max 500 characters)" });
    return;
  }

  // Auth: verify JWT and ownership
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Bearer token required" });
    return;
  }

  try {
    const tokenPayload = await verifyToken(authHeader.slice(7));
    const user = await getUserFromToken(tokenPayload);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }

    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, deploymentId),
    });
    if (!deployment || (deployment as any).userId !== user.id) {
      res.status(403).json({ error: "Not authorized for this deployment" });
      return;
    }
  } catch {
    if (process.env.USE_SQLITE !== "true" || process.env.NODE_ENV === "production") {
      res.status(401).json({ error: "Invalid token" });
      return;
    }
    // Dev-only: allow through when USE_SQLITE=true and not in production
  }

  // Rate limit check
  const rateCheck = checkRateLimit(deploymentId);
  if (!rateCheck.allowed) {
    res.status(429).json({ error: rateCheck.error });
    return;
  }

  // Track concurrent
  concurrentCounts.set(deploymentId, (concurrentCounts.get(deploymentId) ?? 0) + 1);

  try {
    // Find the pod IP and gateway token
    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, deploymentId),
    });

    if (!deployment || deployment.status !== "running") {
      res.status(400).json({ error: "Deployment is not running" });
      return;
    }

    const managedBy = (deployment as any).managedBy ?? "legacy";

    // Get pod info
    let podIp: string | null = null;
    try {
      const podName = await findPodForDeployment(deploymentId, { managedBy });
      if (podName) {
        const { coreApi } = await import("../k8s/client.js");
        const { NAMESPACE } = await import("../k8s/constants.js");
        const pod = await coreApi.readNamespacedPod(podName, NAMESPACE);
        podIp = pod.body.status?.podIP ?? null;
      }
    } catch {
      // K8s not available (dev mode) - use mock
    }

    if (!podIp) {
      // In dev mode without K8s, return a helpful error
      res.status(503).json({ error: "Pod not reachable (K8s not available)" });
      return;
    }

    // Get gateway token
    const secretData = await readCurrentSecretData(deploymentId);
    const gatewayToken = secretData?.OPENCLAW_GATEWAY_TOKEN ?? "";

    // Isolated session key: ask questions don't pollute main conversation
    const sessionKey = `ask-${cardId || "unknown"}-${Date.now()}`;

    logger.info({ deploymentId, sessionKey, questionLength: question.length }, "Bot ask: sending question");

    const response = await chatViaGateway(
      { ip: podIp, port: 18789, gatewayToken, sessionKey },
      question,
      undefined, // no delta streaming
      AbortSignal.timeout(60_000),
    );

    // Return plain text only (strip UI blocks - asks shouldn't generate UI)
    res.json({ answer: response.text });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ deploymentId, err: message }, "Bot ask: failed");
    res.status(500).json({ error: `Ask failed: ${message}` });
  } finally {
    const current = concurrentCounts.get(deploymentId) ?? 1;
    concurrentCounts.set(deploymentId, Math.max(0, current - 1));
  }
});
