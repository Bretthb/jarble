/**
 * OpenClaw in-pod diagnostic probes (JAR-99 LOW #3).
 *
 * Extracted from routes/diagnose.ts so runtime-specific CLI assumptions
 * live alongside the rest of the OpenClaw handler. The `/diagnose` route
 * now dispatches to `handler.runDiagnostics?.(ctx)` for this output.
 *
 * All probes run in a single exec call so one exec round-trip covers the
 * full suite. Section boundaries are `===TAG===` markers the parser uses
 * to slice the combined stdout back into per-check fragments.
 */

import { execInPod } from "../../k8s/index.js";
import { getContainerName, getContainerHome, type ManagedBy } from "../../k8s/constants.js";
import { createModuleLogger } from "../../utils/logger.js";
import type { RuntimeDiagnosticCheck } from "../types.js";

const log = createModuleLogger("runtime:openclaw:diagnostics");

/** withTimeout wrapper duplicated here so this file has no cross-route deps. */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs),
    ),
  ]);
}

export interface OpenClawDiagnosticsResult {
  checks: RuntimeDiagnosticCheck[];
  /** True when the HTTP health path or process-based fallback reports the gateway is down. The /diagnose route reads this to decide whether to trigger auto-remediation. */
  gatewayDown: boolean;
  /** Parsed pod-side model string (e.g. "claude-sonnet-4-20250514") — surfaced so the route can compare to the DB's llmModel. */
  podModel: string | null;
}

/**
 * Run OpenClaw's in-pod probes and return parsed checks + a gatewayDown
 * flag + the pod-reported model. Never throws — fatal conditions become
 * `status: "error"` entries.
 */
export async function runOpenClawDiagnostics(ctx: {
  podName: string;
  managedBy: ManagedBy;
}): Promise<OpenClawDiagnosticsResult> {
  const { podName, managedBy } = ctx;
  const checks: RuntimeDiagnosticCheck[] = [];
  const containerName = getContainerName(managedBy);
  const home = getContainerHome(managedBy);
  const pvcMount = managedBy === "operator" ? `${home}/.openclaw` : "/data";

  // Single-exec probe script. Section markers let the parser slice out
  // each probe's output without N separate round-trips.
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

  let raw: string;
  try {
    raw = await withTimeout(
      execInPod(podName, ["sh", "-c", script], containerName, 30_000),
      35_000,
    );
  } catch (err) {
    log.warn({ podName, err: err instanceof Error ? err.message : err },
      "runOpenClawDiagnostics: exec failed");
    return {
      checks: [{
        name: "In-Pod Diagnostics",
        status: "error",
        detail: `Diagnostics exec failed: ${err instanceof Error ? err.message : String(err)}`,
      }],
      gatewayDown: true,
      podModel: null,
    };
  }

  // Parse sections
  const section = (tag: string) => {
    const start = raw.indexOf(`===${tag}===`);
    const end = raw.indexOf("===", start + tag.length + 6);
    if (start === -1) return "";
    return raw.slice(start + tag.length + 6, end === -1 ? undefined : end).trim();
  };

  // HTTP health check - authoritative gateway liveness signal
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
      detail: "curl not available in container - falling back to process detection",
    });
  } else {
    checks.push({
      name: "Gateway HTTP",
      status: "error",
      detail: `Gateway HTTP check returned ${httpHealth}`,
    });
  }

  // Process list - informational only (not used for restart decisions)
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
    const hasProcess = proc && proc !== "NO_PS" && /node|openclaw|gateway/i.test(proc);
    gatewayDown = !hasProcess;
  } else {
    gatewayDown = true;
  }

  // Config
  let podModel: string | null = null;
  const config = section("CONFIG");
  if (config === "NO_CONFIG" || !config) {
    checks.push({
      name: "OpenClaw Config",
      status: "error",
      detail: "openclaw.json not found on pod",
      suggestion: "Config sync may have failed - restart will re-init",
    });
  } else {
    try {
      const parsed = JSON.parse(config);
      podModel = parsed.agents?.defaults?.model?.primary || parsed.agent?.model || null;
      checks.push({
        name: "OpenClaw Config",
        status: "ok",
        detail: `Pod model: ${podModel ?? "not set"}`,
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
    const cleanHelp = help.replace(/\x1b\[[0-9;]*m/g, "");
    checks.push({ name: "OpenClaw CLI", status: "ok", detail: cleanHelp.slice(0, 500) });
  }

  // OpenClaw doctor (full output - strip ASCII art banner)
  const doctor = section("DOCTOR");
  if (doctor && doctor !== "NO_DOCTOR") {
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

  return { checks, gatewayDown, podModel };
}
