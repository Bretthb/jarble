import { Router } from "express";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, tables } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { verifyToken } from "../services/auth.js";
import { syncConfigsToPvc } from "../services/configSync.js";

/**
 * Debug endpoints — only mounted in development mode.
 */
export const debugRouter = Router();

// Dump all database tables
debugRouter.get("/db", async (_req, res) => {
  try {
    const users = await db.query.users.findMany();
    const deployments = await db.query.deployments.findMany();
    const runtimeCatalog = await db.query.runtimeCatalog.findMany();
    const skillsCatalog = await db.query.skillsCatalog.findMany();
    const deploymentSkills = await db.query.deploymentSkills.findMany();
    const platCreds = await db.query.platformCredentials.findMany();

    res.json({
      _info: "Development only - shows all database tables",
      tables: {
        users: { count: users.length, data: users },
        deployments: { count: deployments.length, data: deployments },
        runtimeCatalog: { count: runtimeCatalog.length, data: runtimeCatalog },
        skillsCatalog: { count: skillsCatalog.length, data: skillsCatalog },
        deploymentSkills: { count: deploymentSkills.length, data: deploymentSkills },
        platformCredentials: { count: platCreds.length, data: platCreds },
      }
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to query database", details: String(err) });
  }
});

// Update deployment status
debugRouter.post("/deployment/:id/status", async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!status || !["creating", "running", "stopped", "failed", "restarting"].includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    const { deployments: deploymentsTable } = tables;
    await (db as any).update(deploymentsTable)
      .set({ status })
      .where(eq(deploymentsTable.id, id));
    res.json({ success: true, id, status });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Seed a test deployment for the currently authenticated user
debugRouter.post("/seed-deployment", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      res.status(401).json({ error: "Bearer token required" });
      return;
    }
    const token = authHeader.slice(7);
    const payload = await verifyToken(token);
    const auth0Id = payload.sub as string;

    // Find or create the user
    const { users: usersTable, deployments: deploymentsTable } = tables;
    let user = await db.query.users.findFirst({ where: eq(usersTable.auth0Id, auth0Id) });

    if (!user) {
      const userId = nanoid();
      await (db as any).insert(usersTable).values({
        id: userId,
        email: `dev-${nanoid(6)}@jarble.local`,
        name: "Dev User",
        auth0Id,
        emailVerified: true,
        freeDeploymentUsed: false,
      });
      user = await db.query.users.findFirst({ where: eq(usersTable.auth0Id, auth0Id) });
    }

    // Check if they already have a deployment
    const existing = await db.query.deployments.findFirst({
      where: eq(deploymentsTable.userId, user!.id),
    });
    if (existing) {
      res.json({ message: "User already has a deployment", deployment: existing });
      return;
    }

    // Create a running test deployment
    const deploymentId = nanoid();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await (db as any).insert(deploymentsTable).values({
      id: deploymentId,
      userId: user!.id,
      name: "Dev Test Deployment",
      description: "Auto-seeded for local testing",
      runtime: "openclaw",
      runtimeCatalogId: 1,
      isFree: true,
      monthlyPriceCents: 0,
      freeExpiresAt: expiresAt,
      llmMode: "byok",
      llmProvider: "openrouter",
      llmModel: "openrouter/auto",
      status: "running",
    });

    const deployment = await db.query.deployments.findFirst({ where: eq(deploymentsTable.id, deploymentId) });
    logger.info({ auth0Id, deploymentId }, "Seeded dev deployment for authenticated user");
    res.json({ message: "Dev deployment created", deployment });
  } catch (err) {
    res.status(500).json({ error: "Failed to seed deployment", details: String(err) });
  }
});

// Trigger configSync for a deployment
debugRouter.post("/deployment/:id/sync-config", async (req, res) => {
  try {
    const { id } = req.params;

    // Verify deployment exists
    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, id),
    });

    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    logger.info({ deploymentId: id }, "Debug: triggering configSync (fire and forget)");

    // Trigger config sync (fire and forget - don't block the request)
    void syncConfigsToPvc(id);

    res.json({ success: true, deploymentId: id, message: "Config sync triggered (running in background)" });
  } catch (err) {
    logger.error({ err }, "Debug: configSync failed");
    res.status(500).json({ error: "Config sync failed", details: String(err) });
  }
});
