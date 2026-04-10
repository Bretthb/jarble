import { Router, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, tables, dbDate } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { syncConfigsToPvc } from "../services/configSync.js";
import { safeFireAndForget } from "../utils/safeAsync.js";
import { encryptApiKey } from "../utils/encryption.js";
import { generateSigningSecret } from "../utils/hmac.js";
import { performInstallHandshake } from "../services/serviceHandshake.js";
import { validateThemeConfig } from "@jarble/component-manifest";
import { decryptApiKey } from "../utils/encryption.js";
import { RESERVED_ENV_VARS } from "../trpc/routers/deploymentSecrets.js";

const logger = createModuleLogger("podApi");

// ── K8s imports (optional - not available in SQLite dev mode) ────────────────
let coreApi: any = null;
let NAMESPACE = "jarble";

const k8sReady = (async () => {
  try {
    const k8sClient = await import("../k8s/client.js");
    const k8sConstants = await import("../k8s/constants.js");
    coreApi = k8sClient.coreApi;
    NAMESPACE = k8sConstants.NAMESPACE;
  } catch {
    // K8s not available (SQLite dev mode)
  }
})();

export const podApiRouter = Router();

// ── Authentication middleware ─────────────────────────────────────────────────
// Verifies pod identity using deployment ID + gateway token.
// In production (K8s available), reads the expected token from K8s Secret.
// In dev mode (no K8s), accepts any non-empty token if deployment exists.

export async function authenticatePod(req: Request, res: Response, next: NextFunction) {
  // Ensure K8s client is initialized (no-op after first request)
  await k8sReady;

  const deploymentId = req.headers["x-deployment-id"] as string;
  const gatewayToken = req.headers["x-gateway-token"] as string;

  if (!deploymentId || !gatewayToken) {
    res.status(401).json({ error: "Missing X-Deployment-Id or X-Gateway-Token" });
    return;
  }

  // Verify deployment exists in DB
  const deployment = await db.query.deployments.findFirst({
    where: eq(tables.deployments.id, deploymentId),
  });
  if (!deployment) {
    res.status(401).json({ error: "Deployment not found" });
    return;
  }

  // In K8s mode, verify token from the deployment's Secret
  if (coreApi) {
    try {
      const secret = await coreApi.readNamespacedSecret(
        `secret-${deploymentId}`,
        NAMESPACE,
      );
      const data = secret.body.data ?? {};
      const tokenB64 = data["OPENCLAW_GATEWAY_TOKEN"];
      const expected = tokenB64
        ? Buffer.from(tokenB64, "base64").toString("utf-8")
        : "";
      if (!expected || gatewayToken.length !== expected.length || !timingSafeEqual(Buffer.from(gatewayToken), Buffer.from(expected))) {
        res.status(401).json({ error: "Invalid gateway token" });
        return;
      }
    } catch {
      res.status(500).json({ error: "Failed to verify gateway token" });
      return;
    }
  }
  // In dev mode (SQLite), deployment existence check above is sufficient

  // Attach deployment info for downstream handlers
  (req as any).podDeployment = deployment;
  (req as any).podDeploymentId = deploymentId;
  next();
}

podApiRouter.use(authenticatePod);

// ── Helper: resolve or auto-create creator profile ───────────────────────────
async function resolveCreatorId(userId: string, fallbackName: string): Promise<string> {
  const profile = await db.query.creatorProfiles.findFirst({
    where: eq(tables.creatorProfiles.userId, userId),
  });
  if (profile) return (profile as any).id;

  const profileId = `cp_${nanoid(12)}`;
  await db.insert(tables.creatorProfiles).values({
    id: profileId,
    userId,
    displayName: fallbackName || "Bot Creator",
    bio: "Auto-created creator profile",
    createdAt: dbDate(),
    updatedAt: dbDate(),
  } as any);
  return profileId;
}

// ── Browse marketplace ───────────────────────────────────────────────────────
// GET /api/pod/marketplace/browse?type=all|component|service&q=...&category=...&limit=20
podApiRouter.get("/marketplace/browse", async (req: Request, res: Response) => {
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
        components = components.filter(
          (c: any) =>
            c.name?.toLowerCase().includes(lower) ||
            c.displayName?.toLowerCase().includes(lower) ||
            c.description?.toLowerCase().includes(lower),
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
        services = services.filter(
          (s: any) =>
            s.name?.toLowerCase().includes(lower) ||
            s.displayName?.toLowerCase().includes(lower) ||
            s.description?.toLowerCase().includes(lower),
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

// ── Get marketplace item details ─────────────────────────────────────────────
// GET /api/pod/marketplace/item/:id
podApiRouter.get("/marketplace/item/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Try component first
    const comp = await db.query.marketplaceComponents.findFirst({
      where: eq(tables.marketplaceComponents.id, id),
    });
    if (comp) {
      res.json({ type: "component", item: comp });
      return;
    }

    // Try service
    const svc = await db.query.marketplaceServices.findFirst({
      where: eq(tables.marketplaceServices.id, id),
    });
    if (svc) {
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

// ── List installed items for the authenticated deployment ────────────────────
// GET /api/pod/marketplace/installed
// No deploymentId param needed - uses the authenticated deployment from middleware
podApiRouter.get("/marketplace/installed", async (req: Request, res: Response) => {
  try {
    const deploymentId = (req as any).podDeploymentId as string;

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

// ── Install a marketplace item ───────────────────────────────────────────────
// POST /api/pod/marketplace/install
// Body: { itemId, type }
// deploymentId is ALWAYS the authenticated deployment (body.deploymentId is IGNORED)
podApiRouter.post("/marketplace/install", async (req: Request, res: Response) => {
  try {
    const deploymentId = (req as any).podDeploymentId as string;
    const deployment = (req as any).podDeployment;
    const userId = (deployment as any).userId as string;
    const { itemId, type } = req.body;

    if (!itemId) {
      res.status(400).json({ error: "Missing required field: itemId" });
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

        const sorted = [...versions].sort(
          (a: any, b: any) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
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
      await db
        .update(tables.marketplaceServices)
        .set({
          totalInstalls: sql`${tables.marketplaceServices.totalInstalls} + 1` as any,
        })
        .where(eq(tables.marketplaceServices.id, itemId));

      // ── Credential generation for remote/hybrid/platform_managed services ──
      const isRemote = ["remote", "hybrid", "platform_managed"].includes(
        (svc as any).hostingModel,
      );

      if (isRemote && (svc as any).remoteApiConfig) {
        const signingSecret = generateSigningSecret();
        const encryptedSecret = encryptApiKey(signingSecret);

        const credId = `pkc_${nanoid(12)}`;
        await db.insert(tables.serviceCredentials).values({
          id: credId,
          packageInstallId: installId,
          deploymentId,
          packageId: itemId,
          signingSecret: encryptedSecret,
          handshakeStatus:
            (svc as any).hostingModel === "platform_managed"
              ? "completed"
              : "pending",
          createdAt: now,
          updatedAt: now,
        } as any);

        // For non-platform-managed (remote/hybrid), perform handshake
        if (
          (svc as any).hostingModel !== "platform_managed" &&
          (svc as any).remoteApiEndpoint
        ) {
          void (async () => {
            try {
              const result = await performInstallHandshake({
                endpoint: (svc as any).remoteApiEndpoint,
                serviceId: itemId,
                deploymentId,
                signingSecret,
              });

              await db
                .update(tables.serviceCredentials)
                .set({
                  handshakeStatus: "completed",
                  remoteInstallId: result.remoteInstallId ?? null,
                  updatedAt: dbDate(),
                } as any)
                .where(eq(tables.serviceCredentials.id, credId));

              logger.info(
                { serviceId: itemId, credId },
                "Pod API: remote handshake completed",
              );
            } catch (err) {
              const errorMsg =
                err instanceof Error ? err.message : "Unknown error";
              await db
                .update(tables.serviceCredentials)
                .set({
                  handshakeStatus: "failed",
                  handshakeError: errorMsg.slice(0, 500),
                  updatedAt: dbDate(),
                } as any)
                .where(eq(tables.serviceCredentials.id, credId));

              logger.warn(
                { serviceId: itemId, credId, err },
                "Pod API: install handshake failed (non-fatal)",
              );
            }
          })();
        }
      }

      // Trigger configSync (fire and forget)
      if ((deployment as any).status === "running") {
        safeFireAndForget(syncConfigsToPvc(deploymentId), { operation: "syncConfigsToPvc", deploymentId });
      }

      logger.info(
        { serviceId: itemId, deploymentId, userId },
        "Pod API: marketplace service installed",
      );
      res.json({
        success: true,
        installId,
        type: "service",
        message: "Service installed. ConfigSync triggered.",
      });
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
      const versionId =
        versions.length > 0
          ? ([...versions].sort(
              (a: any, b: any) =>
                new Date(b.createdAt).getTime() -
                new Date(a.createdAt).getTime(),
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
      await db
        .update(tables.marketplaceComponents)
        .set({
          totalInstalls: sql`${tables.marketplaceComponents.totalInstalls} + 1` as any,
        })
        .where(eq(tables.marketplaceComponents.id, itemId));

      // Trigger configSync
      if ((deployment as any).status === "running") {
        safeFireAndForget(syncConfigsToPvc(deploymentId), { operation: "syncConfigsToPvc", deploymentId });
      }

      logger.info(
        { componentId: itemId, deploymentId, userId },
        "Pod API: marketplace component installed",
      );
      res.json({
        success: true,
        installId,
        type: "component",
        message: "Component installed. ConfigSync triggered.",
      });
    }
  } catch (err) {
    logger.error({ err }, "Pod API: marketplace install failed");
    res.status(500).json({ error: "Install failed", details: String(err) });
  }
});

// ── Uninstall a marketplace item ─────────────────────────────────────────────
// POST /api/pod/marketplace/uninstall
// Body: { itemId, type }
// deploymentId is ALWAYS the authenticated deployment (body.deploymentId is IGNORED)
podApiRouter.post("/marketplace/uninstall", async (req: Request, res: Response) => {
  try {
    const deploymentId = (req as any).podDeploymentId as string;
    const { itemId, type } = req.body;

    if (!itemId) {
      res.status(400).json({ error: "Missing required field: itemId" });
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

      // Clean up credentials before deleting install record
      await db
        .delete(tables.serviceCredentials)
        .where(
          and(
            eq(tables.serviceCredentials.packageId, itemId),
            eq(tables.serviceCredentials.deploymentId, deploymentId),
          ),
        );

      await db
        .delete(tables.serviceInstalls)
        .where(eq(tables.serviceInstalls.id, (install as any).id));

      // Trigger configSync to remove instruction snippet from soul.md
      safeFireAndForget(syncConfigsToPvc(deploymentId), { operation: "syncConfigsToPvc", deploymentId });

      logger.info(
        { serviceId: itemId, deploymentId },
        "Pod API: marketplace service uninstalled",
      );
      res.json({
        success: true,
        type: "service",
        message: "Service uninstalled. ConfigSync triggered.",
      });
    } else {
      const install = await db.query.componentInstalls.findFirst({
        where: and(
          eq(tables.componentInstalls.componentId, itemId),
          eq(tables.componentInstalls.deploymentId, deploymentId),
        ),
      });
      if (!install) {
        res.status(404).json({
          error: "Component not installed on this deployment",
        });
        return;
      }

      await db
        .delete(tables.componentInstalls)
        .where(eq(tables.componentInstalls.id, (install as any).id));

      safeFireAndForget(syncConfigsToPvc(deploymentId), { operation: "syncConfigsToPvc", deploymentId });

      logger.info(
        { componentId: itemId, deploymentId },
        "Pod API: marketplace component uninstalled",
      );
      res.json({
        success: true,
        type: "component",
        message: "Component uninstalled. ConfigSync triggered.",
      });
    }
  } catch (err) {
    logger.error({ err }, "Pod API: marketplace uninstall failed");
    res.status(500).json({ error: "Uninstall failed", details: String(err) });
  }
});

// ── Publish a component ──────────────────────────────────────────────────────
// POST /api/pod/marketplace/publish-component
// creatorId is IGNORED - always resolved from the deployment's userId in DB
podApiRouter.post("/marketplace/publish-component", async (req: Request, res: Response) => {
  try {
    const deployment = (req as any).podDeployment;
    const deploymentId = (req as any).podDeploymentId as string;
    // marketplace_components.creator_id references users.id (NOT creator_profiles.id)
    // Still ensure a creator profile exists for the user
    await resolveCreatorId((deployment as any).userId, (deployment as any).name);
    const creatorId = (deployment as any).userId;

    const {
      name,
      displayName,
      description,
      tier,
      category,
      tags,
      propsSchema,
      exampleProps,
      pricingModel,
      priceUsdCents,
    } = req.body;

    if (!name || !displayName || !description) {
      res.status(400).json({
        error: "Missing required fields: name, displayName, description",
      });
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
      tags: tags
        ? typeof tags === "string"
          ? tags
          : JSON.stringify(tags)
        : null,
      propsSchema: propsSchema
        ? typeof propsSchema === "string"
          ? propsSchema
          : JSON.stringify(propsSchema)
        : null,
      exampleProps: exampleProps
        ? typeof exampleProps === "string"
          ? exampleProps
          : JSON.stringify(exampleProps)
        : null,
      pricingModel: pricingModel || "free",
      priceUsdCents: priceUsdCents || 0,
      creatorId,
      status: "submitted",
      createdAt: now,
      updatedAt: now,
    } as any);

    // Auto-create v1.0.0 so the component is installable immediately
    const versionId = `ver_${nanoid(12)}`;
    await db.insert(tables.componentVersions).values({
      id: versionId,
      componentId: id,
      version: "1.0.0",
      changelog: "Initial release",
      packageUrl: `pod://${deploymentId}/${name}/1.0.0`,
      packageSizeBytes: 0,
      manifestHash: `sha256-${nanoid(8)}`,
      createdAt: now,
    } as any);

    logger.info(
      { componentId: id, versionId, name, creatorId, deploymentId },
      "Pod API: component published to marketplace",
    );
    res.json({ success: true, id, versionId, status: "submitted" });
  } catch (err) {
    logger.error({ err }, "Pod API: marketplace component publish failed");
    res.status(500).json({
      error: "Failed to publish component",
      details: String(err),
    });
  }
});

// ── Publish a service ────────────────────────────────────────────────────────
// POST /api/pod/marketplace/publish-service
// creatorId is IGNORED - always resolved from the deployment's userId in DB
podApiRouter.post("/marketplace/publish-service", async (req: Request, res: Response) => {
  try {
    const deployment = (req as any).podDeployment;
    const deploymentId = (req as any).podDeploymentId as string;
    const creatorId = await resolveCreatorId((deployment as any).userId, (deployment as any).name);

    const {
      name,
      displayName,
      description,
      hostingModel,
      instructionSnippet,
      remoteApiEndpoint,
      category,
      pricingModel,
      priceUsdCents,
    } = req.body;

    if (!name || !displayName) {
      res.status(400).json({
        error: "Missing required fields: name, displayName",
      });
      return;
    }

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

    logger.info(
      { serviceId: id, name, creatorId, deploymentId },
      "Pod API: service published to marketplace",
    );
    res.json({ success: true, id, status: "submitted" });
  } catch (err) {
    logger.error({ err }, "Pod API: marketplace service publish failed");
    res.status(500).json({
      error: "Failed to publish service",
      details: String(err),
    });
  }
});

// ── Register a platform-managed service ─────────────────────────────────────
// POST /api/pod/marketplace/register-service
// Auto-generates a ServiceCard and marks as platform-managed (auto-approved).
podApiRouter.post("/marketplace/register-service", async (req: Request, res: Response) => {
  try {
    const deployment = (req as any).podDeployment;
    const deploymentId = (req as any).podDeploymentId as string;
    const creatorId = await resolveCreatorId((deployment as any).userId, (deployment as any).name);

    const {
      name,
      displayName,
      description,
      skills,
      instructionSnippet,
      category,
    } = req.body;

    // ── Validation ────────────────────────────────────────────────────────
    if (!name || !displayName || !description) {
      res.status(400).json({
        error: "Missing required fields: name, displayName, description",
      });
      return;
    }

    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
      res.status(400).json({
        error:
          "Invalid name: must start with a lowercase letter, contain only lowercase letters, digits, and hyphens, max 64 chars",
      });
      return;
    }

    if (!Array.isArray(skills) || skills.length < 1) {
      res.status(400).json({
        error: "At least one skill is required",
      });
      return;
    }

    // Validate each skill
    for (const skill of skills) {
      if (!skill.name || !skill.description || !skill.inputSchema) {
        res.status(400).json({
          error: `Skill "${skill.name || "(unnamed)"}" missing required fields: name, description, inputSchema`,
        });
        return;
      }
      if (skill.mode === "handler" && !skill.handlerCode) {
        res.status(400).json({
          error: `Skill "${skill.name}" has mode "handler" but no handlerCode provided`,
        });
        return;
      }
    }

    // ── Auto-generate ServiceCard ──────────────────────────────────────────
    const serviceCard = {
      creatorDeploymentId: deploymentId,
      auth: { type: "api_key", headerName: "X-API-Key" },
      skills: skills.map((s: any) => ({
        name: s.name,
        description: s.description,
        inputSchema: s.inputSchema,
        ...(s.outputSchema ? { outputSchema: s.outputSchema } : {}),
        executionMode: s.mode || "handler",
        ...(s.handlerCode ? { handlerCode: s.handlerCode } : {}),
      })),
      rateLimits: { requestsPerMinute: 60, requestsPerDay: 10000 },
      version: "1.0.0",
    };

    const id = `pkg_${name.replace(/[^a-z0-9]/g, "").slice(0, 8)}_${nanoid(8)}`;
    const now = dbDate();

    await db.insert(tables.marketplaceServices).values({
      id,
      name,
      displayName,
      description,
      hostingModel: "platform_managed",
      instructionSnippet: instructionSnippet || null,
      remoteApiEndpoint: null,
      remoteApiConfig: JSON.stringify(serviceCard),
      status: "published",
      pricingModel: "free",
      priceUsdCents: 0,
      category: category || "utility",
      creatorId,
      creatorDeploymentId: deploymentId,
      createdAt: now,
      updatedAt: now,
    } as any);

    logger.info(
      { serviceId: id, name, creatorId, deploymentId, skillCount: skills.length },
      "Pod API: platform-managed service registered",
    );
    res.json({
      success: true,
      id,
      status: "published",
      skillCount: skills.length,
    });
  } catch (err) {
    logger.error({ err }, "Pod API: register-service failed");
    res.status(500).json({
      error: "Failed to register service",
      details: String(err),
    });
  }
});

// ── Draft Service (from Publish button flow) ────────────────────────────────

// POST /api/pod/services/create-draft - Create a draft service from the canvas
// Called by the MCP create_draft_service tool when user clicks Publish on a card
podApiRouter.post("/services/create-draft", async (req: Request, res: Response) => {
  try {
    const deployment = (req as any).podDeployment;
    const deploymentId = (req as any).podDeploymentId as string;
    const userId = (deployment as any).userId as string;
    const creatorId = await resolveCreatorId(userId, (deployment as any).name);

    const {
      name, displayName, description, hostingModel,
      instructionSnippet, componentName, skills,
      creatorDeploymentId,
    } = req.body;

    if (!name || !displayName || !description || !hostingModel) {
      res.status(400).json({ error: "Missing required fields: name, displayName, description, hostingModel" });
      return;
    }

    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) {
      res.status(400).json({ error: "Invalid service name - must be lowercase alphanumeric with hyphens" });
      return;
    }

    // Check duplicate name
    const existing = await db.query.marketplaceServices.findFirst({
      where: and(
        eq(tables.marketplaceServices.creatorId, creatorId),
        eq(tables.marketplaceServices.name, name),
      ),
    });
    if (existing) {
      res.status(409).json({ error: "You already have a service with this name" });
      return;
    }

    // Resolve component name to ID if provided
    const componentIds: string[] = [];
    if (componentName) {
      const installs = await db.query.componentInstalls.findMany({
        where: eq(tables.componentInstalls.deploymentId, deploymentId),
      });
      for (const inst of installs) {
        const comp = await db.query.marketplaceComponents.findFirst({
          where: eq(tables.marketplaceComponents.id, inst.componentId),
        });
        if (comp && comp.name === componentName) {
          componentIds.push(comp.id);
          break;
        }
      }
    }

    // Resolve skill names to IDs if provided
    const skillIds: string[] = [];
    if (Array.isArray(skills)) {
      const deployedSkills = await db.query.deploymentSkills.findMany({
        where: eq(tables.deploymentSkills.deploymentId, deploymentId),
      });
      for (const skillDef of skills) {
        const skillName = typeof skillDef === "string" ? skillDef : skillDef?.name;
        if (!skillName) continue;
        for (const ds of deployedSkills) {
          const catalogSkill = await db.query.skillsCatalog.findFirst({
            where: eq(tables.skillsCatalog.id, ds.skillId),
          });
          if (catalogSkill && catalogSkill.name === skillName) {
            skillIds.push(catalogSkill.id);
            break;
          }
        }
      }
    }

    const serviceId = `pkg_${nanoid(16)}`;
    const now = dbDate();

    await db.insert(tables.marketplaceServices).values({
      id: serviceId,
      creatorId,
      name,
      displayName,
      description,
      hostingModel,
      instructionSnippet: instructionSnippet || null,
      remoteApiEndpoint: null,
      remoteApiConfig: null,
      creatorDeploymentId: creatorDeploymentId || (hostingModel === "remote" ? deploymentId : null),
      status: "draft",
      pricingModel: "free",
      priceUsdCents: 0,
      createdAt: now,
      updatedAt: now,
    } as any);

    // Link components
    for (const compId of componentIds) {
      await db.insert(tables.serviceComponents).values({
        id: `pkc_${nanoid(12)}`,
        packageId: serviceId,
        componentId: compId,
      });
    }

    // Link skills
    for (const skillId of skillIds) {
      await db.insert(tables.serviceSkills).values({
        id: `pks_${nanoid(12)}`,
        packageId: serviceId,
        skillId,
      });
    }

    logger.info({
      serviceId, name, creatorId, deploymentId,
      componentName, componentIds, skillIds,
    }, "Pod API: draft service created from canvas publish");

    res.json({
      success: true,
      serviceId,
      status: "draft",
      linkedComponents: componentIds.length,
      linkedSkills: skillIds.length,
    });
  } catch (err) {
    logger.error({ err }, "Pod API: create draft service failed");
    res.status(500).json({ error: "Failed to create draft", details: String(err) });
  }
});

// ── Theme ───────────────────────────────────────────────────────────────────

// POST /api/pod/theme - Set deployment theme (called by set_theme MCP tool)
podApiRouter.post("/theme", async (req: Request, res: Response) => {
  try {
    const deploymentId = (req as any).podDeploymentId as string;
    const themeConfig = req.body;

    // Validate theme config
    const error = validateThemeConfig(themeConfig);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    // Persist to DB
    await db.update(tables.deployments)
      .set({ themeConfig: JSON.stringify(themeConfig), updatedAt: dbDate() } as any)
      .where(eq(tables.deployments.id, deploymentId));

    logger.info({ deploymentId, preset: themeConfig.preset }, "Pod API: theme updated");
    res.json({ success: true, message: "Theme updated" });
  } catch (err) {
    logger.error({ err }, "Pod API: theme update failed");
    res.status(500).json({ error: "Failed to update theme", details: String(err) });
  }
});

// ── Deployment Secrets (bottom-up from agent) ───────────────────────────────

const SECRET_KEY_REGEX = /^[A-Z][A-Z0-9_]{0,127}$/;
const MAX_SECRETS_PER_DEPLOYMENT = 50;

// Rate limiter: 10 writes per minute per deployment
const secretWriteRates = new Map<string, { count: number; resetAt: number }>();

function checkSecretRateLimit(deploymentId: string): boolean {
  const now = Date.now();
  const entry = secretWriteRates.get(deploymentId);
  if (!entry || now > entry.resetAt) {
    secretWriteRates.set(deploymentId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

// POST /api/pod/secrets — Store a secret from inside the pod
podApiRouter.post("/secrets", async (req: Request, res: Response) => {
  const deploymentId = (req as any).podDeploymentId as string;

  if (!checkSecretRateLimit(deploymentId)) {
    res.status(429).json({ error: "Rate limit exceeded. Max 10 secret writes per minute." });
    return;
  }

  try {
    const { key, value } = req.body;

    if (!key || typeof key !== "string") {
      res.status(400).json({ error: "Missing or invalid 'key'" });
      return;
    }
    if (!value || typeof value !== "string") {
      res.status(400).json({ error: "Missing or invalid 'value'" });
      return;
    }
    if (value.length > 10240) {
      res.status(400).json({ error: "Value too large (max 10KB)" });
      return;
    }
    if (!SECRET_KEY_REGEX.test(key)) {
      res.status(400).json({ error: `Invalid key format. Must match ${SECRET_KEY_REGEX}` });
      return;
    }
    if (RESERVED_ENV_VARS.has(key)) {
      res.status(400).json({ error: `"${key}" is a reserved environment variable` });
      return;
    }

    const encrypted = encryptApiKey(value);

    const existing = await db.query.deploymentSecrets.findFirst({
      where: and(
        eq(tables.deploymentSecrets.deploymentId, deploymentId),
        eq(tables.deploymentSecrets.key, key),
      ),
    });

    if (existing) {
      await db.update(tables.deploymentSecrets)
        .set({ value: encrypted, source: "agent", updatedAt: dbDate() })
        .where(eq(tables.deploymentSecrets.id, existing.id));
    } else {
      // Check count limit
      const count = await db.query.deploymentSecrets.findMany({
        where: eq(tables.deploymentSecrets.deploymentId, deploymentId),
      });
      if (count.length >= MAX_SECRETS_PER_DEPLOYMENT) {
        res.status(400).json({ error: `Maximum of ${MAX_SECRETS_PER_DEPLOYMENT} secrets reached` });
        return;
      }
      await db.insert(tables.deploymentSecrets).values({
        id: nanoid(12),
        deploymentId,
        key,
        value: encrypted,
        source: "agent",
      });
    }

    logger.info({ deploymentId, key, source: "agent" }, "Pod API: secret stored");

    safeFireAndForget(syncConfigsToPvc(deploymentId), {
      operation: "syncConfigsToPvc",
      deploymentId,
    });

    res.json({ success: true, key });
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: secret store failed");
    res.status(500).json({ error: "Failed to store secret" });
  }
});

// GET /api/pod/secrets — List secret keys (no values) for this deployment
podApiRouter.get("/secrets", async (req: Request, res: Response) => {
  const deploymentId = (req as any).podDeploymentId as string;

  try {
    const secrets = await db.query.deploymentSecrets.findMany({
      where: eq(tables.deploymentSecrets.deploymentId, deploymentId),
    });

    res.json({
      secrets: secrets.map((s) => ({
        key: s.key,
        source: s.source,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      })),
    });
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: secret list failed");
    res.status(500).json({ error: "Failed to list secrets" });
  }
});

// DELETE /api/pod/secrets/:key — Delete a secret from inside the pod
podApiRouter.delete("/secrets/:key", async (req: Request, res: Response) => {
  const deploymentId = (req as any).podDeploymentId as string;
  const key = req.params.key;

  try {
    await db.delete(tables.deploymentSecrets)
      .where(and(
        eq(tables.deploymentSecrets.deploymentId, deploymentId),
        eq(tables.deploymentSecrets.key, key),
      ));

    logger.info({ deploymentId, key, source: "agent" }, "Pod API: secret deleted");

    safeFireAndForget(syncConfigsToPvc(deploymentId), {
      operation: "syncConfigsToPvc",
      deploymentId,
    });

    res.json({ success: true });
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: secret delete failed");
    res.status(500).json({ error: "Failed to delete secret" });
  }
});

// ── Platform Bridge Routes ──────────────────────────────────────────────────
// Called by the MCP server inside bot pods to make bot actions visible on the platform.

// POST /api/pod/platform/register-agent — Register a subagent created by the bot
podApiRouter.post("/platform/register-agent", async (req: Request, res: Response) => {
  const deploymentId = (req as any).podDeploymentId as string;

  try {
    const { name, slug, description, model, systemPrompt } = req.body;

    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Missing or invalid 'name'" });
      return;
    }
    if (!slug || typeof slug !== "string") {
      res.status(400).json({ error: "Missing or invalid 'slug'" });
      return;
    }
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(slug)) {
      res.status(400).json({
        error: "Invalid slug: must start with a lowercase letter, contain only lowercase letters, digits, and hyphens, max 64 chars",
      });
      return;
    }

    const now = dbDate();

    // Upsert: update if slug already exists for this deployment, otherwise insert
    const existing = await db.query.deploymentSubagents.findFirst({
      where: and(
        eq(tables.deploymentSubagents.deploymentId, deploymentId),
        eq(tables.deploymentSubagents.slug, slug),
      ),
    });

    let agentId: string;

    if (existing) {
      agentId = existing.id;
      await db.update(tables.deploymentSubagents)
        .set({
          name,
          description: description || existing.description,
          systemPrompt: systemPrompt || existing.systemPrompt,
          model: model || existing.model,
          source: "delegation",
          updatedAt: now,
        })
        .where(eq(tables.deploymentSubagents.id, agentId));

      logger.info({ deploymentId, agentId, slug }, "Pod API: subagent updated");
    } else {
      agentId = `sa_${nanoid(12)}`;
      await db.insert(tables.deploymentSubagents).values({
        id: agentId,
        deploymentId,
        name,
        slug,
        description: description || null,
        systemPrompt: systemPrompt || "",
        model: model || null,
        triggerType: "manual",
        source: "delegation",
        enabled: true,
        sortOrder: 0,
        createdAt: now,
        updatedAt: now,
      });

      logger.info({ deploymentId, agentId, slug }, "Pod API: subagent registered");
    }

    res.json({ success: true, agentId });
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: register-agent failed");
    res.status(500).json({ error: "Failed to register agent", details: String(err) });
  }
});

// GET /api/pod/platform/team — Return the bot's team members (flow membership)
podApiRouter.get("/platform/team", async (req: Request, res: Response) => {
  const deploymentId = (req as any).podDeploymentId as string;

  try {
    // Find all flows this deployment belongs to
    const memberships = await db.query.flowDeploymentMemberships.findMany({
      where: eq(tables.flowDeploymentMemberships.deploymentId, deploymentId),
    });

    if (memberships.length === 0) {
      res.json({
        teamName: null,
        role: null,
        members: [],
        edges: [],
      });
      return;
    }

    // Use the first flow membership (a deployment may be in multiple flows;
    // the primary team is the first one found)
    const membership = memberships[0];

    const flow = await db.query.orchestrationFlows.findFirst({
      where: eq(tables.orchestrationFlows.id, membership.flowId),
    });

    if (!flow) {
      res.json({ teamName: null, role: null, members: [], edges: [] });
      return;
    }

    // Parse the flow definition to extract nodes and edges
    let definition: { nodes?: any[]; edges?: any[] };
    try {
      definition = JSON.parse(flow.definition);
    } catch {
      definition = { nodes: [], edges: [] };
    }

    const nodes = definition.nodes || [];
    const edges = definition.edges || [];

    // Get all deployment memberships for this flow to map nodeId -> deployment info
    const allMemberships = await db.query.flowDeploymentMemberships.findMany({
      where: eq(tables.flowDeploymentMemberships.flowId, flow.id),
    });

    // Build a map of deploymentId -> deployment for batch lookup
    const deploymentIds = [...new Set(allMemberships.map((m) => m.deploymentId))];
    const deploymentRows = await Promise.all(
      deploymentIds.map((id) =>
        db.query.deployments.findFirst({
          where: eq(tables.deployments.id, id),
        }),
      ),
    );
    const deploymentMap = new Map(
      deploymentRows.filter(Boolean).map((d: any) => [d.id, d]),
    );

    // Build a map of nodeId -> membership for role lookup
    const nodeToMembership = new Map(
      allMemberships.map((m) => [m.nodeId, m]),
    );

    // Build the members list from flow nodes
    const members = nodes
      .filter((n: any) => n.type === "deployment" && n.data?.deploymentId)
      .map((n: any) => {
        const dep = deploymentMap.get(n.data.deploymentId);
        const mem = nodeToMembership.get(n.id);
        return {
          name: dep ? (dep as any).name : n.data.label || n.id,
          deploymentId: n.data.deploymentId,
          role: mem?.role || n.data.role || null,
          status: dep ? (dep as any).status : "unknown",
        };
      });

    // Build the edges list
    const edgeList = edges.map((e: any) => ({
      from: e.source,
      to: e.target,
      type: e.type || e.data?.type || "default",
    }));

    res.json({
      teamName: flow.name,
      role: membership.role || null,
      members,
      edges: edgeList,
    });
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: team lookup failed");
    res.status(500).json({ error: "Failed to get team info", details: String(err) });
  }
});

// POST /api/pod/platform/log-action — Log a bot action visible in Debug Traces
podApiRouter.post("/platform/log-action", async (req: Request, res: Response) => {
  const deploymentId = (req as any).podDeploymentId as string;

  try {
    const { action, details, status } = req.body;

    if (!action || typeof action !== "string") {
      res.status(400).json({ error: "Missing or invalid 'action'" });
      return;
    }

    const now = Date.now();
    const id = `acl_${nanoid(12)}`;

    await db.insert(tables.agentCalls).values({
      id,
      callerDeploymentId: deploymentId,
      calleeDeploymentId: deploymentId,  // self-action
      skillName: action,
      kind: "bot_action",
      status: status || "completed",
      requestBody: details ? (typeof details === "string" ? details : JSON.stringify(details)) : null,
      creditsCharged: 0,
      startMs: now,
      endMs: now,
      durationMs: 0,
      createdAt: dbDate(),
    });

    logger.info({ deploymentId, action }, "Pod API: bot action logged");
    res.json({ success: true });
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: log-action failed");
    res.status(500).json({ error: "Failed to log action", details: String(err) });
  }
});
