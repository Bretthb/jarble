#!/usr/bin/env node
// SessionStart hook: if the current git branch names a Linear ticket (jar-XX),
// fetch the ticket, inject scope+AC as additionalContext, and seed the session buffer.
// Silent no-op on any failure — hooks must never break a Claude Code session.

import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";

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

  const sessionsDir = join(repoRoot, ".claude", "sessions");
  try { mkdirSync(sessionsDir, { recursive: true }); } catch {}

  cleanOldBuffers(sessionsDir);

  const branch = sh("git rev-parse --abbrev-ref HEAD");
  const match = branch.match(/\bjar-(\d+)/i);
  const markerPath = join(sessionsDir, ".current-ticket");

  if (!match) {
    if (existsSync(markerPath)) { try { unlinkSync(markerPath); } catch {} }
    return;
  }

  const issueId = `JAR-${match[1]}`;
  const startHead = sh("git rev-parse HEAD") || "";
  const startTs = Date.now();

  // Read the raw stdin payload to learn the transcript path. If stdin is empty, still proceed.
  let transcriptPath = "";
  try {
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    const payload = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
    transcriptPath = payload.transcript_path || payload.transcriptPath || "";
  } catch {}

  const bufferPath = join(sessionsDir, `${issueId}-${startTs}.jsonl`);
  try { writeFileSync(bufferPath, ""); } catch {}

  const markerBody = [issueId, branch, startHead, String(startTs), transcriptPath, bufferPath].join("\n") + "\n";
  try { writeFileSync(markerPath, markerBody); } catch {}

  let additionalContext = `Active Linear ticket: **${issueId}** (branch \`${branch}\`).`;
  if (process.env.LINEAR_API_KEY) {
    const ticket = await tryFetchIssue(repoRoot, issueId);
    if (ticket) {
      const acBlock = extractAcceptance(ticket.description);
      additionalContext = [
        `Active Linear ticket: **${ticket.identifier}** — ${ticket.title} (${ticket.url}).`,
        ticket.state?.name ? `State: ${ticket.state.name}.` : "",
        acBlock ? `Acceptance criteria:\n${acBlock}` : "",
        "When you finish this session, the Stop hook will post a summary + mermaid + token-cost footer to this ticket.",
      ].filter(Boolean).join("\n\n");
    }
  }

  process.stdout.write(JSON.stringify({ additionalContext }));
}

function cleanOldBuffers(dir) {
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  let entries = [];
  try { entries = readdirSync(dir); } catch { return; }
  for (const name of entries) {
    if (!name.endsWith(".jsonl")) continue;
    const full = join(dir, name);
    try {
      if (statSync(full).mtimeMs < weekAgo) unlinkSync(full);
    } catch {}
  }
}

async function tryFetchIssue(repoRoot, id) {
  try {
    const mod = await import(join(repoRoot, "scripts", "linear", "graphql-client.mjs"));
    return await mod.getIssueByIdentifier(id);
  } catch {
    return null;
  }
}

function extractAcceptance(description) {
  if (!description) return "";
  const lines = description.split("\n");
  const idx = lines.findIndex((l) => /acceptance criteria/i.test(l));
  if (idx === -1) return "";
  const out = [];
  for (let i = idx + 1; i < lines.length && out.length < 10; i++) {
    const line = lines[i];
    if (/^\s*- \[.\]/.test(line)) out.push(line.trim());
    else if (out.length && /^\s*##? /.test(line)) break;
  }
  return out.join("\n");
}

main().catch(() => process.exit(0));
