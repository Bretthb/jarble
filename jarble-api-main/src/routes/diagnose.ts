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
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("diagnose");
import {
  getDeploymentPodStatus,
  getDeploymentStorageUsage,
  getPodAddress,
  findPodForDeployment,
  execInPod,
  restartDeployment,
} from "../k8s/index.js";
import type { ManagedBy } from "../k8s/constants.js";
import { getContainerName, getContainerHome } from "../k8s/constants.js";

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
    // Auto-fix: DB says failed/creating but pod is running — update DB to match reality
    try {
      await db.update(tables.deployments)
        .set({ status: "running", error: null })
        .where(eq(tables.deployments.id, deployment.id));
      log.info({ deploymentId: deployment.id, oldStatus: deployment.status }, "Auto-fixed status desync: set to running");
      checks.push({
        name: "DB Status Match",
        status: "ok",
        detail: `Fixed: was "${deployment.status}", now "running" (pod confirmed alive)`,
        suggestion: "Status was desynced — automatically corrected",
      });
    } catch (fixErr) {
      log.error({ deploymentId: deployment.id, err: fixErr }, "Failed to auto-fix status desync");
      checks.push({
        name: "DB Status Match",
        status: "warning",
        detail: `DB says "${deployment.status}" but pod is running`,
        suggestion: "Status desync — could not auto-fix",
      });
    }
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

  // 6. OpenClaw In-Pod Diagnostics (exec into pod if running)
  if (podRunning) {
    const managedBy = ((deployment as any).managedBy ?? "legacy") as ManagedBy;
    try {
      const podName = await findPodForDeployment(deploymentId, { managedBy });
      if (podName) {
        const containerName = getContainerName(managedBy);
        const home = getContainerHome(managedBy);
        const pvcMount = managedBy === "operator" ? `${home}/.openclaw` : "/data";

        // Run OpenClaw CLI diagnostics + system checks in a single exec.
        // The HTTP health check is authoritative — process/port checks are informational only.
        const script = [
          `echo "===HTTP_HEALTH==="`,
          `curl -s -o /dev/null -w "%{http_code}" http://localhost:18789/ 2>/dev/null || echo "CURL_FAILED"`,
          `echo "===PROCESS==="`,
          `ps aux 2>/dev/null | head -20 || echo "NO_PS"`,
          `echo "===VERSION==="`,
          `cat /opt/openclaw/package.json 2>/dev/null || echo "NO_VERSION"`,
          `echo "===CONFIG==="`,
          `cat ${home}/.openclaw/openclaw.json 2>/dev/null || echo "NO_CONFIG"`,
          `echo "===PID==="`,
          `cat ${pvcMount}/.openclaw.pid 2>/dev/null || echo "NO_PID"`,
          `echo "===HELP==="`,
          `npx openclaw --help 2>&1 | head -30 || echo "NO_HELP"`,
          `echo "===DOCTOR==="`,
          `npx openclaw doctor 2>&1 || echo "NO_DOCTOR"`,
          `echo "===DONE==="`,
        ].join(" && ");

        const raw = await withTimeout(
          execInPod(podName, ["sh", "-c", script], containerName, 30_000),
          35_000,
        );

        // Parse sections
        const section = (tag: string) => {
          const start = raw.indexOf(`===${tag}===`);
          const end = raw.indexOf("===", start + tag.length + 6);
          if (start === -1) return "";
          return raw.slice(start + tag.length + 6, end === -1 ? undefined : end).trim();
        };

        // HTTP health check — authoritative gateway liveness signal
        const httpHealth = section("HTTP_HEALTH");
        const httpOk = httpHealth === "200";
        const curlMissing = httpHealth === "CURL_FAILED" || !httpHealth;
        if (httpOk) {
          checks.push({
            name: "Gateway HTTP",
            status: "ok",
            detail: "Gateway responded HTTP 200 on port 18789",
          });
        } else if (curlMissing) {
          checks.push({
            name: "Gateway HTTP",
            status: "warning",
            detail: "curl not available in container — falling back to process detection",
          });
        } else {
          checks.push({
            name: "Gateway HTTP",
            status: "error",
            detail: `Gateway HTTP check returned ${httpHealth}`,
          });
        }

        // Process list — informational only (not used for restart decisions)
        const proc = section("PROCESS");
        if (proc && proc !== "NO_PS") {
          checks.push({ name: "Process List", status: "ok", detail: proc.split("\n").slice(0, 3).join("; ") });
        } else {
          checks.push({ name: "Process List", status: "warning", detail: "ps not available in container" });
        }

        // OpenClaw version detection
        const versionRaw = section("VERSION");
        if (versionRaw && versionRaw !== "NO_VERSION") {
          try {
            const pkg = JSON.parse(versionRaw);
            checks.push({
              name: "OpenClaw Version",
              status: "ok",
              detail: `${pkg.name ?? "openclaw"}@${pkg.version ?? "unknown"}`,
            });
          } catch {
            checks.push({ name: "OpenClaw Version", status: "warning", detail: "package.json exists but malformed" });
          }
        } else {
          checks.push({ name: "OpenClaw Version", status: "warning", detail: "Version not detected (no /opt/openclaw/package.json)" });
        }

        // Determine gateway liveness for auto-remediation:
        // - If HTTP check succeeded → gateway is alive (regardless of process/port detection)
        // - If curl was missing → fall back to process-based heuristic
        // - If HTTP check failed with a non-200 status → gateway is down
        let gatewayDown: boolean;
        if (httpOk) {
          gatewayDown = false;
        } else if (curlMissing) {
          // Fallback: check if any recognizable process is running
          const hasProcess = proc && proc !== "NO_PS" && /node|openclaw|gateway/i.test(proc);
          gatewayDown = !hasProcess;
        } else {
          // HTTP returned a non-200 code — gateway is down
          gatewayDown = true;
        }

        // Config
        const config = section("CONFIG");
        if (config === "NO_CONFIG" || !config) {
          checks.push({
            name: "OpenClaw Config",
            status: "error",
            detail: "openclaw.json not found on pod",
            suggestion: "Config sync may have failed — restart will re-init",
          });
        } else {
          try {
            const parsed = JSON.parse(config);
            const podModel = parsed.agents?.defaults?.model?.primary || parsed.agent?.model || "not set";
            const dbModel = (deployment as any).llmModel || "not set";
            // Strip provider prefix (e.g., "anthropic/claude-sonnet-4-20250514" → "claude-sonnet-4-20250514")
            const normalizedPodModel = podModel.includes("/") ? podModel.split("/").slice(1).join("/") : podModel;
            const modelMatch = normalizedPodModel === dbModel || podModel === dbModel;
            checks.push({
              name: "OpenClaw Config",
              status: modelMatch ? "ok" : "warning",
              detail: `Pod model: ${podModel}${!modelMatch ? ` (DB: ${dbModel})` : ""}`,
              ...(!modelMatch ? { suggestion: "Model mismatch — restart to apply DB config" } : {}),
            });
          } catch {
            checks.push({ name: "OpenClaw Config", status: "warning", detail: "Config exists but malformed" });
          }
        }

        // Hot reload support
        const pid = section("PID");
        checks.push({
          name: "Hot Reload",
          status: pid && pid !== "NO_PID" ? "ok" : "warning",
          detail: pid && pid !== "NO_PID"
            ? `Supported (PID: ${pid})`
            : "Not supported (old image)",
        });

        // OpenClaw CLI help (discover available commands)
        const help = section("HELP");
        if (help && help !== "NO_HELP") {
          // Strip ANSI codes for clean display
          const cleanHelp = help.replace(/\x1b\[[0-9;]*m/g, "");
          checks.push({ name: "OpenClaw CLI", status: "ok", detail: cleanHelp.slice(0, 500) });
        }

        // OpenClaw doctor (full output — strip ASCII art banner)
        const doctor = section("DOCTOR");
        if (doctor && doctor !== "NO_DOCTOR") {
          // Strip ANSI codes and the ASCII art banner (block chars)
          const cleanDoctor = doctor
            .replace(/\x1b\[[0-9;]*m/g, "")
            .replace(/[▄▀█░▐▌▓▒]+/g, "")
            .replace(/🦞.*🦞/g, "")
            .replace(/OPENCLAW/g, "")
            .replace(/\n{2,}/g, "\n")
            .trim();
          if (cleanDoctor) {
            const hasIssues = /error|fail|critical|unhealthy/i.test(cleanDoctor);
            checks.push({
              name: "OpenClaw Doctor",
              status: hasIssues ? "warning" : "ok",
              detail: cleanDoctor.slice(0, 1000),
            });
          }
        }

        // ── Auto-Remediation ──
        // Only restart if the HTTP health check (or fallback heuristic) says gateway is down.
        // This prevents false-negative restarts when process names or port tools change.
        if (gatewayDown) {
          // Try to restart the gateway via OpenClaw CLI first
          let fixed = false;
          try {
            // Attempt: npx openclaw gateway start (if the CLI supports it)
            const startResult = await withTimeout(
              execInPod(podName, ["sh", "-c", "npx openclaw gateway start 2>&1 || npx openclaw start 2>&1 || echo 'NO_START_CMD'"], containerName, 15_000),
              20_000,
            );
            if (!startResult.includes("NO_START_CMD") && !startResult.includes("error")) {
              checks.push({
                name: "Auto-Fix",
                status: "ok",
                detail: `Attempted gateway restart via OpenClaw CLI: ${startResult.slice(0, 200)}`,
              });
              fixed = true;
            }
          } catch {
            // CLI restart not available
          }

          if (!fixed) {
            // Fallback: full pod restart
            try {
              log.info({ deploymentId }, "diagnose: gateway down, triggering pod restart");
              await restartDeployment(deploymentId, managedBy);
              await db.update(tables.deployments)
                .set({ status: "restarting" })
                .where(eq(tables.deployments.id, deploymentId));

              // Poll for readiness so status doesn't get stuck at "restarting"
              // (status reconciler skips in local dev)
              const pollReady = async () => {
                for (let i = 0; i < 30; i++) {
                  await new Promise(r => setTimeout(r, 2000));
                  try {
                    const podStatus = await getDeploymentPodStatus(deploymentId);
                    if (podStatus.status === "running") {
                      await db.update(tables.deployments)
                        .set({ status: "running", error: null })
                        .where(eq(tables.deployments.id, deploymentId));
                      log.info({ deploymentId, iterations: i + 1 }, "diagnose: pod recovered after restart");
                      return;
                    }
                  } catch { /* keep polling */ }
                }
                // Timeout — mark as failed
                await db.update(tables.deployments)
                  .set({ status: "failed", error: "Pod did not become ready after restart" })
                  .where(eq(tables.deployments.id, deploymentId));
                log.warn({ deploymentId }, "diagnose: pod did not recover after restart (60s)");
              };
              // Fire-and-forget — don't block the response
              pollReady().catch(err => log.warn({ deploymentId, err }, "diagnose: readiness poll failed"));

              checks.push({
                name: "Auto-Fix",
                status: "ok",
                detail: "Gateway was down — triggered pod restart. Should be back in 30-60s.",
              });
            } catch (restartErr) {
              checks.push({
                name: "Auto-Fix",
                status: "error",
                detail: `Tried to restart but failed: ${restartErr instanceof Error ? restartErr.message : String(restartErr)}`,
                suggestion: "Try restarting manually from the config panel",
              });
            }
          }
        }
      }
    } catch (err) {
      checks.push({
        name: "In-Pod Diagnostics",
        status: "warning",
        detail: `Could not exec into pod: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

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

  log.info({ deploymentId, overallHealth, checkCount: checks.length }, "Diagnostics ran");
  res.json(result);
});
