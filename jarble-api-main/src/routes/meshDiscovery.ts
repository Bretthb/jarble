/**
 * Mesh Discovery - Service catalog and A2A agent card for external agents.
 *
 * GET /api/mesh/services              - Browse available services (API key auth)
 * GET /api/mesh/services/:id          - Get service details + skills (API key auth)
 * GET /.well-known/jarble-mesh.json   - A2A agent card (public)
 *
 * Allows external agents to discover what services are available,
 * their skill definitions, and how to call them.
 */
import { Router, Request, Response } from "express";
import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { authenticateApiKey, requireScope, type ApiKeyContext } from "../middleware/apiKeyAuth.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("meshDiscovery");

export const meshDiscoveryRouter = Router();

// ── Service catalog ──────────────────────────────────────────────────────

meshDiscoveryRouter.get(
  "/services",
  authenticateApiKey,
  requireScope("mesh:read"),
  async (req: Request, res: Response) => {
    const ctx = (req as any).apiKeyContext as ApiKeyContext;

    try {
      // Return all published services (visibility: public)
      const services = await db.query.marketplaceServices.findMany({
        where: eq(tables.marketplaceServices.status, "published"),
      });

      const catalog = services.map((svc) => {
        let skills: Array<{ name: string; description?: string }> = [];
        if (svc.remoteApiConfig) {
          try {
            const card = JSON.parse(svc.remoteApiConfig);
            if (Array.isArray(card.skills)) {
              skills = card.skills.map((s: any) => ({
                name: s.name,
                description: s.description,
                inputSchema: s.inputSchema,
                outputSchema: s.outputSchema,
              }));
            }
          } catch { /* ignore malformed */ }
        }

        return {
          id: svc.id,
          name: svc.displayName,
          description: svc.description,
          hostingModel: svc.hostingModel,
          skills,
        };
      });

      log.info({ userId: ctx.userId, count: catalog.length }, "Mesh discovery: catalog requested");
      res.json({ services: catalog, total: catalog.length });
    } catch (err) {
      log.error({ err }, "Mesh discovery: catalog failed");
      res.status(500).json({ error: "Failed to fetch service catalog" });
    }
  },
);

// ── Service details ──────────────────────────────────────────────────────

meshDiscoveryRouter.get(
  "/services/:id",
  authenticateApiKey,
  requireScope("mesh:read"),
  async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
      const svc = await db.query.marketplaceServices.findFirst({
        where: eq(tables.marketplaceServices.id, id),
      });

      if (!svc || svc.status !== "published") {
        res.status(404).json({ error: "Service not found" });
        return;
      }

      let skills: unknown[] = [];
      let rateLimits: unknown = null;
      if (svc.remoteApiConfig) {
        try {
          const card = JSON.parse(svc.remoteApiConfig);
          skills = card.skills || [];
          rateLimits = card.rateLimits || null;
        } catch { /* ignore */ }
      }

      res.json({
        id: svc.id,
        name: svc.displayName,
        description: svc.description,
        hostingModel: svc.hostingModel,
        skills,
        rateLimits,
        callEndpoint: `/api/mesh/services/${svc.id}/{skillName}`,
      });
    } catch (err) {
      log.error({ id, err }, "Mesh discovery: service detail failed");
      res.status(500).json({ error: "Failed to fetch service details" });
    }
  },
);

// ── A2A Agent Card (public) ──────────────────────────────────────────────

export function registerAgentCard(app: import("express").Application): void {
  app.get("/.well-known/jarble-mesh.json", (_req: Request, res: Response) => {
    res.json({
      name: "Jarble Mesh",
      version: "1.0.0",
      description: "Jarble is an agent mesh platform. External agents can discover, use, and contribute services.",
      protocol: "jarble-mesh/v1",
      endpoints: {
        catalog: "/api/mesh/services",
        serviceDetail: "/api/mesh/services/{serviceId}",
        callSkill: "/api/mesh/services/{serviceId}/{skillName}",
      },
      authentication: {
        type: "bearer",
        prefix: "jrbl_",
        description: "API key obtained from the Jarble dashboard Settings > API Keys",
      },
      capabilities: [
        "service-discovery",
        "service-execution",
        "rate-limiting",
        "circuit-breaking",
      ],
    });
  });
}
