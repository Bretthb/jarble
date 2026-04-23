#!/usr/bin/env node
// Stop hook: composes a rich Linear comment for the active ticket by spawning the
// `ticket-updater` subagent headless. Runs on the teammate's own Claude subscription,
// so token cost distributes to whoever is running the session.
// Silent no-op when no ticket is active or LINEAR_API_KEY is unset.

import { execSync, spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync, readFileSync as rf } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const sh = (cmd) => {
  try {
    return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8" }).trim();
  } catch {
    return "";
  }
};

async function main() {
  const repoRoot = sh("git rev-parse --show-toplevel");
  if (!repoRoot) return;
  process.chdir(repoRoot);

  if (!process.env.LINEAR_API_KEY) return;

  const markerPath = join(repoRoot, ".claude", "sessions", ".current-ticket");
  if (!existsSync(markerPath)) return;

  let markerLines = [];
  try { markerLines = readFileSync(markerPath, "utf8").split("\n"); } catch { return; }
  const [issueId, branch, startHead, startTsStr, transcriptFromStart, bufferPath] = markerLines;
  if (!issueId || !bufferPath) return;

  // Prefer the transcript path from the Stop payload (freshest), fall back to start marker.
  let transcriptPath = transcriptFromStart || "";
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    transcriptPath = payload.transcript_path || payload.transcriptPath || transcriptPath;
  } catch {}

  const currentHead = sh("git rev-parse HEAD");
  const base = startHead && sh(`git cat-file -e ${startHead}^{commit} 2>/dev/null && echo ok`) === "ok"
    ? startHead
    : sh("git merge-base HEAD develop");

  let commits = "", diffStat = "", diffFiles = "";
  if (base && base !== currentHead) {
    commits = sh(`git log --pretty=format:"%h %s" ${base}..HEAD`);
    diffStat = sh(`git diff --shortstat ${base}..HEAD`);
    diffFiles = sh(`git diff --name-only ${base}..HEAD`);
  }

  const sessionEvents = safeReadLines(bufferPath);
  const prUrl = sh(`gh pr list --head "${branch}" --json url --jq ".[0].url // \\"\\""`) || "";
  const handle = inferHandle(repoRoot) || (sh("git config user.email").split("@")[0] || "");

  // Token cost (best effort). JAR-97: log failures to stderr instead of
  // silently eating them so the session comment's missing footer isn't a
  // mystery when debugging later.
  let tokens = null;
  try {
    const mod = await import(join(repoRoot, "scripts", "linear", "token-cost.mjs"));
    tokens = mod.summarizeTranscript(transcriptPath);
  } catch (err) {
    console.error(`[ticket-session-end] token-cost.mjs failed:`, err?.message || err);
  }

  // Branch health vs develop — lets the updater agent nudge for rebase if needed.
  let branchStatus = null;
  try {
    const mod = await import(join(repoRoot, "scripts", "linear", "branch-status.mjs"));
    branchStatus = mod.branchHealth("HEAD");
  } catch (err) {
    console.error(`[ticket-session-end] branch-status.mjs failed:`, err?.message || err);
  }

  const payload = {
    issueId,
    branch,
    repoRoot,
    base,
    currentHead,
    commits: commits ? commits.split("\n") : [],
    diffStat,
    diffFiles: diffFiles ? diffFiles.split("\n") : [],
    sessionEvents,
    prUrl,
    tokens,
    branchStatus,
    handle,
    startedAt: Number(startTsStr) || 0,
    endedAt: Date.now(),
  };

  // If nothing changed this session, still emit a light "session touched ticket" ping rather than silence,
  // because the user ran Claude on this ticket and may want a trail. But: skip if there was ZERO activity.
  if (payload.commits.length === 0 && payload.diffFiles.length === 0 && payload.sessionEvents.length === 0) {
    cleanup(markerPath, bufferPath);
    return;
  }

  const payloadPath = join(tmpdir(), `jarble-session-${issueId}-${Date.now()}.json`);
  try { writeFileSync(payloadPath, JSON.stringify(payload, null, 2)); } catch { cleanup(markerPath, bufferPath); return; }

  const prompt = [
    `You are posting a session-end comment to Linear issue ${issueId}.`,
    `Read the session payload at: ${payloadPath}`,
    `Follow the ticket-updater agent instructions exactly.`,
    `When done, delete the payload file.`,
  ].join(" ");

  // Spawn headless. Detach so Claude Code can exit without waiting.
  try {
    const child = spawn("claude", ["-p", "--agent", "ticket-updater", prompt], {
      detached: true,
      stdio: "ignore",
      cwd: repoRoot,
      env: process.env,
    });
    child.unref();
  } catch {
    // If `claude` CLI isn't in PATH (e.g. teammate hasn't installed it), fall back to a direct post.
    try {
      const mod = await import(join(repoRoot, "scripts", "linear", "graphql-client.mjs"));
      const tokenMod = await import(join(repoRoot, "scripts", "linear", "token-cost.mjs"));
      const issue = await mod.getIssueByIdentifier(issueId);
      if (issue) {
        const footer = tokens ? tokenMod.formatFooter({ totals: tokens, handle, runtimeMs: payload.endedAt - payload.startedAt }) : "";
        const body = basicFallbackBody(payload, footer);
        await mod.commentOnIssue(issue.id, body);
      }
    } catch {}
  }

  // Hook cleans up local state — the agent reads files already or via the payload copy.
  cleanup(markerPath, bufferPath);
}

function safeReadLines(path) {
  if (!existsSync(path)) return [];
  try {
    return rf(path, "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch {
    return [];
  }
}

function inferHandle(repoRoot) {
  try {
    const crew = JSON.parse(rf(join(repoRoot, ".claude", "crew.json"), "utf8"));
    const email = sh("git config user.email");
    const hit = (crew.crew || []).find((m) => m.email && m.email.toLowerCase() === email.toLowerCase());
    return hit?.handle || crew.defaultAssignee || "";
  } catch {
    return "";
  }
}

function basicFallbackBody(p, footer) {
  const out = [];
  out.push(`**Claude Code session update** (branch \`${p.branch}\`)`);
  if (p.commits.length) {
    out.push("");
    out.push("Commits:");
    for (const c of p.commits.slice(0, 20)) out.push(`- ${c}`);
  }
  if (p.diffStat) {
    out.push("");
    out.push(p.diffStat);
  }
  if (p.prUrl) {
    out.push("");
    out.push(`PR: ${p.prUrl}`);
  }
  if (footer) {
    out.push("");
    out.push(footer);
  }
  return out.join("\n");
}

function cleanup(markerPath, bufferPath) {
  try { if (existsSync(markerPath)) unlinkSync(markerPath); } catch {}
  // Keep the buffer around for the agent to read; it is self-cleaned on next SessionStart older-than-7d.
}

main().catch(() => process.exit(0));
