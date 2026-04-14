import { Router, Request, Response, NextFunction } from "express";
import { timingSafeEqual } from "crypto";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, tables, dbDate } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { syncConfigsToPvc } from "../services/configSync.js";
import { safeFireAndForget } from "../utils/safeAsync.js";
import { validateThemeConfig } from "@jarble/component-manifest";
import { encryptApiKey, decryptApiKey } from "../utils/encryption.js";
import { RESERVED_ENV_VARS } from "../trpc/routers/deploymentSecrets.js";
import { env } from "../utils/env.js";

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
  } else if (env.NODE_ENV === "production") {
    // Production must have K8s available. Never accept an unverified token.
    logger.error({ deploymentId }, "Pod API: K8s client unavailable in production; rejecting request");
    res.status(503).json({ error: "K8s client unavailable; cannot verify gateway token" });
    return;
  }
  // In non-production dev mode, deployment existence check above is sufficient

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
