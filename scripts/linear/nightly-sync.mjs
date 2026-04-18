#!/usr/bin/env node
/**
 * Nightly cross-ticket sync + focused QA.
 *
 * What it does:
 *   1. Pulls every open Linear ticket in the team (In Progress + In Review by default).
 *   2. Builds a cross-ticket graph: which PRs touch which files (collision map), which
 *      tickets block which, and who is assigned.
 *   3. Hands the graph to the `linear-orchestrator` agent, which writes:
 *        - a per-ticket QA focus plan (focus-plan.json)
 *        - a daily narrative to `docs/daily-standup.md`
 *   4. For each ticket in the focus plan, invokes the existing overnight QA runner
 *      with `--cycles 1 --focus "JAR-XX: <title>"`, then posts the condensed result
 *      as a Linear comment.
 *
 * Usage:
 *   node scripts/linear/nightly-sync.mjs [options]
 *
 * Options:
 *   --dry-run          Skip all Linear writes (no comments, no transitions).
 *   --cycles <n>       Runtime QA cycles per ticket. Default 1. Set 0 to only build the graph + standup.
 *   --no-static-qa     Skip per-branch static QA (typecheck + test in a worktree). Default on.
 *   --max-tickets <n>  Cap tickets processed in a single run. Default 10.
 *   --states "a,b"     Comma list of Linear states to include. Default "In Progress,In Review".
 *   --base <branch>    Base branch for ahead/behind + conflict checks. Default develop.
 *   --verbose          Print verbose progress to stdout.
 *
 * Intended to be run from local crontab at 04:00. The CLAUDE.md section
 * "Nightly sync" gives the exact crontab stanza.
 */

import { spawnSync, spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { linearApiKey, listOpenIssues, getIssueByIdentifier, commentOnIssue } from "./graphql-client.mjs";
import { aheadBehind, conflictsBetween, conflictsWithBase, createWorktree, fetchBase, DEFAULT_BASE } from "./branch-status.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..", "..");

function arg(name, fallback) {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return fallback;
  const val = process.argv[idx + 1];
  if (!val || val.startsWith("--")) return fallback;
  return val;
}
const DRY_RUN     = process.argv.includes("--dry-run");
const CYCLES      = parseInt(arg("cycles", "1"), 10);
const SKIP_STATIC = process.argv.includes("--no-static-qa");
const MAX_TICKETS = parseInt(arg("max-tickets", "10"), 10);
const STATES      = arg("states", "In Progress,In Review").split(",").map((s) => s.trim());
const BASE        = arg("base", DEFAULT_BASE);
const VERBOSE     = process.argv.includes("--verbose");

const log = (...a) => console.log(new Date().toISOString(), ...a);
const vlog = (...a) => VERBOSE && log(...a);

async function main() {
  if (!linearApiKey()) {
    log("LINEAR_API_KEY not set. Exiting.");
    process.exit(0);
  }

  log(`Nightly sync starting (dry-run=${DRY_RUN}, cycles=${CYCLES}, states=${STATES.join("|")})`);

  // 1. Fetch open tickets
  const issues = await listOpenIssues({ states: STATES });
  if (issues.length === 0) {
    log("No open tickets. Nothing to do.");
    writeStandup({ date: today(), tickets: [], collisions: [], narrative: "No open tickets in the tracked states." });
    process.exit(0);
  }
  log(`Fetched ${issues.length} open ticket(s).`);

  fetchBase(BASE);

  // 2. Build PR → files map (collision map) + per-ticket branch health
  const prTouched = buildPrTouchedFilesMap(issues);
  const branchHealthByTicket = buildBranchHealth(issues, BASE);

  // 3. Build orchestrator input
  const graph = {
    date: today(),
    base: BASE,
    states: STATES,
    tickets: issues.slice(0, MAX_TICKETS).map((i) => ({
      identifier: i.identifier,
      title: i.title,
      url: i.url,
      state: i.state?.name,
      assignee: i.assignee?.name || null,
      priority: i.priority,
      labels: (i.labels?.nodes || []).map((l) => l.name),
      updatedAt: i.updatedAt,
      prFiles: prTouched.get(i.identifier) || [],
      prUrl: prTouched.get(i.identifier + ":url") || null,
      branchRef: branchHealthByTicket.get(i.identifier)?.branchRef || null,
      aheadOfBase: branchHealthByTicket.get(i.identifier)?.ahead || 0,
      behindBase: branchHealthByTicket.get(i.identifier)?.behind || 0,
      conflictsWithBase: branchHealthByTicket.get(i.identifier)?.conflictsWithBase || false,
      conflictFiles: branchHealthByTicket.get(i.identifier)?.conflictFiles || [],
    })),
    collisions: computeCollisions(prTouched),
    pairConflicts: computePairConflicts(issues, branchHealthByTicket),
  };

  // Stage artifacts inside the repo so the orchestrator child — which runs with
  // the default Claude Code sandbox scoped to the workspace — can read/write them.
  // Using os.tmpdir() fails under bypassPermissions=false because temp is outside
  // the session's allowed working directories.
  const tmpDir = join(REPO_ROOT, ".nightly", `run-${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });
  const graphPath = join(tmpDir, "graph.json");
  const focusPath = join(tmpDir, "focus-plan.json");
  const standupPath = join(REPO_ROOT, "docs", "daily-standup.md");
  mkdirSync(dirname(standupPath), { recursive: true });
  writeFileSync(graphPath, JSON.stringify(graph, null, 2));
  vlog("graph written:", graphPath);

  // 4. Invoke the linear-orchestrator agent.
  // Agent is expected to: read graph.json, write focus-plan.json, write docs/daily-standup.md.
  const orchestratorPrompt = [
    "You are invoked by scripts/linear/nightly-sync.mjs as the nightly cross-ticket planner.",
    `Read the cross-ticket graph at: ${graphPath}`,
    `Write the focus plan (array of {identifier, title, focus}) to: ${focusPath}`,
    `Write the daily standup narrative to: ${standupPath}`,
    "Follow the linear-orchestrator agent instructions exactly.",
  ].join(" ");

  const orchRes = spawnSync("claude", ["-p", "--agent", "linear-orchestrator", orchestratorPrompt], {
    cwd: REPO_ROOT,
    stdio: VERBOSE ? "inherit" : ["ignore", "pipe", "pipe"],
    env: process.env,
    timeout: 5 * 60 * 1000,
  });
  if (!existsSync(focusPath)) {
    log(`linear-orchestrator agent did not produce a focus plan (exit=${orchRes.status}). Falling back to all open tickets.`);
    writeFileSync(focusPath, JSON.stringify(graph.tickets.map((t) => ({
      identifier: t.identifier, title: t.title, focus: `${t.identifier}: ${t.title}`,
    })), null, 2));
    if (!existsSync(standupPath)) {
      writeStandup({ date: graph.date, tickets: graph.tickets, collisions: graph.collisions, narrative: "Orchestrator agent unavailable. Showing raw ticket list." });
    }
  }

  const focusPlan = safeReadJson(focusPath) || [];
  log(`Processing ${focusPlan.length} ticket(s) (static=${!SKIP_STATIC}, runtime=${CYCLES > 0}).`);

  // 5. Per-ticket loop: static QA in worktree (against branch) + runtime QA (against develop) + comment.
  for (const entry of focusPlan.slice(0, MAX_TICKETS)) {
    const ticketGraph = graph.tickets.find((t) => t.identifier === entry.identifier);
    log(`Processing ${entry.identifier}…`);

    const staticResult = SKIP_STATIC || !ticketGraph?.branchRef
      ? { skipped: true, reason: SKIP_STATIC ? "disabled via --no-static-qa" : "no branch detected on remote" }
      : await runStaticQaInWorktree(ticketGraph.branchRef);

    const runtimeResult = CYCLES <= 0
      ? { skipped: true, reason: "--cycles 0" }
      : await runOvernightQa(entry.focus, CYCLES);

    const resultBody = composeQaComment(entry, ticketGraph, staticResult, runtimeResult);
    if (DRY_RUN) {
      log(`[dry-run] would comment on ${entry.identifier}:\n${resultBody.slice(0, 200)}…`);
      continue;
    }
    const issue = await getIssueByIdentifier(entry.identifier);
    if (!issue) { log(`  could not resolve ${entry.identifier}, skipping comment.`); continue; }
    const ok = await commentOnIssue(issue.id, resultBody);
    log(`  comment posted: ${ok ? "ok" : "FAILED"}`);
  }

  log("Nightly sync complete.");
}

/** Resolve each issue's remote branch (via PR head or by guessing) and compute ahead/behind + conflicts. */
function buildBranchHealth(issues, base) {
  const out = new Map();
  for (const i of issues) {
    const branchRef = resolveBranchRef(i.identifier);
    if (!branchRef) { out.set(i.identifier, { branchRef: null, ahead: 0, behind: 0, conflictsWithBase: false, conflictFiles: [] }); continue; }
    const ab = aheadBehind(branchRef, base);
    const conflict = conflictsWithBase(branchRef, base);
    out.set(i.identifier, {
      branchRef,
      ahead: ab.ahead,
      behind: ab.behind,
      conflictsWithBase: conflict.hasConflicts,
      conflictFiles: conflict.files,
    });
  }
  return out;
}

function resolveBranchRef(identifier) {
  const m = identifier.match(/JAR-(\d+)/i);
  if (!m) return null;
  const pat = `*jar-${m[1]}*`;
  const lsRemote = run(`git ls-remote --heads origin "${pat}"`);
  if (!lsRemote) return null;
  const firstLine = lsRemote.split("\n")[0];
  const parts = firstLine.split(/\s+/);
  if (parts.length < 2) return null;
  const refName = parts[1].replace("refs/heads/", "");
  try {
    spawnSync("git", ["fetch", "origin", refName, "--quiet"], { cwd: REPO_ROOT });
  } catch {}
  return `origin/${refName}`;
}

/** Pairwise conflict probe for tickets with known branch refs. O(N^2) on small N — fine. */
function computePairConflicts(issues, branchHealthMap) {
  const pairs = [];
  const entries = issues
    .map((i) => ({ identifier: i.identifier, ref: branchHealthMap.get(i.identifier)?.branchRef }))
    .filter((e) => e.ref);
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const a = entries[i], b = entries[j];
      const res = conflictsBetween(a.ref, b.ref);
      if (res.hasConflicts) {
        pairs.push({ a: a.identifier, b: b.identifier, files: res.files });
      }
    }
  }
  return pairs;
}

/**
 * Run static QA (typecheck + test) in a disposable worktree for the given remote ref.
 * Returns { skipped?, status, log, runtimeMs }.
 */
async function runStaticQaInWorktree(ref) {
  const started = Date.now();
  const wt = createWorktree(ref, "qa-static");
  if (!wt) return { skipped: true, reason: "worktree creation failed" };
  try {
    const out = [];
    out.push(`[worktree] ${wt.path}`);
    const api = spawnSync("npm", ["run", "typecheck", "--silent"], {
      cwd: join(wt.path, "jarble-api-main"), stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 5 * 60 * 1000,
    });
    out.push(`[api typecheck] ${api.status === 0 ? "pass" : "fail"}`);
    if (api.status !== 0) out.push(tailLines(api.stdout + api.stderr, 20));

    const fe = spawnSync("pnpm", ["run", "check", "--silent"], {
      cwd: join(wt.path, "Jarble-mvp"), stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", timeout: 5 * 60 * 1000,
    });
    out.push(`[frontend check] ${fe.status === 0 ? "pass" : "fail"}`);
    if (fe.status !== 0) out.push(tailLines(fe.stdout + fe.stderr, 20));

    return {
      status: api.status === 0 && fe.status === 0 ? "pass" : "fail",
      log: out.join("\n"),
      runtimeMs: Date.now() - started,
    };
  } finally {
    wt.dispose();
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function safeReadJson(p) {
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

function buildPrTouchedFilesMap(issues) {
  const out = new Map();
  for (const i of issues) {
    const branchHint = issueToBranch(i.identifier);
    if (!branchHint) continue;
    try {
      const prInfo = run(`gh pr list --search "${i.identifier}" --state open --json url,files --limit 1`);
      const parsed = prInfo ? JSON.parse(prInfo) : [];
      if (!parsed.length) continue;
      const files = (parsed[0].files || []).map((f) => f.path);
      out.set(i.identifier, files);
      out.set(i.identifier + ":url", parsed[0].url);
    } catch {}
  }
  return out;
}

function issueToBranch(id) {
  const m = id.match(/JAR-(\d+)/i);
  return m ? `jar-${m[1]}` : "";
}

function computeCollisions(prTouched) {
  const fileToTickets = new Map();
  for (const [key, val] of prTouched.entries()) {
    if (key.endsWith(":url")) continue;
    for (const f of val) {
      if (!fileToTickets.has(f)) fileToTickets.set(f, []);
      fileToTickets.get(f).push(key);
    }
  }
  const out = [];
  for (const [file, tickets] of fileToTickets.entries()) {
    if (tickets.length > 1) out.push({ file, tickets });
  }
  return out;
}

async function runOvernightQa(focus, cycles) {
  const script = join(REPO_ROOT, "scripts", "nightly-qa", "overnight-agent.mjs");
  if (!existsSync(script)) {
    return { ok: false, reason: "overnight-agent.mjs missing — QA stack not installed", excerpt: "" };
  }
  const res = spawnSync("node", [script, "--cycles", String(cycles), "--focus", focus], {
    cwd: REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
    timeout: 60 * 60 * 1000,
  });
  const stdout = (res.stdout || "").toString();
  const stderr = (res.stderr || "").toString();
  const excerpt = tailLines(stdout || stderr, 40);
  return { ok: res.status === 0, excerpt };
}

function tailLines(text, n) {
  if (!text) return "";
  return text.split("\n").slice(-n).join("\n");
}

function composeQaComment(entry, ticketGraph, staticResult, runtimeResult) {
  const lines = [];
  lines.push(`### Nightly QA — ${today()}`);
  lines.push("");
  lines.push(`**Focus:** ${entry.focus}`);
  lines.push("");
  lines.push("**Static QA (this branch, in worktree)**");
  if (staticResult.skipped) {
    lines.push(`- skipped: ${staticResult.reason}`);
  } else {
    lines.push(`- result: ${staticResult.status}`);
    if (staticResult.log) {
      lines.push("");
      lines.push("```");
      lines.push(staticResult.log.slice(0, 2000));
      lines.push("```");
    }
  }
  lines.push("");
  lines.push("**Runtime QA (against develop on dev env)**");
  if (runtimeResult.skipped) {
    lines.push(`- skipped: ${runtimeResult.reason}`);
  } else {
    lines.push(`- result: ${runtimeResult.ok ? "pass" : "fail"}`);
    if (runtimeResult.excerpt) {
      lines.push("");
      lines.push("```");
      lines.push(runtimeResult.excerpt);
      lines.push("```");
    }
  }
  if (ticketGraph) {
    lines.push("");
    lines.push("**Branch status**");
    lines.push(`- ${ticketGraph.aheadOfBase} ahead, ${ticketGraph.behindBase} behind \`${graphBase(ticketGraph)}\``);
    if (ticketGraph.conflictsWithBase) {
      lines.push(`- would conflict with base on: ${ticketGraph.conflictFiles.slice(0, 10).join(", ") || "(unspecified files)"}`);
      lines.push(`- **Rebase needed before merge.**`);
    } else if (ticketGraph.behindBase >= 20) {
      lines.push(`- ${ticketGraph.behindBase} commits behind — consider a rebase to keep the merge clean.`);
    }
  }
  lines.push("");
  lines.push("_Run by `scripts/linear/nightly-sync.mjs`._");
  return lines.join("\n");
}

function graphBase(ticketGraph) { return (ticketGraph && ticketGraph.base) || "develop"; }

function writeStandup({ date, tickets, collisions, narrative }) {
  const lines = [];
  lines.push(`# Daily standup — ${date}`);
  lines.push("");
  lines.push("_Auto-generated by `scripts/linear/nightly-sync.mjs`. Overwritten nightly._");
  lines.push("");
  lines.push("## Open tickets");
  lines.push("");
  if (tickets.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Ticket | Title | Assignee | State | Branch | PR |");
    lines.push("|--------|-------|----------|-------|--------|----|");
    for (const t of tickets) {
      const bs = t.conflictsWithBase ? "conflict" : (t.behindBase >= 20 ? `behind ${t.behindBase}` : "ok");
      lines.push(`| [${t.identifier}](${t.url}) | ${escape(t.title)} | ${t.assignee || "-"} | ${t.state || "-"} | ${bs} | ${t.prUrl ? `[link](${t.prUrl})` : "-"} |`);
    }
  }
  lines.push("");
  lines.push("## Cross-ticket file collisions");
  lines.push("");
  if (collisions.length === 0) lines.push("_None detected._");
  else for (const c of collisions) lines.push(`- \`${c.file}\` touched by ${c.tickets.join(", ")}`);
  lines.push("");
  lines.push("## Narrative");
  lines.push("");
  lines.push(narrative || "_(no narrative — orchestrator did not run)_");
  writeFileSync(join(REPO_ROOT, "docs", "daily-standup.md"), lines.join("\n") + "\n");
}

function escape(s) { return String(s || "").replace(/\|/g, "\\|"); }

function run(cmd) {
  try {
    return spawnSync(cmd, { shell: true, stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).stdout.trim();
  } catch { return ""; }
}

main().catch((err) => { log("Fatal:", err.message); process.exit(1); });
