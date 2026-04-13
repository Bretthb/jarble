import { Router } from "express";
import { eq, and, like, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { db, tables, dbDate } from "../db/index.js";
import { logger } from "../utils/logger.js";
import { verifyToken } from "../services/auth.js";
import { syncConfigsToPvc, type ConfigSyncResult } from "../services/configSync.js";
import { safeFireAndForget } from "../utils/safeAsync.js";
import { validateThemeConfig, THEME_PRESET_NAMES } from "@jarble/component-manifest";

/**
 * Debug endpoints - only mounted in development mode.
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
    if (!status || ![
      "creating",
      "provisioning_node",
      "waiting_volume",
      "pulling_image",
      "initializing",
      "running",
      "stopped",
      "failed",
      "restarting",
    ].includes(status)) {
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

// Update OpenClaw version on a deployment's pod
debugRouter.post("/deployment/:id/update-openclaw", async (req, res) => {
  try {
    const { id } = req.params;
    const { version } = req.body || {};
    const target = version || "latest";

    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, id),
    });
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }
    if (deployment.status !== "running") {
      res.status(400).json({ error: `Deployment is ${deployment.status}, not running` });
      return;
    }

    const managedBy = ((deployment as any).managedBy ?? "legacy") as any;
    const { findPodForDeployment, execInPod } = await import("../k8s/index.js");
    const podName = await findPodForDeployment(id, { managedBy });
    if (!podName) {
      res.status(503).json({ error: "No pod found" });
      return;
    }

    // Get current version first
    const { getContainerName } = await import("../k8s/constants.js");
    const containerName = getContainerName(managedBy);
    const currentVersion = await execInPod(podName, ["npx", "openclaw", "--version"], containerName, 10_000).catch(() => "unknown");

    // Run npm install - needs sufficient memory (pods <1GB may OOM)
    // Use --ignore-scripts --no-audit --no-fund to reduce overhead
    const updateCmd = `cd /opt/openclaw && npm install openclaw@${target} --ignore-scripts --no-audit --no-fund 2>&1 | tail -10`;
    let output: string;
    try {
      output = await execInPod(podName, ["sh", "-c", updateCmd], containerName, 120_000);
    } catch (err: any) {
      if (err.message?.includes("137") || err.message?.includes("OOM")) {
        res.status(507).json({
          error: "Out of memory during update",
          suggestion: "Increase pod memory to 1GB+ in deployment config, restart, then retry. Or rebuild the Docker image with the new version.",
          currentVersion: currentVersion.trim(),
        });
        return;
      }
      throw err;
    }

    // Get new version
    const newVersion = await execInPod(podName, ["npx", "openclaw", "--version"], containerName, 10_000).catch(() => "unknown");

    res.json({
      success: true,
      id,
      previousVersion: currentVersion.trim(),
      newVersion: newVersion.trim(),
      target,
      output: output.trim(),
      note: "Restart the deployment to apply the update",
    });
  } catch (err) {
    res.status(500).json({ error: "Update failed", details: String(err) });
  }
});

// Force restart a deployment (dev only - no auth)
debugRouter.post("/deployment/:id/restart", async (req, res) => {
  try {
    const { id } = req.params;
    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, id),
    });
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }
    const { restartDeployment } = await import("../k8s/index.js");
    const managedBy = ((deployment as any).managedBy ?? "legacy") as any;
    await db.update(tables.deployments).set({ status: "restarting" }).where(eq(tables.deployments.id, id));
    restartDeployment(id, managedBy, deployment.userId, {
      name: deployment.name,
      runtime: deployment.runtime,
      image: (deployment as any).image,
    }).then(async () => {
      // Poll for readiness
      const { getDeploymentPodStatus } = await import("../k8s/index.js");
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 2000));
        try {
          const s = await getDeploymentPodStatus(id);
          if (s.status === "running") {
            await db.update(tables.deployments).set({ status: "running", error: null }).where(eq(tables.deployments.id, id));
            return;
          }
        } catch {}
      }
      await db.update(tables.deployments).set({ status: "failed", error: "Pod did not recover" }).where(eq(tables.deployments.id, id));
    }).catch(() => {});
    res.json({ success: true, id, message: "Restart triggered" });
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
    safeFireAndForget(syncConfigsToPvc(id), { operation: "syncConfigsToPvc", deploymentId: id });

    res.json({ success: true, deploymentId: id, message: "Config sync triggered (running in background). Use POST /debug/deployment/:id/sync-config-await for synchronous result." });
  } catch (err) {
    logger.error({ err }, "Debug: configSync failed");
    res.status(500).json({ error: "Config sync failed", details: String(err) });
  }
});

// Trigger configSync for a deployment (synchronous - awaits completion and returns result)
debugRouter.post("/deployment/:id/sync-config-await", async (req, res) => {
  try {
    const { id } = req.params;

    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, id),
    });

    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    logger.info({ deploymentId: id }, "Debug: triggering configSync (awaiting result)");

    const result: ConfigSyncResult = await syncConfigsToPvc(id);

    res.json({ deploymentId: id, ...result });
  } catch (err) {
    logger.error({ err }, "Debug: configSync-await failed");
    res.status(500).json({ error: "Config sync failed", details: String(err) });
  }
});

// ── Update runtime (MCP server hot-push) ──────────────────────────────────────
// Push the latest MCP server to a running pod without restart.
// POST /debug/deployment/:id/update-runtime
debugRouter.post("/deployment/:id/update-runtime", async (req, res) => {
  try {
    const { id } = req.params;
    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, id),
    });
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }
    if (deployment.status !== "running") {
      res.status(400).json({ error: `Deployment is ${deployment.status}, must be running` });
      return;
    }

    const { syncMcpServer } = await import("../services/configSync.js");
    const managedBy = (deployment.managedBy ?? "legacy") as "legacy" | "operator";
    const result = await syncMcpServer(id, managedBy);
    res.json({ success: true, deploymentId: id, ...result });
  } catch (err) {
    logger.error({ err }, "Debug: update-runtime failed");
    res.status(500).json({ error: "Update runtime failed", details: String(err) });
  }
});

// ── Bulk update all running pods ──────────────────────────────────────────────
// POST /debug/update-all-runtimes
debugRouter.post("/update-all-runtimes", async (_req, res) => {
  try {
    const { syncMcpServerToAllRunning } = await import("../services/configSync.js");
    const result = await syncMcpServerToAllRunning();
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error({ err }, "Debug: update-all-runtimes failed");
    res.status(500).json({ error: "Bulk runtime update failed", details: String(err) });
  }
});

// ── Platform skills endpoint ──────────────────────────────────────────────────
// Serves the latest platform skills so pods can fetch them on boot.
// This is the single source of truth - update skills here, redeploy API,
// and pods pick them up on next restart without needing a new container image.

import { getPlatformSkills } from "../skills/platformSkills.js";
import { chatViaGateway, chatViaExec } from "../services/openclawGateway.js";

// ── K8s imports (optional - not available in SQLite dev mode) ────────────────
let k8s: {
  findPodForDeployment: typeof import("../k8s/exec.js").findPodForDeployment;
  execInPod: typeof import("../k8s/exec.js").execInPod;
  getPodAddress: typeof import("../k8s/status.js").getPodAddress;
  getDeploymentLogs: typeof import("../k8s/logs.js").getDeploymentLogs;
} | null = null;

const k8sDebugReady = (async () => {
  try {
    const execMod = await import("../k8s/exec.js");
    const statusMod = await import("../k8s/status.js");
    const logsMod = await import("../k8s/logs.js");
    k8s = {
      findPodForDeployment: execMod.findPodForDeployment,
      execInPod: execMod.execInPod,
      getPodAddress: statusMod.getPodAddress,
      getDeploymentLogs: logsMod.getDeploymentLogs,
    };
  } catch {
    // K8s not available (SQLite dev mode without kubectl)
  }
})();

// ── Chat with a deployment (synchronous, for MCP server) ─────────────────────
debugRouter.post("/deployment/:id/chat", async (req, res) => {
  await k8sDebugReady;
  try {
    const { id } = req.params;
    const { message, sessionKey } = req.body;
    if (!message) {
      res.status(400).json({ error: "Missing required field: message" });
      return;
    }

    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, id),
    });
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }
    if (deployment.status !== "running") {
      res.status(400).json({ error: `Deployment is ${deployment.status}, not running` });
      return;
    }

    const session = sessionKey || `debug-${id}`;
    const managedBy = ((deployment as any).managedBy ?? "legacy") as "legacy" | "operator";

    // Try gateway first, fall back to exec
    const useExecOnly = !k8s;

    if (!useExecOnly && k8s) {
      try {
        const podAddr = await k8s.getPodAddress(id, managedBy);
        if (podAddr) {
          const result = await chatViaGateway(
            { ip: podAddr.ip, port: podAddr.port, gatewayToken: podAddr.gatewayToken, sessionKey: session },
            message,
          );
          res.json({
            text: result.text,
            rawText: result.rawText,
            uiBlocks: result.uiBlocks,
            uiUpdates: result.uiUpdates,
            componentDefs: result.componentDefs,
          });
          return;
        }
      } catch {
        // Fall through to exec
      }
    }

    // Exec fallback
    if (!k8s) {
      res.status(503).json({ error: "K8s not available (running in SQLite dev mode without kubectl)" });
      return;
    }
    const podName = await k8s.findPodForDeployment(id, { requireReady: false, managedBy });
    if (!podName) {
      res.status(503).json({ error: "No pod found for this deployment" });
      return;
    }
    const result = await chatViaExec(podName, session, message);
    res.json({
      text: result.text,
      rawText: result.rawText,
      uiBlocks: result.uiBlocks,
      uiUpdates: result.uiUpdates,
      componentDefs: result.componentDefs,
      suggestions: result.suggestions,
    });
  } catch (err) {
    res.status(500).json({ error: "Chat failed", details: String(err) });
  }
});

// ── Read config files from pod PVC ───────────────────────────────────────────
debugRouter.get("/deployment/:id/config", async (req, res) => {
  await k8sDebugReady;
  try {
    const { id } = req.params;
    const file = req.query.file as string; // optional: specific file path

    if (!k8s) {
      res.status(503).json({ error: "K8s not available" });
      return;
    }

    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, id),
    });
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    const managedBy = ((deployment as any).managedBy ?? "legacy") as "legacy" | "operator";
    const podName = await k8s.findPodForDeployment(id, { requireReady: false, managedBy });
    if (!podName) {
      res.status(503).json({ error: "No pod found for this deployment" });
      return;
    }

    if (file) {
      // Read a specific file
      const safePath = file.replace(/\.\./g, ""); // basic path traversal guard
      const content = await k8s.execInPod(podName, ["cat", `/data/${safePath}`]);
      res.json({ file: safePath, content });
    } else {
      // List config directory + read key files
      const listing = await k8s.execInPod(podName, ["find", "/data/config", "-type", "f"]);
      const files: Record<string, string> = {};

      const keyFiles = ["config/soul.md", "config/openclaw.json", "config/platform-skills.json"];
      for (const f of keyFiles) {
        try {
          files[f] = await k8s.execInPod(podName, ["cat", `/data/${f}`]);
        } catch {
          files[f] = "(not found)";
        }
      }

      // Also list skills and components
      let skillFiles = "";
      let componentFiles = "";
      try { skillFiles = await k8s.execInPod(podName, ["ls", "-la", "/data/skills/"]); } catch { /* empty */ }
      try { componentFiles = await k8s.execInPod(podName, ["ls", "-la", "/data/components/"]); } catch { /* empty */ }

      res.json({
        allConfigFiles: listing.trim().split("\n").filter(Boolean),
        keyFiles: files,
        skillFiles: skillFiles.trim(),
        componentFiles: componentFiles.trim(),
      });
    }
  } catch (err) {
    res.status(500).json({ error: "Config read failed", details: String(err) });
  }
});

// ── Get deployment pod logs (one-shot) ───────────────────────────────────────
debugRouter.get("/deployment/:id/logs", async (req, res) => {
  await k8sDebugReady;
  try {
    const { id } = req.params;
    const tailLines = parseInt(req.query.tail as string) || 100;

    if (!k8s) {
      res.status(503).json({ error: "K8s not available" });
      return;
    }

    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, id),
    });
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    const managedBy = ((deployment as any).managedBy ?? "legacy") as "legacy" | "operator";
    const result = await k8s.getDeploymentLogs(id, tailLines, managedBy);
    res.json({ podName: result.podName, logs: result.logs, lineCount: result.logs.split("\n").length });
  } catch (err) {
    res.status(500).json({ error: "Logs failed", details: String(err) });
  }
});

// Set deployment theme (for testing without a pod)
debugRouter.post("/deployment/:id/theme", async (req, res) => {
  try {
    const { id } = req.params;
    const themeConfig = req.body;

    const error = validateThemeConfig(themeConfig);
    if (error) {
      res.status(400).json({ error });
      return;
    }

    await db.update(tables.deployments)
      .set({ themeConfig: JSON.stringify(themeConfig), updatedAt: dbDate() } as any)
      .where(eq(tables.deployments.id, id));

    res.json({ success: true, message: "Theme updated", presets: THEME_PRESET_NAMES });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// Get deployment theme
debugRouter.get("/deployment/:id/theme", async (req, res) => {
  try {
    const { id } = req.params;
    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, id),
    });
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }
    const themeConfig = (deployment as any).themeConfig;
    res.json({
      themeConfig: themeConfig ? JSON.parse(themeConfig) : null,
      availablePresets: THEME_PRESET_NAMES,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

debugRouter.get("/platform-skills", (_req, res) => {
  const skills = getPlatformSkills();
  res.json({
    version: skills.version,
    updatedAt: skills.updatedAt,
    skills: skills.skills,
  });
});
