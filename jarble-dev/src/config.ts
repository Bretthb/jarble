import path from "path";
import fs from "fs";
import type { JarbleDevConfig } from "./types.js";

const DEFAULTS: JarbleDevConfig = {
  repoRoot: path.resolve(import.meta.dirname, ".."),
  claudePath: "claude",
  baseBranch: "main",
  maxConcurrency: 4,
  defaultBudgetUsd: 5,
  defaultPermissionMode: "acceptEdits",
  logDir: path.resolve(import.meta.dirname, "..", "logs"),
  qualityGates: true,
  agentTimeoutMs: 10 * 60 * 1000, // 10 minutes
  maxRetries: 1,
  autoResolve: true,
  contextForwarding: true,
  jsonOutput: false,
  runBudgetUsd: 0,
  budgetWarningThreshold: 0.8,
  webhookUrls: [],
  incremental: false,
  contextBudgetTokens: 100_000,
};

/** Resolve the monorepo root by walking up from cwd looking for CLAUDE.md */
function findRepoRoot(from: string = process.cwd()): string {
  let dir = from;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "CLAUDE.md"))) return dir;
    dir = path.dirname(dir);
  }
  return from;
}

/** Find Claude CLI — check common locations */
function findClaudeCli(): string {
  const candidates = [
    "claude",
    path.join(process.env.HOME || process.env.USERPROFILE || "", ".local", "bin", "claude"),
    path.join(process.env.HOME || process.env.USERPROFILE || "", ".local", "bin", "claude.exe"),
  ];
  for (const p of candidates) {
    try {
      const resolved = p.includes(path.sep) ? p : p;
      // Just return the first candidate — spawning will validate it
      if (p === "claude") return p;
      if (fs.existsSync(resolved)) return resolved;
    } catch { /* skip */ }
  }
  return "claude";
}

export function loadConfig(overrides: Partial<JarbleDevConfig> = {}): JarbleDevConfig {
  const repoRoot = overrides.repoRoot || findRepoRoot();
  const logDir = overrides.logDir || path.join(repoRoot, "jarble-dev", "logs");

  // Ensure log directory exists
  fs.mkdirSync(logDir, { recursive: true });

  return {
    ...DEFAULTS,
    repoRoot,
    claudePath: overrides.claudePath || findClaudeCli(),
    logDir,
    ...overrides,
  };
}
