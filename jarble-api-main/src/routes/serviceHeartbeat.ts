/**
 * Service Heartbeat Route — Push-based health monitoring.
 *
 * Creator services can POST heartbeats to signal they are alive,
 * reducing detection delay from 5 minutes (pull-based) to seconds.
 *
 * Route: POST /api/services/heartbeat/:serviceId
 *
 * Requires HMAC signature verification using the heartbeatSecret
 * configured in the ServiceCard.
 */

import crypto from "crypto";
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, tables, dbDate } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { serviceCardSchema } from "../services/serviceCard.js";
import { generateMarketplaceId } from "../db/schema.js";

const log = createModuleLogger("service-heartbeat");

export const serviceHeartbeatRouter = Router();

serviceHeartbeatRouter.post("/heartbeat/:serviceId", async (req, res) => {
  const { serviceId } = req.params;

  try {
    // 1. Look up the service
    const svc = await db.query.marketplaceServices.findFirst({
      where: eq(tables.marketplaceServices.id, serviceId),
    });

    if (!svc) {
      res.status(404).json({ error: "Service not found" });
      return;
    }

    if (!svc.remoteApiConfig) {
      res.status(400).json({ error: "Service has no remote API configuration" });
      return;
    }

    // 2. Parse ServiceCard and get heartbeat config
    let serviceCard;
    try {
      const raw = JSON.parse(svc.remoteApiConfig);
      const result = serviceCardSchema.safeParse(raw);
      if (!result.success) {
        res.status(400).json({ error: "Invalid service card" });
        return;
      }
      serviceCard = result.data;
    } catch {
      res.status(400).json({ error: "Malformed service card" });
      return;
    }

    if (!serviceCard.heartbeatSecret) {
      res.status(400).json({ error: "Service does not have heartbeat configured" });
      return;
    }

    // 3. Verify HMAC signature
    const signature = req.headers["x-heartbeat-signature"] as string | undefined;
    const timestamp = req.headers["x-heartbeat-timestamp"] as string | undefined;

    if (!signature || !timestamp) {
      res.status(401).json({ error: "Missing heartbeat signature or timestamp" });
      return;
    }

    // Verify timestamp is within 5 minutes to prevent replay attacks
    const ts = parseInt(timestamp, 10);
    if (isNaN(ts) || Math.abs(Date.now() - ts) > 5 * 60 * 1000) {
      res.status(401).json({ error: "Heartbeat timestamp too old or invalid" });
      return;
    }

    const body = JSON.stringify(req.body ?? {});
    const expectedSig = crypto
      .createHmac("sha256", serviceCard.heartbeatSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex");

    const expectedBuf = Buffer.from(`sha256=${expectedSig}`);
    const sigBuf = Buffer.from(signature);
    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      res.status(401).json({ error: "Invalid heartbeat signature" });
      return;
    }

    // 4. Upsert heartbeat record
    const now = dbDate();
    const intervalMs = serviceCard.heartbeatIntervalMs ?? 60_000;
    const payload = body !== "{}" ? body : null;

    const existing = await db
      .select({ id: tables.serviceHeartbeats.id })
      .from(tables.serviceHeartbeats)
      .where(eq(tables.serviceHeartbeats.serviceId, serviceId))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(tables.serviceHeartbeats)
        .set({
          lastHeartbeatAt: now,
          heartbeatIntervalMs: intervalMs,
          payload,
          updatedAt: now,
        } as any)
        .where(eq(tables.serviceHeartbeats.serviceId, serviceId));
    } else {
      await db.insert(tables.serviceHeartbeats).values({
        id: generateMarketplaceId("shb"),
        serviceId,
        lastHeartbeatAt: now,
        heartbeatIntervalMs: intervalMs,
        payload,
        updatedAt: now,
      } as any);
    }

    // 5. Update service health status
    await db
      .update(tables.marketplaceServices)
      .set({
        remoteHealth: "healthy",
        remoteLastCheck: now,
      } as any)
      .where(eq(tables.marketplaceServices.id, serviceId));

    log.info({ serviceId }, "Heartbeat received");
    res.json({ received: true });
  } catch (err) {
    log.error({ serviceId, err }, "Heartbeat processing failed");
    res.status(500).json({ error: "Internal server error" });
  }
});
