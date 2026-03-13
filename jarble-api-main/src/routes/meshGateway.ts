/**
 * Mesh Gateway — External agent access to installed services.
 *
 * POST /api/mesh/services/:serviceId/:skillName
 * Auth: API Key (Bearer jrbl_...)
 *
 * Allows external agents (any language, any platform) to discover and
 * use services published on the Jarble marketplace. Routes through the
 * same service proxy infrastructure (rate limiting, circuit breaking,
 * HMAC signing) used by internal bot-to-service calls.
 *
 * The caller must have installed the service on at least one of their
 * deployments (the first match is used for credentials).
 */
import { Router, Request, Response } from "express";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { authenticateApiKey, requireScope, type ApiKeyContext } from "../middleware/apiKeyAuth.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("meshGateway");

export const meshGatewayRouter = Router();

meshGatewayRouter.post(
  "/services/:serviceId/:skillName",
  authenticateApiKey,
  requireScope("mesh:write"),
  async (req: Request, res: Response) => {
    const { serviceId, skillName } = req.params;
    const ctx = (req as any).apiKeyContext as ApiKeyContext;

    // Find a deployment owned by this user that has the service installed
    const userDeployments = await db.query.deployments.findMany({
      where: eq(tables.deployments.userId, ctx.userId),
    });

    if (userDeployments.length === 0) {
      res.status(404).json({ error: "No deployments found for this API key's user" });
      return;
    }

    // Find the first deployment with this service installed
    let deploymentId: string | null = null;
    for (const dep of userDeployments) {
      const install = await db.query.serviceInstalls.findFirst({
        where: and(
          eq(tables.serviceInstalls.deploymentId, dep.id),
          eq(tables.serviceInstalls.packageId, serviceId),
        ),
      });
      if (install) {
        deploymentId = dep.id;
        break;
      }
    }

    if (!deploymentId) {
      res.status(404).json({ error: "Service not installed on any of your deployments" });
      return;
    }

    // Proxy to the internal service proxy endpoint
    const apiBase = process.env.JARBLE_API_URL ?? process.env.API_BASE_URL ?? "http://localhost:3001";
    const proxyUrl = `${apiBase}/api/services/proxy/${deploymentId}/${serviceId}/${skillName}`;

    log.info({ serviceId, skillName, deploymentId, userId: ctx.userId }, "Mesh gateway: proxying service call");

    try {
      const proxyRes = await fetch(proxyUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // Use the deployment's gateway token for internal auth
          // Since we've validated the API key, we can use internal credentials
          "X-Gateway-Token": "mesh-gateway-internal",
          "X-Request-Id": req.headers["x-request-id"] as string || crypto.randomUUID(),
        },
        body: JSON.stringify(req.body ?? {}),
        signal: AbortSignal.timeout(30_000),
      });

      const text = await proxyRes.text();
      const contentType = proxyRes.headers.get("content-type") || "application/json";

      // Forward response headers
      const requestId = proxyRes.headers.get("x-request-id");
      if (requestId) res.set("X-Request-Id", requestId);

      res.status(proxyRes.status).set("Content-Type", contentType).send(text);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error({ serviceId, skillName, deploymentId, err: message }, "Mesh gateway: proxy failed");
      res.status(502).json({ error: `Service call failed: ${message}` });
    }
  },
);

// Need crypto for randomUUID
import crypto from "crypto";
