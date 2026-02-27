/**
 * Diagnostic endpoint — runs health checks for a deployment.
 *
 * GET /api/deployments/:id/diagnose
 * Requires Bearer JWT auth + deployment ownership.
 */
import { Router } from "express";
import { eq } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { logger } from "../utils/logger.js";
import {
  getDeploymentPodStatus,
  getDeploymentStorageUsage,
  getPodAddress,
} from "../k8s/index.js";

export const diagnoseRouter = Router();

interface DiagnosticCheck {
  name: string;
  status: "ok" | "warning" | "error" | "skipped";
  detail: string;
  suggestion?: string;
}

interface DiagnosticResult {
  deploymentId: string;
  timestamp: string;
  overallHealth: "healthy" | "degraded" | "unhealthy";
  checks: DiagnosticCheck[];
}

/** Wrap a promise with a per-check timeout */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Check timed out")), ms)
    ),
  ]);
}

diagnoseRouter.get("/:id/diagnose", async (req, res) => {
  // Auth
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  let userId: string;
  try {
    const payload = await verifyToken(token);
    const user = await getUserFromToken(payload);
    if (!user) {
      res.status(401).json({ error: "User not found" });
      return;
    }
    userId = user.id;
  } catch {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const deploymentId = req.params.id;

  // Load deployment + ownership check
  const deployment = await db.query.deployments.findFirst({
    where: eq(tables.deployments.id, deploymentId),
  });

  if (!deployment) {
    res.status(404).json({ error: "Deployment not found" });
    return;
  }

  if (deployment.userId !== userId) {
    res.status(403).json({ error: "Not your deployment" });
    return;
  }

  const CHECK_TIMEOUT = 3000;
  const checks: DiagnosticCheck[] = [];

  // Run checks in parallel
  const [podStatusResult, gatewayResult, storageResult] = await Promise.allSettled([
    withTimeout(getDeploymentPodStatus(deploymentId), CHECK_TIMEOUT),
    withTimeout(getPodAddress(deploymentId), CHECK_TIMEOUT),
    withTimeout(getDeploymentStorageUsage(deploymentId), CHECK_TIMEOUT),
  ]);

  // 1. Pod Status
  if (podStatusResult.status === "fulfilled") {
    const pod = podStatusResult.value;
    if (pod.status === "running") {
      checks.push({
        name: "Pod Status",
        status: "ok",
        detail: `Running (${pod.restarts ?? 0} restarts)`,
      });
    } else if (pod.status === "creating") {
      checks.push({
        name: "Pod Status",
        status: "warning",
        detail: `Creating (phase: ${pod.phase ?? "unknown"})`,
        suggestion: "Wait for the pod to finish starting",
      });
    } else if (pod.status === "not_found") {
      checks.push({
        name: "Pod Status",
        status: "error",
        detail: "No pod found",
        suggestion: "Start the deployment",
      });
    } else {
      checks.push({
        name: "Pod Status",
        status: "error",
        detail: pod.error ?? `Failed (phase: ${pod.phase ?? "unknown"})`,
        suggestion: "Check logs and restart",
      });
    }
  } else {
    checks.push({
      name: "Pod Status",
      status: "error",
      detail: `Check failed: ${podStatusResult.reason?.message ?? "unknown"}`,
    });
  }

  // 2. DB Status Match
  const podRunning = podStatusResult.status === "fulfilled" && podStatusResult.value.status === "running";
  const dbSaysRunning = deployment.status === "running";
  if (dbSaysRunning && podRunning) {
    checks.push({ name: "DB Status Match", status: "ok", detail: "DB and pod agree: running" });
  } else if (dbSaysRunning && !podRunning) {
    checks.push({
      name: "DB Status Match",
      status: "warning",
      detail: `DB says "running" but pod is ${podStatusResult.status === "fulfilled" ? podStatusResult.value.status : "unknown"}`,
      suggestion: "Status may be stale — try restarting",
    });
  } else if (!dbSaysRunning && podRunning) {
    checks.push({
      name: "DB Status Match",
      status: "warning",
      detail: `DB says "${deployment.status}" but pod is running`,
      suggestion: "Status desync — pod may recover on its own",
    });
  } else {
    checks.push({
      name: "DB Status Match",
      status: dbSaysRunning ? "warning" : "ok",
      detail: `DB status: ${deployment.status}`,
    });
  }

  // 3. Gateway Address
  if (gatewayResult.status === "fulfilled") {
    if (gatewayResult.value) {
      checks.push({
        name: "Gateway",
        status: "ok",
        detail: "Reachable",
      });
    } else {
      checks.push({
        name: "Gateway",
        status: "error",
        detail: "Address not resolvable",
        suggestion: "Pod may not be running or ready",
      });
    }
  } else {
    checks.push({
      name: "Gateway",
      status: "error",
      detail: `Check failed: ${gatewayResult.reason?.message ?? "unknown"}`,
    });
  }

  // 4. Storage Usage (skip if pod not running)
  if (!podRunning) {
    checks.push({ name: "Storage", status: "skipped", detail: "Pod not running" });
  } else if (storageResult.status === "fulfilled") {
    const storage = storageResult.value;
    if (storage) {
      const isHigh = storage.percentUsed > 90;
      checks.push({
        name: "Storage",
        status: isHigh ? "warning" : "ok",
        detail: `${storage.usedGb}/${storage.totalGb} GB (${storage.percentUsed}%)`,
        ...(isHigh ? { suggestion: "Storage is nearly full — clear unused files" } : {}),
      });
    } else {
      checks.push({ name: "Storage", status: "warning", detail: "Could not read storage" });
    }
  } else {
    checks.push({
      name: "Storage",
      status: "warning",
      detail: `Check failed: ${storageResult.reason?.message ?? "unknown"}`,
    });
  }

  // 5. LLM Key Configured
  checks.push({
    name: "LLM Key",
    status: deployment.llmApiKey ? "ok" : "error",
    detail: deployment.llmApiKey ? "Configured" : "Not configured",
    ...(deployment.llmApiKey ? {} : { suggestion: "Add an LLM API key in settings" }),
  });

  // Compute overall health
  const hasError = checks.some((c) => c.status === "error");
  const hasWarning = checks.some((c) => c.status === "warning");
  const overallHealth: DiagnosticResult["overallHealth"] = hasError
    ? "unhealthy"
    : hasWarning
      ? "degraded"
      : "healthy";

  const result: DiagnosticResult = {
    deploymentId,
    timestamp: new Date().toISOString(),
    overallHealth,
    checks,
  };

  logger.info({ deploymentId, overallHealth, checkCount: checks.length }, "Diagnostics ran");
  res.json(result);
});
