#!/usr/bin/env node
/**
 * Nightly QA Orchestrator
 *
 * Runs 25 persona-based test suites against the deployed Jarble platform.
 * Captures screenshots, console logs, network errors, and performance metrics.
 * Generates an HTML report at scripts/nightly-qa/reports/YYYY-MM-DD.html
 *
 * Usage:
 *   node scripts/nightly-qa/orchestrator.mjs [options]
 *
 * Options:
 *   --base-url <url>     Frontend URL (default: http://localhost:3000)
 *   --api-url <url>      API URL (default: derived from base-url, port 3001)
 *   --personas <ids>     Comma-separated persona numbers to run (default: all)
 *   --parallel <n>       Number of personas to run concurrently (default: 1)
 *   --timeout <ms>       Per-persona timeout in ms (default: 120000)
 *   --verbose            Print detailed step output
 */

import { existsSync, mkdirSync, readFileSync } from "fs";
import { resolve, dirname, join } from "path";
import { fileURLToPath } from "url";
import { generateReport } from "./lib/reporter.mjs";
import { PersonaRegistry } from "./lib/types.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env file for auth tokens (gitignored)
const envPath = join(__dirname, ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (!process.env[key]) process.env[key] = value;
    }
  }
}

// --- Parse CLI args ---
function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}
function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

const BASE_URL = getArg("base-url", process.env.QA_BASE_URL || "http://localhost:3000");
const API_URL = getArg("api-url", process.env.QA_API_URL || BASE_URL.replace(":3000", ":3001"));
const AUTH_TOKEN = process.env.QA_AUTH_TOKEN || null;
const ANTHROPIC_KEY = process.env.QA_ANTHROPIC_KEY || null;
const PARALLEL = parseInt(getArg("parallel", "1"), 10);
const TIMEOUT = parseInt(getArg("timeout", "120000"), 10);
const VERBOSE = hasFlag("verbose");

// Parse --personas 1,2,3 filter
const personaFilter = getArg("personas", null);
const selectedPersonas = personaFilter
  ? personaFilter.split(",").map((n) => parseInt(n.trim(), 10))
  : null;

// All persona module paths
const ALL_PERSONAS = [
  { num: 1,  file: "./personas/01-new-developer.mjs" },
  { num: 2,  file: "./personas/02-business-user.mjs" },
  { num: 3,  file: "./personas/03-power-user.mjs" },
  { num: 4,  file: "./personas/04-mobile-user.mjs" },
  { num: 5,  file: "./personas/05-stress-tester.mjs" },
  { num: 6,  file: "./personas/06-accessibility.mjs" },
  { num: 7,  file: "./personas/07-international.mjs" },
  { num: 8,  file: "./personas/08-billing-user.mjs" },
  { num: 9,  file: "./personas/09-marketplace-creator.mjs" },
  { num: 10, file: "./personas/10-flow-builder.mjs" },
  { num: 11, file: "./personas/11-multi-deploy.mjs" },
  { num: 12, file: "./personas/12-api-consumer.mjs" },
  { num: 13, file: "./personas/13-admin-panel.mjs" },
  { num: 14, file: "./personas/14-deployment-config.mjs" },
  { num: 15, file: "./personas/15-theme-tester.mjs" },
  { num: 16, file: "./personas/16-file-knowledge.mjs" },
  { num: 17, file: "./personas/17-conversation-manager.mjs" },
  { num: 18, file: "./personas/18-component-gallery.mjs" },
  { num: 19, file: "./personas/19-deployment-creator.mjs" },
  { num: 20, file: "./personas/20-chat-tester.mjs" },
  { num: 21, file: "./personas/21-file-uploader.mjs" },
  { num: 22, file: "./personas/22-flow-runner.mjs" },
  { num: 23, file: "./personas/23-config-editor.mjs" },
  { num: 24, file: "./personas/24-canvas-interactor.mjs" },
  { num: 25, file: "./personas/25-chaos-monkey.mjs" },
  { num: 26, file: "./personas/26-visual-regression.mjs" },
];

const PERSONAS = selectedPersonas
  ? ALL_PERSONAS.filter((p) => selectedPersonas.includes(p.num))
  : ALL_PERSONAS;

/**
 * Run a single persona with a timeout wrapper.
 */
async function runWithTimeout(personaPath, config, timeoutMs) {
  return Promise.race([
    (async () => {
      const { default: runPersona } = await import(personaPath);
      return await runPersona(config);
    })(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Persona timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);
}

/**
 * Run personas in batches of `batchSize`.
 */
async function runInBatches(personas, config, batchSize) {
  const results = [];
  for (let i = 0; i < personas.length; i += batchSize) {
    const batch = personas.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map((p) => runWithTimeout(p.file, config, TIMEOUT))
    );
    for (let j = 0; j < batch.length; j++) {
      const br = batchResults[j];
      if (br.status === "fulfilled") {
        results.push(br.value);
      } else {
        const name = PersonaRegistry[batch[j].num - 1]?.name || batch[j].file;
        console.error(`  [CRASH] ${name}: ${br.reason?.message || br.reason}`);
        results.push({
          persona: name,
          steps: [],
          error: br.reason?.message || String(br.reason),
        });
      }
    }
  }
  return results;
}

async function main() {
  const reportDir = resolve(__dirname, "reports");
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });

  const date = new Date().toISOString().slice(0, 10);
  const startTime = Date.now();

  console.log(`\n  Jarble Nightly QA`);
  console.log(`  ${"=".repeat(50)}`);
  console.log(`  Date:      ${date}`);
  console.log(`  Frontend:  ${BASE_URL}`);
  console.log(`  API:       ${API_URL}`);
  console.log(`  Personas:  ${PERSONAS.length} of ${ALL_PERSONAS.length}`);
  console.log(`  Parallel:  ${PARALLEL}`);
  console.log(`  Timeout:   ${TIMEOUT}ms per persona`);
  console.log(`  ${"=".repeat(50)}\n`);

  const config = { baseUrl: BASE_URL, apiUrl: API_URL, verbose: VERBOSE, authToken: AUTH_TOKEN, anthropicKey: ANTHROPIC_KEY };
  const results = await runInBatches(PERSONAS, config, PARALLEL);

  // Print summary
  let totalPass = 0;
  let totalFail = 0;
  let totalWarn = 0;

  console.log(`\n  Results:`);
  console.log(`  ${"-".repeat(50)}`);
  for (const r of results) {
    const pass = (r.steps || []).filter((s) => s.status === "pass").length;
    const fail = (r.steps || []).filter((s) => s.status === "fail").length;
    const warn = (r.steps || []).filter((s) => s.status === "warn").length;
    totalPass += pass;
    totalFail += fail;
    totalWarn += warn;
    const statusIcon = r.error ? "!!" : fail > 0 ? "XX" : warn > 0 ? "!!" : "OK";
    console.log(`  [${statusIcon}] ${(r.persona || "Unknown").padEnd(24)} ${String(pass).padStart(2)} pass  ${String(fail).padStart(2)} fail  ${String(warn).padStart(2)} warn`);
  }
  console.log(`  ${"-".repeat(50)}`);
  console.log(`  TOTAL: ${totalPass} pass, ${totalFail} fail, ${totalWarn} warn`);

  // Generate HTML report
  const reportPath = await generateReport(results, date, reportDir);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`\n  Report: ${reportPath}`);
  console.log(`  Duration: ${elapsed}s`);
  console.log(`  ${"=".repeat(50)}\n`);

  // Exit with error code if any failures
  if (totalFail > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error("Orchestrator fatal error:", err);
  process.exitCode = 2;
});
