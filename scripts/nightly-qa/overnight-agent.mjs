#!/usr/bin/env node
/**
 * Agentic Overnight QA Runner
 *
 * Runs Claude Code in headless mode with the qa-orchestrator agent in a continuous loop.
 * Each cycle: health check → auth check → git diff → orchestrator → save report → wait.
 *
 * Usage:
 *   node scripts/nightly-qa/overnight-agent.mjs [options]
 *
 * Options:
 *   --interval <min>       Cycle interval in minutes (default: 45)
 *   --focus <area>         Focus on specific area (e.g., "wizard", "chat", "api")
 *   --max-budget <usd>     Max cost per cycle in USD (default: 50)
 *   --nightly-budget <usd> Max total cost for the entire night (default: 200)
 *   --base-url <url>       Frontend URL (default: http://localhost:3000)
 *   --api-url <url>        API URL (default: http://localhost:3001)
 *   --cycles <n>           Max number of cycles (default: unlimited)
 *   --verbose              Show full Claude output
 */

import { execSync, execFileSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { QALogger } from "./lib/logger.mjs";
import { generateDashboard } from "./lib/dashboard.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../..");
const STATE_FILE = join(__dirname, ".qa-state.json");
const LOCK_FILE = join(__dirname, ".qa-lock");
const REPORTS_DIR = join(__dirname, "reports");
const ENV_FILE = join(__dirname, ".env");

// ── CLI Args ─────────────────────────────────────────────────────────────

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

const INTERVAL_MIN = parseInt(getArg("interval", "45"), 10);
const FOCUS = getArg("focus", "");
const MAX_BUDGET = parseFloat(getArg("max-budget", "50"));
const NIGHTLY_BUDGET = parseFloat(getArg("nightly-budget", "200"));
const BASE_URL = getArg("base-url", "http://localhost:3000");
const API_URL = getArg("api-url", "http://localhost:3001");
const MAX_CYCLES = parseInt(getArg("cycles", "0"), 10); // 0 = unlimited
const VERBOSE = process.argv.includes("--verbose");
const CYCLE_TIMEOUT = parseInt(getArg("timeout", "90"), 10) * 60 * 1000; // default 90 minutes per cycle

// ── State Management ─────────────────────────────────────────────────────

function loadState() {
  if (existsSync(STATE_FILE)) {
    try {
      return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
    } catch {
      return createDefaultState();
    }
  }
  return createDefaultState();
}

function createDefaultState() {
  return {
    lastRunSha: null,
    lastRunTimestamp: null,
    lastRunPassRate: null,
    runCount: 0,
    cumulativePass: 0,
    cumulativeFail: 0,
    cumulativeCost: 0,
  };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Environment ──────────────────────────────────────────────────────────

function loadEnv() {
  if (!existsSync(ENV_FILE)) return {};
  const env = {};
  for (const line of readFileSync(ENV_FILE, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    env[key] = val;
  }
  return env;
}

// ── Auth Token ───────────────────────────────────────────────────────────

const AUTH0_DOMAIN = "jarble-dev.us.auth0.com";
const AUTH0_CLIENT_ID = "1VR30862RmZIFR44UIM8aVHYEt3K2Rsh";
const AUTH0_AUDIENCE = "https://api.jarble.ai";

/**
 * Get a fresh Auth0 token via M2M Client Credentials Grant.
 * Requires QA_M2M_CLIENT_ID and QA_M2M_CLIENT_SECRET in .env.
 * This is the recommended approach — tokens are fetched on demand, no user credentials needed.
 */
async function fetchM2MToken(env) {
  const clientId = env.QA_M2M_CLIENT_ID || process.env.QA_M2M_CLIENT_ID;
  const clientSecret = env.QA_M2M_CLIENT_SECRET || process.env.QA_M2M_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return null;
  }

  try {
    const res = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        audience: AUTH0_AUDIENCE,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`  M2M token fetch failed (${res.status}): ${body}`);
      return null;
    }

    const data = await res.json();
    console.log("  Fresh M2M token obtained from Auth0.");
    return data.access_token;
  } catch (err) {
    console.error(`  M2M token fetch error: ${err.message}`);
    return null;
  }
}

/**
 * Get a fresh Auth0 token via Resource Owner Password Grant.
 * Requires QA_EMAIL and QA_PASSWORD in .env.
 */
async function fetchPasswordToken(env) {
  const email = env.QA_EMAIL || process.env.QA_EMAIL;
  const password = env.QA_PASSWORD || process.env.QA_PASSWORD;

  if (!email || !password) {
    return null;
  }

  try {
    const res = await fetch(`https://${AUTH0_DOMAIN}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "password",
        username: email,
        password: password,
        client_id: AUTH0_CLIENT_ID,
        audience: AUTH0_AUDIENCE,
        scope: "openid profile email offline_access",
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      console.error(`  Password token fetch failed (${res.status}): ${body}`);
      return null;
    }

    const data = await res.json();
    console.log("  Fresh auth token obtained via password grant.");
    return data.access_token;
  } catch (err) {
    console.error(`  Password token fetch error: ${err.message}`);
    return null;
  }
}

async function getAuthToken(env) {
  // Priority 1: Password grant (tests as real user with real data)
  const pwd = await fetchPasswordToken(env);
  if (pwd) return pwd;

  // Priority 2: M2M token (works for API-only testing, but creates empty user)
  const m2m = await fetchM2MToken(env);
  if (m2m) return m2m;

  // Fall back to static token from .env
  const token = env.QA_AUTH_TOKEN || process.env.QA_AUTH_TOKEN;
  if (!token) {
    console.warn("  WARNING: No auth credentials found. Set QA_EMAIL + QA_PASSWORD (recommended) or QA_AUTH_TOKEN in scripts/nightly-qa/.env");
    console.warn("  Auth-required tests will be skipped.");
    return null;
  }

  if (isTokenExpired(token)) {
    console.warn("  WARNING: QA_AUTH_TOKEN is expired. Set QA_EMAIL + QA_PASSWORD for auto-refresh.");
    return null;
  }

  return token;
}

function isTokenExpired(token) {
  if (!token) return true;
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return true;
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
    const exp = payload.exp;
    if (!exp) return false; // No expiry = assume valid
    const now = Math.floor(Date.now() / 1000);
    return now >= exp - 3600; // Expired or expiring within 1 hour
  } catch {
    return true;
  }
}

// ── Health Checks ────────────────────────────────────────────────────────

async function healthCheck(url, name) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok || res.status < 500) {
      return true;
    }
    console.error(`  ${name} returned ${res.status}`);
    return false;
  } catch (err) {
    console.error(`  ${name} is not reachable: ${err.message}`);
    return false;
  }
}

// ── Git Diff ─────────────────────────────────────────────────────────────

function getGitInfo(lastSha) {
  const currentSha = execSync("git rev-parse --short HEAD", { cwd: ROOT, encoding: "utf-8" }).trim();

  let diffStat = "(first run — no diff available)";
  if (lastSha) {
    try {
      diffStat = execSync(`git diff ${lastSha}..HEAD --stat`, { cwd: ROOT, encoding: "utf-8" }).trim();
      if (!diffStat) diffStat = "(no changes since last run)";
    } catch {
      diffStat = "(could not compute diff)";
    }
  }

  return { currentSha, diffStat };
}

// ── Lock File ────────────────────────────────────────────────────────────

function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const lockAge = Date.now() - statSync(LOCK_FILE).mtimeMs;
    if (lockAge < CYCLE_TIMEOUT) {
      console.error("  Another QA cycle is running (lock file exists). Skipping.");
      return false;
    }
    // Stale lock — remove it
    console.warn("  Removing stale lock file.");
    unlinkSync(LOCK_FILE);
  }
  writeFileSync(LOCK_FILE, String(process.pid));
  return true;
}

function releaseLock() {
  try { unlinkSync(LOCK_FILE); } catch {}
}

// ── Report Cleanup ───────────────────────────────────────────────────────

function pruneOldReports() {
  if (!existsSync(REPORTS_DIR)) return;
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000; // 14 days
  let pruned = 0;
  for (const file of readdirSync(REPORTS_DIR)) {
    const filepath = join(REPORTS_DIR, file);
    try {
      if (statSync(filepath).mtimeMs < cutoff) {
        unlinkSync(filepath);
        pruned++;
      }
    } catch {}
  }
  if (pruned > 0) console.log(`  Pruned ${pruned} old report(s).`);
}

// ── Build Orchestrator Prompt ────────────────────────────────────────────

function buildPrompt(context) {
  const { token, email, password, anthropicKey, diffStat, currentSha, focus, lastRun } = context;

  let prompt = `Run a QA cycle for the Jarble platform.

BASE_URL: ${BASE_URL}
API_URL: ${API_URL}
GIT_SHA: ${currentSha}
TIMESTAMP: ${new Date().toISOString()}
`;

  // Auth credentials for browser login
  if (email && password) {
    prompt += `
AUTH CREDENTIALS (for browser-based testing — log in via Auth0 UI):
QA_EMAIL: ${email}
QA_PASSWORD: ${password}
IMPORTANT: Do NOT inject localStorage. Log in through the real Auth0 UI using Playwright MCP.
`;
  }

  // Bearer token for API testing
  if (token) {
    prompt += `\nAUTH_TOKEN (for API testing via curl — use as Bearer token): ${token}\n`;
  }

  if (!email && !token) {
    prompt += `\nNO AUTH AVAILABLE — skip all auth-required test goals.\n`;
  }

  // Anthropic key for deployment creation tests
  if (anthropicKey) {
    prompt += `\nQA_ANTHROPIC_KEY (for deployment wizard — use as LLM provider API key): ${anthropicKey}\n`;
  }

  prompt += `\nGIT CHANGES SINCE LAST RUN:\n${diffStat}\n`;

  if (focus) {
    prompt += `\nFOCUS AREA: ${focus} — prioritize testing this area above all else.\n`;
  }

  if (lastRun) {
    prompt += `\nLAST RUN: ${lastRun.lastRunTimestamp || "never"}`;
    prompt += `\nLAST PASS RATE: ${lastRun.lastRunPassRate != null ? (lastRun.lastRunPassRate * 100).toFixed(0) + "%" : "N/A"}`;
    prompt += `\nCUMULATIVE: ${lastRun.cumulativePass} pass, ${lastRun.cumulativeFail} fail across ${lastRun.runCount} runs\n`;
  }

  prompt += `
CRITICAL OUTPUT REQUIREMENT:
Your FINAL message MUST end with the structured summary block. This is parsed by the runner.
Do NOT use natural language for the summary — use EXACTLY this format:

=== QA CYCLE COMPLETE ===
TIMESTAMP: [ISO timestamp]
GIT SHA: ${currentSha}
DURATION: [total time]

RESULTS:
  Goals tested: [N]
  Passed: [N]
  Failed: [N]
  Warned: [N]
  Skipped: [N]

FAILURES:
  - [goal]: [brief description]

KEY FINDINGS:
  - [important discoveries]
=== END CYCLE ===

If you tested 0 goals, still emit the block with zeros. The runner CANNOT parse your results without this block.
`;

  return prompt;
}

// ── Run Cycle ────────────────────────────────────────────────────────────

async function runCycle(state, env) {
  state.runCount++;
  const cycleId = `cycle-${state.runCount}-${new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-")}`;
  const log = new QALogger(cycleId);

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  QA Cycle #${state.runCount} — ${new Date().toLocaleTimeString()}`);
  if (FOCUS) console.log(`  Focus: ${FOCUS}`);
  console.log(`${"=".repeat(60)}\n`);

  // Health checks
  log.log("INFO", "health", "Checking servers...");
  const [feOk, apiOk] = await Promise.all([
    healthCheck(BASE_URL, "Frontend"),
    healthCheck(`${API_URL}/health`, "API"),
  ]);

  if (!feOk || !apiOk) {
    log.error("health", "Servers not reachable — skipping cycle");
    log.finalize({ total: 0, passed: 0, failed: 0, warned: 0, skipped: 0, status: "SERVERS_DOWN" });
    return;
  }
  log.log("PASS", "health", `Servers OK (Frontend: ${BASE_URL}, API: ${API_URL})`);

  // Auth token
  log.log("INFO", "auth", "Fetching auth token...");
  const token = await getAuthToken(env);
  if (token) {
    log.log("PASS", "auth", "Auth token obtained");
  } else {
    log.log("WARN", "auth", "No auth token — auth-required tests will be skipped");
  }

  // Git info
  const { currentSha, diffStat } = getGitInfo(state.lastRunSha);
  log.log("INFO", "discovery", `Git SHA: ${currentSha}`, { sha: currentSha });
  log.log("INFO", "discovery", `Changes since last run`, { diffStat: diffStat.slice(0, 500) });

  // Lock
  if (!acquireLock()) {
    log.error("lock", "Another cycle is running — skipping");
    log.finalize({ total: 0, passed: 0, failed: 0, warned: 0, skipped: 0, status: "LOCKED" });
    return;
  }

  let summary = { total: 0, passed: 0, failed: 0, warned: 0, skipped: 0 };

  try {
    // Build prompt
    log.log("INFO", "dispatch", "Building orchestrator prompt...");
    const prompt = buildPrompt({
      token,
      email: env.QA_EMAIL || process.env.QA_EMAIL,
      password: env.QA_PASSWORD || process.env.QA_PASSWORD,
      anthropicKey: env.QA_ANTHROPIC_KEY || process.env.QA_ANTHROPIC_KEY,
      diffStat,
      currentSha,
      focus: FOCUS,
      lastRun: state,
    });

    // Invoke Claude Code
    log.agentStart("qa-orchestrator", FOCUS || "full QA cycle");

    const args = [
      "-p", prompt,
      "--agent", "qa-orchestrator",
      "--dangerously-skip-permissions",
      "--model", getArg("model", "sonnet"),
      "--output-format", "text",
    ];

    if (MAX_BUDGET > 0) {
      args.push("--max-budget-usd", String(MAX_BUDGET));
    }

    let output;
    try {
      output = execFileSync("claude", args, {
        cwd: ROOT,
        encoding: "utf-8",
        timeout: CYCLE_TIMEOUT,
        env: { ...process.env, ...env },
        maxBuffer: 50 * 1024 * 1024,
      });
      log.agentEnd("qa-orchestrator", "COMPLETE");
    } catch (err) {
      if (err.killed) {
        log.error("dispatch", `Cycle timed out (${CYCLE_TIMEOUT / 60000} min limit)`, err);
      } else if (err.stdout) {
        output = err.stdout;
        log.log("WARN", "dispatch", "Claude exited with non-zero status");
      } else {
        log.error("dispatch", "Claude invocation failed", err);
        log.finalize(summary);
        return;
      }
    }

    if (output && VERBOSE) {
      console.log(output);
    }

    // Save raw output
    mkdirSync(REPORTS_DIR, { recursive: true });
    const timestamp = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
    const reportPath = join(REPORTS_DIR, `${timestamp}-raw.txt`);
    writeFileSync(reportPath, output || "(no output)");
    log.log("INFO", "report", `Raw output saved: ${reportPath}`);

    // Parse results
    const cycleMatch = output?.match(/=== QA CYCLE COMPLETE ===([\s\S]*?)=== END CYCLE ===/);
    if (cycleMatch) {
      const summaryText = cycleMatch[1];

      const passMatch = summaryText.match(/Passed:\s*(\d+)/);
      const failMatch = summaryText.match(/Failed:\s*(\d+)/);
      const warnMatch = summaryText.match(/Warned:\s*(\d+)/);
      const totalMatch = summaryText.match(/Goals tested:\s*(\d+)/);
      const skipMatch = summaryText.match(/Skipped:\s*(\d+)/);

      summary.passed = passMatch ? parseInt(passMatch[1]) : 0;
      summary.failed = failMatch ? parseInt(failMatch[1]) : 0;
      summary.warned = warnMatch ? parseInt(warnMatch[1]) : 0;
      summary.total = totalMatch ? parseInt(totalMatch[1]) : 0;
      summary.skipped = skipMatch ? parseInt(skipMatch[1]) : 0;

      state.cumulativePass += summary.passed;
      state.cumulativeFail += summary.failed;
      if (summary.total > 0) {
        state.lastRunPassRate = summary.passed / summary.total;
      }

      // Log individual results
      const failureLines = summaryText.match(/^\s*-\s+.+/gm) || [];
      for (const line of failureLines) {
        const trimmed = line.trim().replace(/^-\s*/, "");
        if (trimmed.includes("FAIL") || trimmed.includes("fail")) {
          log.goalResult(trimmed, "FAIL");
        }
      }

      log.log("INFO", "summary", `Goals: ${summary.total} | Pass: ${summary.passed} | Fail: ${summary.failed} | Warn: ${summary.warned} | Skip: ${summary.skipped}`);
    } else {
      log.log("WARN", "summary", "Could not parse structured cycle summary from output");

      // Fallback: count HTTP status checks and pass/fail keywords
      if (output) {
        const httpPasses = (output.match(/\b(200|HTTP\s*200|✓)\b/g) || []).length;
        const httpFails = (output.match(/\b(500|404|403|FAIL|error|Error)\b/gi) || []).length;
        if (httpPasses > 0 || httpFails > 0) {
          summary.passed = httpPasses;
          summary.failed = httpFails;
          summary.total = httpPasses + httpFails;
          state.cumulativePass += summary.passed;
          state.cumulativeFail += summary.failed;
          log.log("INFO", "summary", `Fallback parse — Pass: ${summary.passed} | Fail: ${summary.failed} (from HTTP status codes)`);
        }
      }
    }

    // Update state
    state.lastRunSha = currentSha;
    state.lastRunTimestamp = new Date().toISOString();

    log.log("INFO", "cycle", `Cumulative: ${state.cumulativePass} pass, ${state.cumulativeFail} fail across ${state.runCount} runs`);

  } finally {
    releaseLock();
    const logFile = log.finalize(summary);

    // Generate dashboard after each cycle
    try {
      const dashPath = generateDashboard();
      console.log(`\n  Dashboard: ${dashPath}`);
    } catch (err) {
      console.error(`  Dashboard generation failed: ${err.message}`);
    }
  }
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n  Agentic Overnight QA`);
  console.log(`  ====================`);
  console.log(`  Interval: every ${INTERVAL_MIN} minutes`);
  console.log(`  Budget: $${MAX_BUDGET}/cycle, $${NIGHTLY_BUDGET}/night`);
  console.log(`  Frontend: ${BASE_URL}`);
  console.log(`  API: ${API_URL}`);
  if (FOCUS) console.log(`  Focus: ${FOCUS}`);
  if (MAX_CYCLES) console.log(`  Max cycles: ${MAX_CYCLES}`);
  console.log(`  Press Ctrl+C to stop\n`);

  const env = loadEnv();
  const state = loadState();

  // Prune old reports
  pruneOldReports();

  // Graceful shutdown
  let running = true;
  process.on("SIGINT", () => {
    console.log("\n\n  Shutting down gracefully...");
    running = false;
    releaseLock();
    saveState(state);
    console.log(`  Final stats: ${state.cumulativePass} pass, ${state.cumulativeFail} fail across ${state.runCount} runs.`);
    process.exit(0);
  });
  process.on("exit", () => {
    releaseLock();
    saveState(state);
  });

  // Run loop
  let cyclesRun = 0;
  while (running) {
    // Budget check
    if (state.cumulativeCost >= NIGHTLY_BUDGET) {
      console.log(`\n  Nightly budget ($${NIGHTLY_BUDGET}) reached. Stopping.`);
      break;
    }

    // Cycle limit check
    if (MAX_CYCLES > 0 && cyclesRun >= MAX_CYCLES) {
      console.log(`\n  Max cycles (${MAX_CYCLES}) reached. Stopping.`);
      break;
    }

    await runCycle(state, env);
    saveState(state);
    cyclesRun++;

    if (!running) break;
    if (MAX_CYCLES > 0 && cyclesRun >= MAX_CYCLES) break;

    console.log(`\n  Next cycle in ${INTERVAL_MIN} minutes...`);
    await new Promise(resolve => setTimeout(resolve, INTERVAL_MIN * 60 * 1000));
  }

  console.log("\n  Overnight QA session ended.");
  console.log(`  Total: ${state.cumulativePass} pass, ${state.cumulativeFail} fail across ${state.runCount} runs.\n`);
}

main().catch(err => {
  console.error("Fatal error:", err);
  releaseLock();
  process.exit(1);
});
