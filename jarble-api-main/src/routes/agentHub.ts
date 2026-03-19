/**
 * Agent Hub Routes
 *
 * Express routes for agent-to-agent communication via the marketplace hub.
 *
 * POST /api/agent-hub/call   — Execute an agent-to-agent call (auth required)
 * GET  /api/agent-hub/discover — Search for available agents (public)
 */

import { Router } from "express";
import { eq, like, and, sql } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { executeAgentCall } from "../services/marketplaceHub.js";
import { agentCallEvents } from "../utils/agentCallEvents.js";

const logger = createModuleLogger("agent-hub");

export const agentHubRouter = Router();

/**
 * POST /call — Execute an agent-to-agent call via the marketplace hub.
 *
 * Auth: Bearer JWT or X-Gateway-Token (pod auth).
 *
 * Body: {
 *   callerDeploymentId: string,
 *   serviceId: string,
 *   skillName: string,
 *   args?: any,
 * }
 */
agentHubRouter.post("/call", async (req, res) => {
  try {
    // Authenticate — JWT or gateway token
    let userId: string | null = null;

    const authHeader = req.headers.authorization;
    const gatewayToken = req.headers["x-gateway-token"] as string | undefined;

    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.slice(7);
      try {
        const decoded = await verifyToken(token);
        const user = await getUserFromToken(decoded);
        userId = user?.id ?? null;
      } catch {
        // Fall through to gateway token
      }
    }

    if (!userId && gatewayToken) {
      // Pod-level auth — get user from deployment
      const deploymentId = req.headers["x-deployment-id"] as string;
      if (deploymentId) {
        const deployment = await db
          .select({ userId: tables.deployments.userId })
          .from(tables.deployments)
          .where(eq(tables.deployments.id, deploymentId))
          .limit(1);
        if (deployment.length > 0) {
          userId = deployment[0].userId;
        }
      }
    }

    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }

    const { callerDeploymentId, serviceId, skillName, args } = req.body;

    if (!callerDeploymentId || !serviceId || !skillName) {
      res.status(400).json({
        error: "Missing required fields: callerDeploymentId, serviceId, skillName",
      });
      return;
    }

    // Verify the caller deployment belongs to this user
    const callerDeploy = await db
      .select({ userId: tables.deployments.userId })
      .from(tables.deployments)
      .where(eq(tables.deployments.id, callerDeploymentId))
      .limit(1);

    if (callerDeploy.length === 0 || callerDeploy[0].userId !== userId) {
      res.status(403).json({ error: "Deployment does not belong to you" });
      return;
    }

    // Look up the service display name for the frontend indicator
    const svcLookup = await db
      .select({ displayName: tables.marketplaceServices.displayName })
      .from(tables.marketplaceServices)
      .where(eq(tables.marketplaceServices.id, serviceId))
      .limit(1);
    const agentName = svcLookup[0]?.displayName || undefined;

    // Notify SSE listeners that an agent call is starting
    agentCallEvents.emit("start", {
      deploymentId: callerDeploymentId,
      serviceId,
      skillName,
      agentName,
    });

    const result = await executeAgentCall({
      callerDeploymentId,
      calleeServiceId: serviceId,
      skillName,
      args: args || {},
      callerUserId: userId,
    });

    // Notify SSE listeners that the agent call completed
    agentCallEvents.emit("end", {
      deploymentId: callerDeploymentId,
      serviceId,
      skillName,
      agentName,
      creditsCharged: result.creditsCharged,
      success: true,
    });

    res.json({
      success: true,
      result: result.result,
      creditsCharged: result.creditsCharged,
      callId: result.callId,
    });
  } catch (err: any) {
    // Notify SSE listeners that the agent call failed (use req.body since destructured vars may be out of scope)
    if (req.body?.callerDeploymentId) {
      agentCallEvents.emit("end", {
        deploymentId: req.body.callerDeploymentId,
        serviceId: req.body.serviceId,
        skillName: req.body.skillName,
        creditsCharged: 0,
        success: false,
      });
    }

    logger.error({ err: err.message }, "Agent hub call failed");
    const status = err.message.includes("Insufficient credits")
      ? 402
      : err.message.includes("not found")
      ? 404
      : 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /discover — Search for available agents/services.
 *
 * Query params:
 *   q?: string       — search query (matches name/description)
 *   category?: string — filter by category
 *   limit?: number   — max results (default 20)
 *
 * Public endpoint — no auth required.
 */
agentHubRouter.get("/discover", async (req, res) => {
  try {
    const query = req.query.q as string | undefined;
    const category = req.query.category as string | undefined;
    const limit = Math.min(Number(req.query.limit) || 20, 50);

    // Build conditions: only published services
    const conditions = [eq(tables.marketplaceServices.status, "published")];

    if (query) {
      conditions.push(
        sql`(${tables.marketplaceServices.name} LIKE ${"%" + query + "%"} OR ${
          tables.marketplaceServices.displayName
        } LIKE ${"%" + query + "%"} OR ${
          tables.marketplaceServices.description
        } LIKE ${"%" + query + "%"})`
      );
    }

    const services = await db
      .select({
        id: tables.marketplaceServices.id,
        name: tables.marketplaceServices.name,
        displayName: tables.marketplaceServices.displayName,
        description: tables.marketplaceServices.description,
        hostingModel: tables.marketplaceServices.hostingModel,
        pricingModel: tables.marketplaceServices.pricingModel,
        priceUsdCents: tables.marketplaceServices.priceUsdCents,
        totalInstalls: tables.marketplaceServices.totalInstalls,
        avgRating: tables.marketplaceServices.avgRating,
      })
      .from(tables.marketplaceServices)
      .where(and(...conditions))
      .limit(limit);

    // For each service, get its skills
    const results = await Promise.all(
      services.map(async (svc) => {
        const skills = await db
          .select({
            skillName: tables.skillsCatalog.name,
            skillDescription: tables.skillsCatalog.description,
          })
          .from(tables.serviceSkills)
          .innerJoin(
            tables.skillsCatalog,
            eq(tables.serviceSkills.skillId, tables.skillsCatalog.id)
          )
          .where(eq(tables.serviceSkills.packageId, svc.id));

        return {
          ...svc,
          creditsPerCall: 1, // flat rate for MVP
          skills: skills.map((s) => ({
            name: s.skillName,
            description: s.skillDescription,
          })),
        };
      })
    );

    res.json({
      agents: results,
      count: results.length,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "Agent discovery failed");
    res.status(500).json({ error: "Discovery failed" });
  }
});
