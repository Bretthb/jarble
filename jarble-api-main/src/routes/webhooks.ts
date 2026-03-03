import { Router } from "express";
import { timingSafeEqual } from "crypto";
import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("webhooks");
import { env } from "../utils/env.js";
import { syncConfigsFromPvc } from "../services/configSync.js";

// Constant-time string comparison to prevent timing attacks on secrets
function secureCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const webhooksRouter = Router();

// ─── Auth0 webhook: email verification ───────────────────────────────────────
// Called by Auth0 Post Email Verification Action when a user verifies their email.
// Authenticated via M2M shared secret in Authorization header.
webhooksRouter.post("/auth0/email-verified", async (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  const m2mSecret = env.AUTH0_M2M_SECRET;

  if (!m2mSecret) {
    log.warn("Auth0 email-verified webhook called but AUTH0_M2M_SECRET is not configured");
    res.status(503).json({ error: "Webhook not configured" });
    return;
  }

  if (!token || !secureCompare(token, m2mSecret)) {
    log.warn("Auth0 email-verified webhook: invalid or missing token");
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { auth0Id, email } = req.body;

  if (!auth0Id) {
    res.status(400).json({ error: "Missing auth0Id" });
    return;
  }

  try {
    const user = await db.query.users.findFirst({
      where: eq(tables.users.auth0Id, auth0Id),
    });

    if (!user) {
      log.info({ auth0Id, email }, "Email verified webhook: user not found in DB (not yet provisioned - will sync via JWT claim)");
      res.json({ received: true, updated: false, reason: "user_not_found" });
      return;
    }

    if (user.emailVerified) {
      log.info({ userId: user.id }, "Email verified webhook: already verified");
      res.json({ received: true, updated: false, reason: "already_verified" });
      return;
    }

    await db.update(tables.users)
      .set({ emailVerified: true })
      .where(eq(tables.users.id, user.id));

    log.info({ userId: user.id, email: user.email }, "Email verified via Auth0 webhook");
    res.json({ received: true, updated: true });
  } catch (err) {
    log.error({ err, auth0Id }, "Email verification webhook error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Config change webhook (PVC → DB sync) ──────────────────────────────────
// Called by the file watcher running inside runtime containers when config files
// on the PVC change (e.g., user edited soul.md directly via OpenClaw).
// Auth: Shared secret in Authorization header (CONFIG_WEBHOOK_SECRET).
webhooksRouter.post("/config-changed", async (req, res) => {
  try {
    // Validate shared secret - REQUIRED in production
    // In development without the secret, skip auth (convenience)
    const isDev = process.env.NODE_ENV === "development";
    if (!env.CONFIG_WEBHOOK_SECRET && !isDev) {
      log.warn("Config webhook called but CONFIG_WEBHOOK_SECRET is not configured");
      res.status(503).json({ error: "Webhook not configured" });
      return;
    }

    if (env.CONFIG_WEBHOOK_SECRET) {
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
      if (!token || !secureCompare(token, env.CONFIG_WEBHOOK_SECRET)) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
    }

    const { deploymentId } = req.body;

    if (!deploymentId || typeof deploymentId !== "string") {
      res.status(400).json({ error: "deploymentId is required" });
      return;
    }

    // Verify deployment exists
    const { deployments: deploymentsTable } = tables;
    const deployment = await db.query.deployments.findFirst({
      where: eq(deploymentsTable.id, deploymentId),
    });

    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    // Fire-and-forget: read PVC config files and sync to DB
    void syncConfigsFromPvc(deploymentId);

    log.info({ deploymentId }, "Config change webhook received, syncing from PVC");
    res.json({ ok: true });
  } catch (err) {
    log.error({ err }, "Config change webhook error");
    res.status(500).json({ error: "Internal server error" });
  }
});
