import { Router } from "express";
import { eq, and, like, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, tables, dbDate } from "../db/index.js";
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
    await db.update(deploymentsTable)
      .set({ status, ...(status === "running" ? { error: null } : {}) })
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
      await db.insert(usersTable).values({
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
    const expiresAt = dbDate(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000));
    await db.insert(deploymentsTable).values({
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

// Publish a service to marketplace (called by MCP server's publish_to_marketplace tool)
debugRouter.post("/marketplace/publish-service", async (req, res) => {
  try {
    const {
      name, displayName, description, hostingModel, instructionSnippet,
      remoteApiEndpoint, category, pricingModel, priceUsdCents, creatorId,
    } = req.body;

    if (!name || !displayName || !creatorId) {
      res.status(400).json({ error: "Missing required fields: name, displayName, creatorId" });
      return;
    }

    // Generate ID
    const id = `pkg_${name.replace(/[^a-z0-9]/g, "").slice(0, 8)}_${nanoid(8)}`;
    const now = dbDate();

    await db.insert(tables.marketplaceServices).values({
      id,
      name: name || displayName.toLowerCase().replace(/\s+/g, "_"),
      displayName,
      description: description || null,
      hostingModel: hostingModel || "hosted",
      instructionSnippet: instructionSnippet || null,
      remoteApiEndpoint: remoteApiEndpoint || null,
      status: "submitted",
      pricingModel: pricingModel || "free",
      priceUsdCents: priceUsdCents || 0,
      creatorId,
      createdAt: now,
      updatedAt: now,
    } as any);

    logger.info({ serviceId: id, name, creatorId }, "Debug: service published to marketplace");
    res.json({ success: true, id, status: "submitted" });
  } catch (err) {
    logger.error({ err }, "Debug: marketplace publish failed");
    res.status(500).json({ error: "Failed to publish", details: String(err) });
  }
});

// ── Marketplace API (called by MCP tools on pods) ────────────────────

// Browse marketplace — components and services
debugRouter.get("/marketplace/browse", async (req, res) => {
  try {
    const type = (req.query.type as string) || "all";
    const q = (req.query.q as string) || "";
    const category = req.query.category as string;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 50);

    const results: any[] = [];

    if (type === "all" || type === "component") {
      let components = await db.query.marketplaceComponents.findMany({
        where: eq(tables.marketplaceComponents.status, "published"),
      });
      if (q) {
        const lower = q.toLowerCase();
        components = components.filter((c: any) =>
          c.name?.toLowerCase().includes(lower) ||
          c.displayName?.toLowerCase().includes(lower) ||
          c.description?.toLowerCase().includes(lower)
        );
      }
      if (category) {
        components = components.filter((c: any) => c.category === category);
      }
      for (const c of components.slice(0, limit)) {
        results.push({
          type: "component",
          id: (c as any).id,
          name: (c as any).name,
          displayName: (c as any).displayName,
          description: (c as any).description,
          category: (c as any).category,
          tier: (c as any).tier,
          pricingModel: (c as any).pricingModel,
          priceUsdCents: (c as any).priceUsdCents,
          totalInstalls: (c as any).totalInstalls,
          avgRating: (c as any).avgRating,
        });
      }
    }

    if (type === "all" || type === "service") {
      let services = await db.query.marketplaceServices.findMany({
        where: eq(tables.marketplaceServices.status, "published"),
      });
      if (q) {
        const lower = q.toLowerCase();
        services = services.filter((s: any) =>
          s.name?.toLowerCase().includes(lower) ||
          s.displayName?.toLowerCase().includes(lower) ||
          s.description?.toLowerCase().includes(lower)
        );
      }
      for (const s of services.slice(0, limit)) {
        results.push({
          type: "service",
          id: (s as any).id,
          name: (s as any).name,
          displayName: (s as any).displayName,
          description: (s as any).description,
          hostingModel: (s as any).hostingModel,
          pricingModel: (s as any).pricingModel,
          priceUsdCents: (s as any).priceUsdCents,
          totalInstalls: (s as any).totalInstalls,
          avgRating: (s as any).avgRating,
        });
      }
    }

    res.json({ results, count: results.length });
  } catch (err) {
    res.status(500).json({ error: "Browse failed", details: String(err) });
  }
});

// Get marketplace item details
debugRouter.get("/marketplace/item/:id", async (req, res) => {
  try {
    const { id } = req.params;

    // Try component first
    const comp = await db.query.marketplaceComponents.findFirst({
      where: eq(tables.marketplaceComponents.id, id),
    });
    if (comp) {
      // Get bundled components for services
      res.json({ type: "component", item: comp });
      return;
    }

    // Try service
    const svc = await db.query.marketplaceServices.findFirst({
      where: eq(tables.marketplaceServices.id, id),
    });
    if (svc) {
      // Get bundled components and skills
      const bundledComponents = await db.query.serviceComponents.findMany({
        where: eq(tables.serviceComponents.packageId, id),
      });
      const bundledSkills = await db.query.serviceSkills.findMany({
        where: eq(tables.serviceSkills.packageId, id),
      });
      res.json({
        type: "service",
        item: svc,
        components: bundledComponents,
        skills: bundledSkills,
      });
      return;
    }

    res.status(404).json({ error: "Item not found" });
  } catch (err) {
    res.status(500).json({ error: "Get item failed", details: String(err) });
  }
});

// List installed items for a deployment
debugRouter.get("/marketplace/installed/:deploymentId", async (req, res) => {
  try {
    const { deploymentId } = req.params;

    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, deploymentId),
    });
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    const componentInstalls = await db.query.componentInstalls.findMany({
      where: eq(tables.componentInstalls.deploymentId, deploymentId),
      with: { component: true },
    });

    const serviceInstalls = await db.query.serviceInstalls.findMany({
      where: eq(tables.serviceInstalls.deploymentId, deploymentId),
      with: { package: true },
    });

    res.json({
      deploymentId,
      components: componentInstalls.map((ci: any) => ({
        installId: ci.id,
        componentId: ci.componentId,
        name: ci.component?.name,
        displayName: ci.component?.displayName,
        description: ci.component?.description,
        tier: ci.component?.tier,
        installedAt: ci.installedAt,
      })),
      services: serviceInstalls.map((si: any) => ({
        installId: si.id,
        serviceId: si.packageId,
        name: si.package?.name,
        displayName: si.package?.displayName,
        description: si.package?.description,
        hostingModel: si.package?.hostingModel,
        installedAt: si.installedAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: "List installed failed", details: String(err) });
  }
});

// Install a marketplace item onto a deployment
debugRouter.post("/marketplace/install", async (req, res) => {
  try {
    const { itemId, type, deploymentId, userId } = req.body;
    if (!itemId || !deploymentId || !userId) {
      res.status(400).json({ error: "Missing required fields: itemId, deploymentId, userId" });
      return;
    }

    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, deploymentId),
    });
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    const now = dbDate();

    if (type === "service") {
      // Install a service (components + skills + instruction snippet)
      const svc = await db.query.marketplaceServices.findFirst({
        where: eq(tables.marketplaceServices.id, itemId),
      });
      if (!svc) {
        res.status(404).json({ error: "Service not found" });
        return;
      }

      // Check if already installed
      const existing = await db.query.serviceInstalls.findFirst({
        where: and(
          eq(tables.serviceInstalls.packageId, itemId),
          eq(tables.serviceInstalls.deploymentId, deploymentId),
        ),
      });
      if (existing) {
        res.status(409).json({ error: "Service already installed" });
        return;
      }

      // Create install record
      const installId = `pki_${nanoid(12)}`;
      await db.insert(tables.serviceInstalls).values({
        id: installId,
        packageId: itemId,
        deploymentId,
        userId,
        installedAt: now,
      });

      // Install bundled components
      const pkgComps = await db.query.serviceComponents.findMany({
        where: eq(tables.serviceComponents.packageId, itemId),
      });
      for (const pc of pkgComps) {
        const existingComp = await db.query.componentInstalls.findFirst({
          where: and(
            eq(tables.componentInstalls.componentId, (pc as any).componentId),
            eq(tables.componentInstalls.deploymentId, deploymentId),
          ),
        });
        if (existingComp) continue;

        const versions = await db.query.componentVersions.findMany({
          where: eq(tables.componentVersions.componentId, (pc as any).componentId),
        });
        if (versions.length === 0) continue;

        const sorted = [...versions].sort((a: any, b: any) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );

        await db.insert(tables.componentInstalls).values({
          id: `ci_${nanoid(12)}`,
          componentId: (pc as any).componentId,
          deploymentId,
          versionId: (sorted[0] as any).id,
          userId,
          installedAt: now,
        });
      }

      // Install bundled skills
      const pkgSkills = await db.query.serviceSkills.findMany({
        where: eq(tables.serviceSkills.packageId, itemId),
      });
      for (const ps of pkgSkills) {
        const existingSkill = await db.query.deploymentSkills.findFirst({
          where: and(
            eq(tables.deploymentSkills.skillId, (ps as any).skillId),
            eq(tables.deploymentSkills.deploymentId, deploymentId),
          ),
        });
        if (existingSkill) continue;

        await db.insert(tables.deploymentSkills).values({
          id: `ds_${nanoid(12)}`,
          skillId: (ps as any).skillId,
          deploymentId,
          installedAt: now,
        });
      }

      // Increment install count
      await db.update(tables.marketplaceServices)
        .set({ totalInstalls: sql`${tables.marketplaceServices.totalInstalls} + 1` as any })
        .where(eq(tables.marketplaceServices.id, itemId));

      // Trigger configSync (fire and forget)
      if ((deployment as any).status === "running") {
        void syncConfigsToPvc(deploymentId);
      }

      logger.info({ serviceId: itemId, deploymentId }, "Debug: marketplace service installed");
      res.json({ success: true, installId, type: "service", message: "Service installed. ConfigSync triggered." });

    } else {
      // Install a single component
      const comp = await db.query.marketplaceComponents.findFirst({
        where: eq(tables.marketplaceComponents.id, itemId),
      });
      if (!comp) {
        res.status(404).json({ error: "Component not found" });
        return;
      }

      // Check if already installed
      const existing = await db.query.componentInstalls.findFirst({
        where: and(
          eq(tables.componentInstalls.componentId, itemId),
          eq(tables.componentInstalls.deploymentId, deploymentId),
        ),
      });
      if (existing) {
        res.status(409).json({ error: "Component already installed" });
        return;
      }

      const versions = await db.query.componentVersions.findMany({
        where: eq(tables.componentVersions.componentId, itemId),
      });
      const versionId = versions.length > 0
        ? ([...versions].sort((a: any, b: any) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0] as any).id
        : null;

      const installId = `ci_${nanoid(12)}`;
      await db.insert(tables.componentInstalls).values({
        id: installId,
        componentId: itemId,
        deploymentId,
        versionId,
        userId,
        installedAt: now,
      });

      // Increment install count
      await db.update(tables.marketplaceComponents)
        .set({ totalInstalls: sql`${tables.marketplaceComponents.totalInstalls} + 1` as any })
        .where(eq(tables.marketplaceComponents.id, itemId));

      // Trigger configSync
      if ((deployment as any).status === "running") {
        void syncConfigsToPvc(deploymentId);
      }

      logger.info({ componentId: itemId, deploymentId }, "Debug: marketplace component installed");
      res.json({ success: true, installId, type: "component", message: "Component installed. ConfigSync triggered." });
    }
  } catch (err) {
    logger.error({ err }, "Debug: marketplace install failed");
    res.status(500).json({ error: "Install failed", details: String(err) });
  }
});

// Uninstall a marketplace item from a deployment
debugRouter.post("/marketplace/uninstall", async (req, res) => {
  try {
    const { itemId, type, deploymentId } = req.body;
    if (!itemId || !deploymentId) {
      res.status(400).json({ error: "Missing required fields: itemId, deploymentId" });
      return;
    }

    if (type === "service") {
      const install = await db.query.serviceInstalls.findFirst({
        where: and(
          eq(tables.serviceInstalls.packageId, itemId),
          eq(tables.serviceInstalls.deploymentId, deploymentId),
        ),
      });
      if (!install) {
        res.status(404).json({ error: "Service not installed on this deployment" });
        return;
      }

      await db.delete(tables.serviceInstalls)
        .where(eq(tables.serviceInstalls.id, (install as any).id));

      // Trigger configSync to remove instruction snippet from soul.md
      void syncConfigsToPvc(deploymentId);

      res.json({ success: true, type: "service", message: "Service uninstalled. ConfigSync triggered." });
    } else {
      const install = await db.query.componentInstalls.findFirst({
        where: and(
          eq(tables.componentInstalls.componentId, itemId),
          eq(tables.componentInstalls.deploymentId, deploymentId),
        ),
      });
      if (!install) {
        res.status(404).json({ error: "Component not installed on this deployment" });
        return;
      }

      await db.delete(tables.componentInstalls)
        .where(eq(tables.componentInstalls.id, (install as any).id));

      void syncConfigsToPvc(deploymentId);

      res.json({ success: true, type: "component", message: "Component uninstalled. ConfigSync triggered." });
    }
  } catch (err) {
    logger.error({ err }, "Debug: marketplace uninstall failed");
    res.status(500).json({ error: "Uninstall failed", details: String(err) });
  }
});

// Publish a component to marketplace
debugRouter.post("/marketplace/publish-component", async (req, res) => {
  try {
    const {
      name, displayName, description, tier, category,
      tags, propsSchema, exampleProps, pricingModel, priceUsdCents, creatorId,
    } = req.body;

    if (!name || !displayName || !description || !creatorId) {
      res.status(400).json({ error: "Missing required fields: name, displayName, description, creatorId" });
      return;
    }

    const id = `cmp_${name.replace(/[^a-z0-9]/g, "").slice(0, 8)}_${nanoid(8)}`;
    const now = dbDate();

    await db.insert(tables.marketplaceComponents).values({
      id,
      name,
      displayName,
      description,
      tier: tier || "template",
      category: category || "utility",
      tags: tags ? (typeof tags === "string" ? tags : JSON.stringify(tags)) : null,
      propsSchema: propsSchema ? (typeof propsSchema === "string" ? propsSchema : JSON.stringify(propsSchema)) : null,
      exampleProps: exampleProps ? (typeof exampleProps === "string" ? exampleProps : JSON.stringify(exampleProps)) : null,
      pricingModel: pricingModel || "free",
      priceUsdCents: priceUsdCents || 0,
      creatorId,
      status: "submitted",
      createdAt: now,
      updatedAt: now,
    } as any);

    logger.info({ componentId: id, name, creatorId }, "Debug: component published to marketplace");
    res.json({ success: true, id, status: "submitted" });
  } catch (err) {
    logger.error({ err }, "Debug: marketplace component publish failed");
    res.status(500).json({ error: "Failed to publish component", details: String(err) });
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

// ── Platform skills endpoint ──────────────────────────────────────────────────
// Serves the latest platform skills so pods can fetch them on boot.
// This is the single source of truth — update skills here, redeploy API,
// and pods pick them up on next restart without needing a new container image.

import { getPlatformSkills } from "../skills/platformSkills.js";

debugRouter.get("/platform-skills", (_req, res) => {
  const skills = getPlatformSkills();
  res.json({
    version: skills.version,
    updatedAt: skills.updatedAt,
    skills: skills.skills,
  });
});
