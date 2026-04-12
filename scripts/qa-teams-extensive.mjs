#!/usr/bin/env node
/**
 * Extensive QA Test Suite — Agent Teams
 *
 * Runs 4 test teams in dependency order:
 *   Team 1: API Foundation (auth, CRUD, validation)
 *   Team 2: Chat & Artifacts via /d/[id] (parallel with Team 3)
 *   Team 3: Flow Orchestration & Delegation (parallel with Team 2)
 *   Team 4: Cross-cutting Integration (depends on Teams 2+3)
 *
 * Usage:
 *   node scripts/qa-teams-extensive.mjs                    # Run all teams
 *   node scripts/qa-teams-extensive.mjs --team 1           # Run specific team
 *   node scripts/qa-teams-extensive.mjs --verbose          # Verbose output
 *   JARBLE_QA_TOKEN=... node scripts/qa-teams-extensive.mjs
 */
import { getToken, discoverDeployments, saveResults, OUT_DIR } from "./qa-teams-extensive/lib.mjs";

// ── Parse CLI args ──────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const teamFilter = args.includes("--team") ? parseInt(args[args.indexOf("--team") + 1]) : null;
const verbose = args.includes("--verbose");

console.log("╔══════════════════════════════════════════════════════════════╗");
console.log("║         JARBLE QA — Extensive Agent Teams Test Suite        ║");
console.log("╚══════════════════════════════════════════════════════════════╝");
console.log(`API: ${process.env.QA_API_URL || "https://api.jarble.ai"}`);
console.log(`Output: ${OUT_DIR}`);
console.log(`Team filter: ${teamFilter || "all"}`);
console.log();

// ── Auth ────────────────────────────────────────────────────────────────────

const token = getToken();
console.log("✓ Token loaded\n");

// ── Health check ────────────────────────────────────────────────────────────

const { running } = await discoverDeployments(token);
console.log(`Found ${running.length} running deployment(s)`);

// Get current user to filter to owned deployments
const userRes = await (await fetch(`${process.env.QA_API_URL || "https://api.jarble.ai"}/trpc/user.me`, {
  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
})).json();
const currentUserId = userRes?.result?.data?.json?.id;
const owned = currentUserId ? running.filter(d => d.userId === currentUserId) : running;
console.log(`Owned by current user: ${owned.length} deployment(s)`);

if (owned.length === 0) {
  console.error("✗ No owned running deployments. Cannot run tests.");
  process.exit(1);
}
const primaryDeploymentId = owned[0].id;
const primaryDeploymentName = owned[0].name;
console.log(`Primary test deployment: ${primaryDeploymentName} (${primaryDeploymentId})\n`);

// ── Import team modules lazily ──────────────────────────────────────────────

const allResults = [];

async function runTeamSafe(teamNum, importPath, extraArgs = []) {
  if (teamFilter && teamFilter !== teamNum) {
    console.log(`\n── Skipping Team ${teamNum} (filtered) ──\n`);
    return null;
  }
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  TEAM ${teamNum} — Starting...`);
  console.log(`${"═".repeat(60)}\n`);

  try {
    const mod = await import(importPath);
    const fn = mod.default || mod[`runTeam${teamNum}`];
    const result = await fn(token, ...extraArgs);
    allResults.push(result);
    return result;
  } catch (e) {
    console.error(`✗ Team ${teamNum} crashed: ${e.message}`);
    const crashed = {
      teamName: `Team ${teamNum} (CRASHED)`,
      pass: 0, fail: 1, warn: 0, skip: 0, total: 1,
      duration: "0",
      results: [{ name: "team-crash", status: "FAIL", detail: e.message }],
    };
    allResults.push(crashed);
    return crashed;
  }
}

// ── Execute teams in dependency order ───────────────────────────────────────

const startTime = Date.now();

// Phase 1: API Foundation (no deps)
await runTeamSafe(1, "./qa-teams-extensive/team1-api.mjs");

// Phase 2: Chat + Flow in parallel (both depend on Team 1)
const [team2Result, team3Result] = await Promise.all([
  runTeamSafe(2, "./qa-teams-extensive/team2-chat.mjs"),
  runTeamSafe(3, "./qa-teams-extensive/team3-flow.mjs"),
]);

// Phase 3: Cross-cutting integration (depends on Teams 2+3)
const context = {
  deploymentId: primaryDeploymentId,
  flowId: team3Result?.results?.find(r => r.flowId)?.flowId || null,
};
await runTeamSafe(4, "./qa-teams-extensive/team4-integration.mjs", [context]);

// ── Final report ────────────────────────────────────────────────────────────

const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
const totalPass = allResults.reduce((s, r) => s + r.pass, 0);
const totalFail = allResults.reduce((s, r) => s + r.fail, 0);
const totalWarn = allResults.reduce((s, r) => s + r.warn, 0);
const totalSkip = allResults.reduce((s, r) => s + r.skip, 0);
const totalTests = allResults.reduce((s, r) => s + r.total, 0);

console.log(`\n${"═".repeat(60)}`);
console.log("  FINAL RESULTS");
console.log(`${"═".repeat(60)}\n`);

for (const r of allResults) {
  const icon = r.fail > 0 ? "✗" : "✓";
  console.log(`${icon} ${r.teamName}: ${r.pass}/${r.total} passed (${r.fail} failed, ${r.warn} warnings) [${r.duration}s]`);
}

console.log(`\n── Totals ──`);
console.log(`  Pass: ${totalPass}  Fail: ${totalFail}  Warn: ${totalWarn}  Skip: ${totalSkip}  Total: ${totalTests}`);
console.log(`  Duration: ${totalDuration}s`);
console.log(`  Status: ${totalFail === 0 ? "ALL PASSED ✓" : `${totalFail} FAILURES ✗`}`);

// Save full results
saveResults("qa-results.json", {
  timestamp: new Date().toISOString(),
  duration: totalDuration,
  summary: { pass: totalPass, fail: totalFail, warn: totalWarn, skip: totalSkip, total: totalTests },
  teams: allResults,
});

console.log(`\nResults saved to ${OUT_DIR}/qa-results.json`);
process.exit(totalFail > 0 ? 1 : 0);
