import { Router, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, tables, dbDate } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { syncConfigsToPvc } from "../services/configSync.js";
import { safeFireAndForget } from "../utils/safeAsync.js";
import { validateThemeConfig } from "@jarble/component-manifest";
import { encryptApiKey, decryptApiKey } from "../utils/encryption.js";
import { generateSigningSecret } from "../utils/hmac.js";
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

    // Upsert: check if a subagent with this deployment+slug already exists,
    // then insert or update. Uses separate queries instead of ON CONFLICT
    // for compatibility with both Postgres and SQLite test DBs.
    const existing = await db.query.deploymentSubagents.findFirst({
      where: and(
        eq(tables.deploymentSubagents.deploymentId, deploymentId),
        eq(tables.deploymentSubagents.slug, slug),
      ),
    });

    let resolvedId: string;
    if (existing) {
      // Update existing subagent
      await db.update(tables.deploymentSubagents).set({
        name,
        description: description || existing.description,
        systemPrompt: systemPrompt || existing.systemPrompt,
        model: model || existing.model,
        source: "delegation",
        updatedAt: now,
      }).where(eq(tables.deploymentSubagents.id, existing.id));
      resolvedId = existing.id;
    } else {
      // Insert new subagent
      resolvedId = `sa_${nanoid(12)}`;
      await db.insert(tables.deploymentSubagents).values({
        id: resolvedId,
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
    }

    logger.info({ deploymentId, agentId: resolvedId, slug }, "Pod API: subagent upserted");

    // Trigger configSync so subagent-tools.json is written to PVC and the
    // MCP server picks up the new agent_{slug} tool immediately.
    safeFireAndForget(syncConfigsToPvc(deploymentId), {
      operation: "syncConfigsToPvc",
      deploymentId,
    });

    res.json({ success: true, agentId: resolvedId });
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
    const trimmedAction = action.trim().slice(0, 100); // VARCHAR(100) column
    if (!trimmedAction) {
      res.status(400).json({ error: "'action' must not be empty" });
      return;
    }
    // Cap details size to prevent bloating the traces table
    let detailsStr: string | null = null;
    if (details) {
      detailsStr = typeof details === "string" ? details : JSON.stringify(details);
      if (detailsStr.length > 10_000) detailsStr = detailsStr.slice(0, 10_000) + "... [truncated]";
    }

    const now = Date.now();
    const id = `acl_${nanoid(12)}`;

    await db.insert(tables.agentCalls).values({
      id,
      callerDeploymentId: deploymentId,
      calleeDeploymentId: deploymentId,  // self-action
      skillName: trimmedAction,
      kind: "bot_action",
      status: status || "completed",
      requestBody: detailsStr,
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

// ── Marketplace Routes ─────────────────────────────────────────────────────
// Agents can browse, install, uninstall, and publish marketplace items from
// inside their pod. All routes require pod authentication.

function mktId(prefix: string): string {
  return `${prefix}_${nanoid(12)}`;
}

// Resolve creator profile ID for service publishing; falls back to userId
async function resolveCreatorProfileId(userId: string): Promise<string> {
  const profilesTable = (tables as any).creatorProfiles;
  if (!profilesTable) return userId;
  const profile = await (db.query as any).creatorProfiles?.findFirst?.({
    where: eq(profilesTable.userId, userId),
  });
  return profile?.id || userId;
}

// Name format for registered services: lowercase letters, digits, hyphens, max 64 chars
const SERVICE_NAME_REGEX = /^[a-z][a-z0-9-]{0,63}$/;

// GET /api/pod/marketplace/browse — List published marketplace items
podApiRouter.get("/marketplace/browse", async (req: Request, res: Response) => {
  try {
    const type = (req.query.type as string) || "all";
    const q = ((req.query.q as string) || "").toLowerCase();
    const category = (req.query.category as string) || "";
    const rawLimit = parseInt((req.query.limit as string) || "20", 10);
    const limit = Math.min(isNaN(rawLimit) ? 20 : rawLimit, 50);

    const [rawComponents, rawServices] = await Promise.all([
      type !== "service"
        ? ((db.query as any).marketplaceComponents?.findMany?.({
            where: eq((tables as any).marketplaceComponents.status, "published"),
          }) ?? [])
        : Promise.resolve([]),
      type !== "component"
        ? ((db.query as any).marketplaceServices?.findMany?.({
            where: eq((tables as any).marketplaceServices.status, "published"),
          }) ?? [])
        : Promise.resolve([]),
    ]);

    let results: any[] = [
      ...(rawComponents as any[]).map((c: any) => ({ ...c, type: "component" })),
      ...(rawServices as any[]).map((s: any) => ({ ...s, type: "service" })),
    ];

    if (q) {
      results = results.filter((item: any) =>
        (item.name || "").toLowerCase().includes(q) ||
        (item.displayName || "").toLowerCase().includes(q) ||
        (item.description || "").toLowerCase().includes(q),
      );
    }

    if (category) {
      results = results.filter((item: any) => item.category === category);
    }

    results = results.slice(0, limit);

    res.json({ results, count: results.length });
  } catch (err) {
    logger.error({ err }, "Pod API: marketplace browse failed");
    res.status(500).json({ error: "Failed to browse marketplace" });
  }
});

// GET /api/pod/marketplace/item/:id — Get details of a specific marketplace item
podApiRouter.get("/marketplace/item/:id", async (req: Request, res: Response) => {
  const { id } = req.params;

  try {
    const component = await (db.query as any).marketplaceComponents?.findFirst?.({
      where: eq((tables as any).marketplaceComponents.id, id),
    });

    if (component) {
      res.json({ type: "component", item: component });
      return;
    }

    const service = await (db.query as any).marketplaceServices?.findFirst?.({
      where: eq((tables as any).marketplaceServices.id, id),
    });

    if (service) {
      const [components, skills] = await Promise.all([
        (db.query as any).serviceComponents?.findMany?.({
          where: eq((tables as any).serviceComponents.packageId, id),
        }) ?? [],
        (db.query as any).serviceSkills?.findMany?.({
          where: eq((tables as any).serviceSkills.packageId, id),
        }) ?? [],
      ]);
      res.json({ type: "service", item: service, components, skills });
      return;
    }

    res.status(404).json({ error: "Item not found" });
  } catch (err) {
    logger.error({ err, id }, "Pod API: marketplace item lookup failed");
    res.status(500).json({ error: "Failed to get item" });
  }
});

// GET /api/pod/marketplace/installed — List installed items for this deployment
podApiRouter.get("/marketplace/installed", async (req: Request, res: Response) => {
  const deploymentId = (req as any).podDeploymentId as string;

  try {
    const [componentInstalls, serviceInstalls] = await Promise.all([
      (db.query as any).componentInstalls?.findMany?.({
        where: eq((tables as any).componentInstalls.deploymentId, deploymentId),
        with: { component: true },
      }) ?? [],
      (db.query as any).serviceInstalls?.findMany?.({
        where: eq((tables as any).serviceInstalls.deploymentId, deploymentId),
        with: { package: true },
      }) ?? [],
    ]);

    res.json({
      deploymentId,
      components: (componentInstalls as any[]).map((ci: any) => ({
        installId: ci.id,
        componentId: ci.componentId,
        installedAt: ci.installedAt,
        ...(ci.component || {}),
      })),
      services: (serviceInstalls as any[]).map((si: any) => ({
        installId: si.id,
        packageId: si.packageId,
        installedAt: si.installedAt,
        ...(si.package || {}),
      })),
    });
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: marketplace installed failed");
    res.status(500).json({ error: "Failed to get installed items" });
  }
});

// POST /api/pod/marketplace/install — Install a marketplace component or service
podApiRouter.post("/marketplace/install", async (req: Request, res: Response) => {
  const deploymentId = (req as any).podDeploymentId as string;
  const deployment = (req as any).podDeployment;
  const { itemId, type } = req.body;

  if (!itemId) {
    res.status(400).json({ error: "Missing required field: itemId" });
    return;
  }

  try {
    const now = dbDate();

    if (type === "service") {
      // ── Service install ──────────────────────────────────────────────────
      const service = await (db.query as any).marketplaceServices?.findFirst?.({
        where: eq((tables as any).marketplaceServices.id, itemId),
      });
      if (!service) {
        res.status(404).json({ error: "Service not found" });
        return;
      }

      const existingInstall = await (db.query as any).serviceInstalls?.findFirst?.({
        where: and(
          eq((tables as any).serviceInstalls.packageId, itemId),
          eq((tables as any).serviceInstalls.deploymentId, deploymentId),
        ),
      });
      if (existingInstall) {
        res.status(409).json({ error: "Service already installed" });
        return;
      }

      const installId = mktId("pki");

      await db.insert((tables as any).serviceInstalls).values({
        id: installId,
        packageId: itemId,
        deploymentId,
        userId: deployment.userId,
        installedAt: now,
        handshakeStatus: "pending",
      });

      // Install bundled components
      const bundledComponents = await (db.query as any).serviceComponents?.findMany?.({
        where: eq((tables as any).serviceComponents.packageId, itemId),
      }) ?? [];

      for (const sc of (bundledComponents as any[])) {
        const alreadyInstalled = await (db.query as any).componentInstalls?.findFirst?.({
          where: and(
            eq((tables as any).componentInstalls.componentId, sc.componentId),
            eq((tables as any).componentInstalls.deploymentId, deploymentId),
          ),
        });
        if (!alreadyInstalled) {
          const versions = await (db.query as any).componentVersions?.findMany?.({
            where: eq((tables as any).componentVersions.componentId, sc.componentId),
          }) ?? [];
          const latestVersion = (versions as any[])[0] || null;
          await db.insert((tables as any).componentInstalls).values({
            id: mktId("ci"),
            componentId: sc.componentId,
            deploymentId,
            userId: deployment.userId,
            versionId: latestVersion?.id || null,
            installedAt: now,
          });
        }
      }

      // Install bundled skills
      const bundledSkills = await (db.query as any).serviceSkills?.findMany?.({
        where: eq((tables as any).serviceSkills.packageId, itemId),
      }) ?? [];

      for (const ss of (bundledSkills as any[])) {
        const alreadyLinked = await (db.query as any).deploymentSkills?.findFirst?.({
          where: and(
            eq((tables as any).deploymentSkills.skillId, ss.skillId),
            eq((tables as any).deploymentSkills.deploymentId, deploymentId),
          ),
        });
        if (!alreadyLinked) {
          await db.insert((tables as any).deploymentSkills).values({
            id: mktId("dsk"),
            deploymentId,
            skillId: ss.skillId,
            installedAt: now,
          });
        }
      }

      // Generate credentials for remote or platform_managed services
      if ((service as any).hostingModel === "remote" || (service as any).hostingModel === "platform_managed") {
        const signingSecret = generateSigningSecret();
        await db.insert((tables as any).serviceCredentials).values({
          id: mktId("svc_cred"),
          packageId: itemId,
          packageInstallId: installId,
          deploymentId,
          signingSecret: encryptApiKey(signingSecret),
          handshakeStatus: (service as any).hostingModel === "platform_managed" ? "completed" : "pending",
          createdAt: now,
        });
      }

      // Increment totalInstalls
      await db.update((tables as any).marketplaceServices)
        .set({ totalInstalls: sql`${(tables as any).marketplaceServices.totalInstalls} + 1` } as any)
        .where(eq((tables as any).marketplaceServices.id, itemId));

      if (deployment?.status === "running") {
        safeFireAndForget(syncConfigsToPvc(deploymentId), {
          operation: "syncConfigsToPvc",
          deploymentId,
        });
      }

      res.json({ success: true, type: "service", installId });
    } else {
      // ── Component install (default) ─────────────────────────────────────
      const component = await (db.query as any).marketplaceComponents?.findFirst?.({
        where: eq((tables as any).marketplaceComponents.id, itemId),
      });
      if (!component) {
        res.status(404).json({ error: "Component not found" });
        return;
      }

      const existingInstall = await (db.query as any).componentInstalls?.findFirst?.({
        where: and(
          eq((tables as any).componentInstalls.componentId, itemId),
          eq((tables as any).componentInstalls.deploymentId, deploymentId),
        ),
      });
      if (existingInstall) {
        res.status(409).json({ error: "Component already installed" });
        return;
      }

      const installId = mktId("ci");

      const versions = await (db.query as any).componentVersions?.findMany?.({
        where: eq((tables as any).componentVersions.componentId, itemId),
      }) ?? [];
      const latestVersion = (versions as any[])[0] || null;

      await db.insert((tables as any).componentInstalls).values({
        id: installId,
        componentId: itemId,
        deploymentId,
        userId: deployment.userId,
        versionId: latestVersion?.id || null,
        installedAt: now,
      });

      // Increment totalInstalls
      await db.update((tables as any).marketplaceComponents)
        .set({ totalInstalls: sql`${(tables as any).marketplaceComponents.totalInstalls} + 1` } as any)
        .where(eq((tables as any).marketplaceComponents.id, itemId));

      if (deployment?.status === "running") {
        safeFireAndForget(syncConfigsToPvc(deploymentId), {
          operation: "syncConfigsToPvc",
          deploymentId,
        });
      }

      res.json({ success: true, type: "component", installId });
    }
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: marketplace install failed");
    res.status(500).json({ error: "Failed to install item" });
  }
});

// POST /api/pod/marketplace/uninstall — Remove a marketplace component or service
podApiRouter.post("/marketplace/uninstall", async (req: Request, res: Response) => {
  const deploymentId = (req as any).podDeploymentId as string;
  const { itemId, type } = req.body;

  if (!itemId) {
    res.status(400).json({ error: "Missing required field: itemId" });
    return;
  }

  try {
    if (type === "service") {
      const install = await (db.query as any).serviceInstalls?.findFirst?.({
        where: and(
          eq((tables as any).serviceInstalls.packageId, itemId),
          eq((tables as any).serviceInstalls.deploymentId, deploymentId),
        ),
      });
      if (!install) {
        res.status(404).json({ error: "Service not installed" });
        return;
      }

      // Delete credentials then the install record
      await db.delete((tables as any).serviceCredentials)
        .where(and(
          eq((tables as any).serviceCredentials.packageId, itemId),
          eq((tables as any).serviceCredentials.deploymentId, deploymentId),
        ));

      await db.delete((tables as any).serviceInstalls)
        .where(eq((tables as any).serviceInstalls.id, (install as any).id));

      safeFireAndForget(syncConfigsToPvc(deploymentId), {
        operation: "syncConfigsToPvc",
        deploymentId,
      });

      res.json({ success: true, type: "service" });
    } else {
      const install = await (db.query as any).componentInstalls?.findFirst?.({
        where: and(
          eq((tables as any).componentInstalls.componentId, itemId),
          eq((tables as any).componentInstalls.deploymentId, deploymentId),
        ),
      });
      if (!install) {
        res.status(404).json({ error: "Component not installed" });
        return;
      }

      await db.delete((tables as any).componentInstalls)
        .where(eq((tables as any).componentInstalls.id, (install as any).id));

      safeFireAndForget(syncConfigsToPvc(deploymentId), {
        operation: "syncConfigsToPvc",
        deploymentId,
      });

      res.json({ success: true, type: "component" });
    }
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: marketplace uninstall failed");
    res.status(500).json({ error: "Failed to uninstall item" });
  }
});

// POST /api/pod/marketplace/publish-component — Submit a canvas component for review
podApiRouter.post("/marketplace/publish-component", async (req: Request, res: Response) => {
  const deployment = (req as any).podDeployment;
  const deploymentId = (req as any).podDeploymentId as string;
  const { name, displayName, description, tier, category, tags, pricingModel, priceUsdCents } = req.body;

  if (!name || !displayName || !description) {
    res.status(400).json({ error: "Missing required fields: name, displayName, description" });
    return;
  }

  try {
    const id = mktId("cmp");
    const now = dbDate();
    const tagsValue = Array.isArray(tags) ? JSON.stringify(tags) : (tags || null);

    await db.insert((tables as any).marketplaceComponents).values({
      id,
      name,
      displayName,
      description,
      tier: tier || "template",
      category: category || "utility",
      pricingModel: pricingModel || "free",
      priceUsdCents: priceUsdCents ?? 0,
      tags: tagsValue,
      creatorId: deployment.userId,
      status: "submitted",
      totalInstalls: 0,
      createdAt: now,
      updatedAt: now,
    });

    logger.info({ deploymentId, componentId: id, name }, "Pod API: component submitted for review");
    res.json({ success: true, id, status: "submitted" });
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: publish-component failed");
    res.status(500).json({ error: "Failed to publish component" });
  }
});

// POST /api/pod/marketplace/publish-service — Submit a service for review
podApiRouter.post("/marketplace/publish-service", async (req: Request, res: Response) => {
  const deployment = (req as any).podDeployment;
  const deploymentId = (req as any).podDeploymentId as string;
  const { name, displayName, description, hostingModel, pricingModel, priceUsdCents, instructionSnippet, remoteApiEndpoint, category } = req.body;

  if (!name || !displayName) {
    res.status(400).json({ error: "Missing required fields: name, displayName" });
    return;
  }

  try {
    const creatorId = await resolveCreatorProfileId(deployment.userId);
    const id = mktId("pkg");
    const now = dbDate();

    await db.insert((tables as any).marketplaceServices).values({
      id,
      name,
      displayName,
      description: description || null,
      hostingModel: hostingModel || "hosted",
      pricingModel: pricingModel || "free",
      priceUsdCents: priceUsdCents ?? 0,
      instructionSnippet: instructionSnippet || null,
      remoteApiEndpoint: remoteApiEndpoint || null,
      category: category || "utility",
      creatorId,
      status: "submitted",
      totalInstalls: 0,
      createdAt: now,
      updatedAt: now,
    });

    logger.info({ deploymentId, serviceId: id, name }, "Pod API: service submitted for review");
    res.json({ success: true, id, status: "submitted" });
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: publish-service failed");
    res.status(500).json({ error: "Failed to publish service" });
  }
});

// POST /api/pod/marketplace/register-service — Register a platform-managed service (auto-published)
podApiRouter.post("/marketplace/register-service", async (req: Request, res: Response) => {
  const deployment = (req as any).podDeployment;
  const deploymentId = (req as any).podDeploymentId as string;
  const { name, displayName, description, skills, instructionSnippet, category, remoteApiEndpoint } = req.body;

  if (!name || !displayName || !description) {
    res.status(400).json({ error: "Missing required fields: name, displayName, description" });
    return;
  }

  if (!SERVICE_NAME_REGEX.test(name)) {
    res.status(400).json({ error: "Invalid name: must start with a lowercase letter, contain only lowercase letters, digits, and hyphens, max 64 chars" });
    return;
  }

  if (!Array.isArray(skills)) {
    res.status(400).json({ error: "skills must be an array" });
    return;
  }
  if (skills.length === 0) {
    res.status(400).json({ error: "At least one skill is required" });
    return;
  }

  for (const skill of skills) {
    if (!skill.name || !skill.description || !skill.inputSchema) {
      res.status(400).json({ error: `Skill "${skill.name || "unnamed"}" is missing required fields: name, description, inputSchema` });
      return;
    }
    if (skill.mode === "handler" && !skill.handlerCode) {
      res.status(400).json({ error: `Skill "${skill.name}" with mode=handler requires handlerCode` });
      return;
    }
  }

  try {
    const creatorId = await resolveCreatorProfileId(deployment.userId);
    const id = mktId("pkg");
    const now = dbDate();

    const serviceCard = {
      version: "1.0.0",
      creatorDeploymentId: deploymentId,
      auth: { type: "api_key" },
      skills: skills.map((skill: any) => {
        const s: any = {
          name: skill.name,
          description: skill.description,
          inputSchema: skill.inputSchema,
        };
        if (skill.outputSchema !== undefined) s.outputSchema = skill.outputSchema;
        if (skill.handlerCode) {
          s.handlerCode = skill.handlerCode;
          s.executionMode = "handler";
        }
        return s;
      }),
      rateLimits: { requestsPerMinute: 60 },
    };

    await db.insert((tables as any).marketplaceServices).values({
      id,
      name,
      displayName,
      description,
      hostingModel: "platform_managed",
      pricingModel: "free",
      priceUsdCents: 0,
      instructionSnippet: instructionSnippet || null,
      remoteApiEndpoint: remoteApiEndpoint || null,
      category: category || "utility",
      creatorId,
      creatorDeploymentId: deploymentId,
      remoteApiConfig: JSON.stringify(serviceCard),
      status: "published",
      totalInstalls: 0,
      createdAt: now,
      updatedAt: now,
    });

    logger.info({ deploymentId, serviceId: id, name, skillCount: skills.length }, "Pod API: platform-managed service registered");
    res.json({ success: true, id, status: "published", skillCount: skills.length });
  } catch (err) {
    logger.error({ err, deploymentId }, "Pod API: register-service failed");
    res.status(500).json({ error: "Failed to register service" });
  }
});
