#!/usr/bin/env node
// PostToolUse hook: appends a compact entry to the session buffer for the active ticket.
// Records only tool name + file path (or first line of bash command) — no file contents.
// Silent no-op when no ticket is active.

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execSync } from "node:child_process";

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
  const markerPath = join(repoRoot, ".claude", "sessions", ".current-ticket");
  if (!existsSync(markerPath)) return;

  let bufferPath = "";
  try {
    const marker = readFileSync(markerPath, "utf8").split("\n");
    bufferPath = marker[5] || "";
  } catch { return; }
  if (!bufferPath || !existsSync(bufferPath)) return;

  const chunks = [];
  try {
    for await (const c of process.stdin) chunks.push(c);
  } catch { return; }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return;

  let payload = {};
  try { payload = JSON.parse(raw); } catch { return; }

  const tool = payload.tool_name || payload.tool || "";
  const input = payload.tool_input || payload.toolInput || {};

  let path = "";
  let summary = "";
  if (tool === "Edit" || tool === "Write" || tool === "NotebookEdit" || tool === "MultiEdit") {
    path = input.file_path || "";
  } else if (tool === "Bash") {
    const cmd = (input.command || "").split("\n")[0].slice(0, 160);
    summary = cmd;
  } else if (tool === "Read") {
    path = input.file_path || "";
  } else {
    return;
  }

  if (!path && !summary) return;
  if (isDebouncedDuplicate(bufferPath, tool, path, summary)) return;

  const entry = JSON.stringify({ t: new Date().toISOString(), tool, path, summary });
  try { appendFileSync(bufferPath, entry + "\n"); } catch {}
}

function isDebouncedDuplicate(bufferPath, tool, path, summary) {
  try {
    const raw = readFileSync(bufferPath, "utf8");
    const lines = raw.split("\n").filter(Boolean);
    if (lines.length === 0) return false;
    const last = JSON.parse(lines[lines.length - 1]);
    return last.tool === tool && last.path === path && last.summary === summary;
  } catch {
    return false;
  }
}

main().catch(() => process.exit(0));
