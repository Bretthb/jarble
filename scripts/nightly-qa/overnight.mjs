#!/usr/bin/env node
/**
 * Overnight QA Loop
 *
 * Runs QA personas in a continuous loop, generating timestamped reports.
 * Between runs, reads the report and logs a summary.
 *
 * Usage:
 *   node scripts/nightly-qa/overnight.mjs [--interval 30] [--personas 1,5,10,12,25]
 *
 * Default: runs every 30 minutes with a mix of observer + action + chaos personas
 */

import { execSync } from "child_process";
import { readFileSync, existsSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function getArg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  return process.argv[idx + 1] || fallback;
}

const INTERVAL_MIN = parseInt(getArg("interval", "30"), 10);
const PERSONAS = getArg("personas", "1,4,5,7,9,10,12,25");
const NODE = process.execPath;

let runCount = 0;
let totalPass = 0;
let totalFail = 0;
let totalWarn = 0;

function runQA() {
  runCount++;
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-");
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  Overnight QA — Run #${runCount} at ${new Date().toLocaleTimeString()}`);
  console.log(`  Personas: ${PERSONAS}`);
  console.log(`${"=".repeat(60)}\n`);

  try {
    const output = execSync(
      `"${NODE}" "${join(__dirname, "orchestrator.mjs")}" --personas ${PERSONAS} --parallel 1`,
      { encoding: "utf-8", timeout: 10 * 60 * 1000, cwd: join(__dirname, "../..") }
    );
    console.log(output);
  } catch (err) {
    // Exit code 1 means failures found (normal), other codes are crashes
    if (err.stdout) console.log(err.stdout);
    if (err.status > 1) console.error("Orchestrator crashed:", err.message);
  }

  // Read and summarize the report
  const reportPath = join(__dirname, "reports", `${new Date().toISOString().slice(0, 10)}.json`);
  if (existsSync(reportPath)) {
    try {
      const report = JSON.parse(readFileSync(reportPath, "utf-8"));
      const { totalPass: p, totalFail: f, totalWarn: w } = report.summary;
      totalPass += parseInt(p) || 0;
      totalFail += parseInt(f) || 0;
      totalWarn += parseInt(w) || 0;

      console.log(`\n  Run #${runCount} Summary: ${p} pass, ${f} fail, ${w} warn`);
      console.log(`  Cumulative: ${totalPass} pass, ${totalFail} fail, ${totalWarn} warn`);

      // Log failures
      const failures = [];
      for (const persona of report.results) {
        for (const step of persona.steps) {
          if (step.status === "fail") {
            failures.push(`${persona.persona}: ${step.name}`);
          }
        }
      }
      if (failures.length > 0) {
        console.log(`\n  Failures to fix:`);
        failures.forEach(f => console.log(`    ❌ ${f}`));
      }
    } catch (e) {
      console.log("  Could not parse report:", e.message);
    }
  }

  console.log(`\n  Next run in ${INTERVAL_MIN} minutes...`);
}

// Run immediately, then on interval
console.log(`\n🌙 Overnight QA Loop Started`);
console.log(`   Interval: every ${INTERVAL_MIN} minutes`);
console.log(`   Personas: ${PERSONAS}`);
console.log(`   Press Ctrl+C to stop\n`);

runQA();
setInterval(runQA, INTERVAL_MIN * 60 * 1000);
