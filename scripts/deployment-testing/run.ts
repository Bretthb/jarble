#!/usr/bin/env npx tsx
/**
 * Deployment Testing Orchestrator
 *
 * Runs 4 specialized agents against a production OpenClaw deployment,
 * collects metrics, and generates a comprehensive report.
 *
 * Usage:
 *   AUTH_TOKEN="..." npx tsx scripts/deployment-testing/run.ts --deployment <id> [--verbose]
 *
 * Environment:
 *   AUTH_TOKEN     — Auth0 Bearer token (required)
 *   API_URL        — API base URL (default: https://api.jarble.ai)
 *   TEST_TIMEOUT   — Per-test timeout in ms (default: 45000)
 *   TEST_DELAY     — Delay between tests in ms (default: 2000)
 *
 * Get your AUTH_TOKEN from browser DevTools:
 *   1. Open jarble.ai → DevTools → Network tab
 *   2. Click any API request → Headers → Authorization: Bearer <token>
 *   3. Copy the token (starts with "eyJ...")
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfig, calculateSummary, generateReport, type FullReport } from "./lib.js";
import {
  runUIComponentAgent,
  runConversationSafetyAgent,
  runPerformanceAgent,
  runDataIntegrationAgent,
} from "./agents.js";

// Resolve reports directory relative to this script
const SCRIPT_DIR = typeof __dirname !== "undefined"
  ? __dirname
  : new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");

async function main() {
  const config = getConfig();

  console.log("╔═══════════════════════════════════════════════════════╗");
  console.log("║       Jarble Deployment Testing Framework            ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log(`  Deployment: ${config.deploymentId}`);
  console.log(`  API:        ${config.apiUrl}`);
  console.log(`  Timeout:    ${config.timeoutMs}ms per test`);
  console.log(`  Delay:      ${config.delayBetweenTestsMs}ms between tests`);
  console.log();

  // Verify connectivity with a quick health check
  console.log("Verifying API connectivity...");
  try {
    const healthRes = await fetch(`${config.apiUrl}/health`, {
      headers: { Authorization: `Bearer ${config.token}` },
      signal: AbortSignal.timeout(10000),
    });
    if (!healthRes.ok) {
      console.error(`API health check failed: HTTP ${healthRes.status}`);
      console.error("Check your API_URL and AUTH_TOKEN.");
      process.exit(1);
    }
    console.log("API is reachable.\n");
  } catch (err) {
    console.error(`Cannot reach API at ${config.apiUrl}: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }

  const overallStart = Date.now();

  // Run all 4 agents sequentially (same deployment, avoid overwhelming it)
  const agents = [
    await runUIComponentAgent(config),
    await runConversationSafetyAgent(config),
    await runPerformanceAgent(config),
    await runDataIntegrationAgent(config),
  ];

  const overallEnd = Date.now();
  const durationMs = overallEnd - overallStart;
  const durationStr = durationMs > 60000
    ? `${Math.floor(durationMs / 60000)}m ${Math.round((durationMs % 60000) / 1000)}s`
    : `${Math.round(durationMs / 1000)}s`;

  // Build report
  const summary = calculateSummary(agents);

  const report: FullReport = {
    deploymentId: config.deploymentId,
    deploymentName: config.deploymentName,
    apiUrl: config.apiUrl,
    timestamp: new Date().toISOString().replace("T", " ").split(".")[0],
    duration: durationStr,
    agents,
    summary,
  };

  const markdown = generateReport(report);

  // Write report to file
  const reportsDir = join(SCRIPT_DIR, "reports");
  mkdirSync(reportsDir, { recursive: true });
  const dateSlug = new Date().toISOString().slice(0, 10);
  const reportPath = join(reportsDir, `${config.deploymentId}-${dateSlug}.md`);
  writeFileSync(reportPath, markdown, "utf-8");

  // Print summary
  console.log("\n╔═══════════════════════════════════════════════════════╗");
  console.log("║                    TEST COMPLETE                      ║");
  console.log("╚═══════════════════════════════════════════════════════╝");
  console.log();

  const scoreEmoji = summary.overallScore >= 90 ? "🟢" : summary.overallScore >= 70 ? "🟡" : "🔴";
  console.log(`  ${scoreEmoji} Overall Score: ${summary.overallScore}/100`);
  console.log(`  Tests:     ${summary.passed} passed, ${summary.failed} failed, ${summary.warnings} warnings`);
  console.log(`  Latency:   avg ${summary.avgResponseTimeMs}ms | p50 ${summary.p50ResponseTimeMs}ms | p95 ${summary.p95ResponseTimeMs}ms`);
  if (summary.avgTimeToFirstTokenMs !== null) {
    console.log(`  TTFT:      avg ${summary.avgTimeToFirstTokenMs}ms`);
  }
  console.log(`  UI Blocks: ${summary.uiBlocksRendered} rendered (${summary.uiBlockSuccessRate}% success)`);
  console.log(`  Security:  ${summary.guardrailCompliance}% guardrail compliance`);
  console.log(`  Duration:  ${durationStr}`);
  console.log();
  console.log(`  Report saved: ${reportPath}`);
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
