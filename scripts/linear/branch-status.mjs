#!/usr/bin/env node
// Pure-git helpers for branch health: ahead/behind, merge-conflict probes,
// and ephemeral worktrees for per-branch QA. No Linear deps — safe to import
// from any script or hook.
//
// All helpers are defensive: they return a well-formed value on failure
// rather than throwing, because the session-end hook and nightly cron
// must never crash a teammate's workflow.

import { execFileSync, execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export const DEFAULT_BASE = process.env.JARBLE_BASE_BRANCH || "develop";
const REMOTE = process.env.JARBLE_REMOTE || "origin";

function run(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, { stdio: ["ignore", "pipe", "ignore"], encoding: "utf8", ...opts }).trim();
  } catch {
    return "";
  }
}

function runWithStatus(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], encoding: "utf8", ...opts });
  return { status: res.status ?? 1, stdout: (res.stdout || "").toString(), stderr: (res.stderr || "").toString() };
}

/** Ensure `origin/<base>` is up to date without failing the caller. */
export function fetchBase(base = DEFAULT_BASE) {
  run("git", ["fetch", REMOTE, base, "--quiet"]);
}

/** Count commits ahead/behind of the base. Returns {ahead, behind, base}. */
export function aheadBehind(branchRef = "HEAD", base = DEFAULT_BASE) {
  fetchBase(base);
  const out = run("git", ["rev-list", "--left-right", "--count", `${REMOTE}/${base}...${branchRef}`]);
  const parts = out.split(/\s+/);
  if (parts.length < 2) return { ahead: 0, behind: 0, base };
  return { behind: parseInt(parts[0], 10) || 0, ahead: parseInt(parts[1], 10) || 0, base };
}

/** Returns conflict info between two refs. `base` is the merge-base used for a 3-way compare. */
export function conflictsBetween(refA, refB, base = null) {
  const mergeBase = base || run("git", ["merge-base", refA, refB]);
  if (!mergeBase) return { hasConflicts: false, files: [], reason: "no-merge-base" };
  // Modern git (≥2.38). Falls back to parsing markers on older git.
  const modern = runWithStatus("git", ["merge-tree", "--write-tree", "--name-only", `--merge-base=${mergeBase}`, refA, refB]);
  if (modern.status === 0) return { hasConflicts: false, files: [], reason: "clean" };
  // On conflict, modern git prints "<tree-sha>\n<files>\n\nConflict info...". Extract file list.
  const lines = modern.stdout.split("\n").filter(Boolean);
  const files = lines.slice(1).filter((l) => !/^\s/.test(l) && !l.startsWith("Auto-"));
  if (files.length || /CONFLICT/i.test(modern.stderr)) {
    return { hasConflicts: true, files, reason: "modern" };
  }
  // Fallback: old `git merge-tree <base> <a> <b>` — look for conflict markers in output.
  const legacy = run("git", ["merge-tree", mergeBase, refA, refB]);
  if (!legacy) return { hasConflicts: false, files: [], reason: "legacy-empty" };
  const markers = legacy.match(/^<{7} /gm) ? true : false;
  if (!markers) return { hasConflicts: false, files: [], reason: "legacy-clean" };
  // Grep file headers `changed in both ... base ... our ... their`.
  const fileMatches = [...legacy.matchAll(/changed in both[\s\S]*?(?:our|their)   \S+ \S+ (.+?)\n/g)].map((m) => m[1].trim());
  return { hasConflicts: true, files: [...new Set(fileMatches)], reason: "legacy" };
}

/** Conflict check for a branch against origin/<base>. */
export function conflictsWithBase(branchRef = "HEAD", base = DEFAULT_BASE) {
  fetchBase(base);
  return conflictsBetween(branchRef, `${REMOTE}/${base}`);
}

/**
 * Create a disposable worktree pointed at a ref. Returns { path, dispose }.
 * `dispose()` removes the worktree and cleans up.
 * If the worktree cannot be created, returns null.
 */
export function createWorktree(ref, label = "qa") {
  const root = run("git", ["rev-parse", "--show-toplevel"]);
  if (!root) return null;
  const base = join(root, ".worktrees");
  try { mkdirSync(base, { recursive: true }); } catch {}
  const path = join(base, `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const created = runWithStatus("git", ["worktree", "add", "--detach", path, ref]);
  if (created.status !== 0) return null;
  return {
    path,
    dispose: () => {
      runWithStatus("git", ["worktree", "remove", "--force", path]);
      if (existsSync(path)) {
        try { rmSync(path, { recursive: true, force: true }); } catch {}
      }
    },
  };
}

/** Summarize branch health in one blob usable by both hooks and the orchestrator. */
export function branchHealth(branchRef = "HEAD", base = DEFAULT_BASE) {
  const ab = aheadBehind(branchRef, base);
  const conflict = conflictsWithBase(branchRef, base);
  const needsRebase = ab.behind >= 20 || conflict.hasConflicts;
  return {
    base,
    ahead: ab.ahead,
    behind: ab.behind,
    conflictsWithBase: conflict.hasConflicts,
    conflictFiles: conflict.files,
    needsRebase,
  };
}
