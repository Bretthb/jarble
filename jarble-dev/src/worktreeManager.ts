import { execSync } from "child_process";
import path from "path";
import fs from "fs";
import type { WorktreeInfo } from "./types.js";
import type { Logger } from "./logger.js";

export class WorktreeManager {
  private repoRoot: string;
  private baseBranch: string;
  private worktrees: Map<string, WorktreeInfo> = new Map();
  private logger: Logger;

  constructor(repoRoot: string, baseBranch: string, logger: Logger) {
    this.repoRoot = repoRoot;
    this.baseBranch = baseBranch;
    this.logger = logger;
  }

  /** Create a new worktree for a task */
  async create(taskId: string, branchName: string): Promise<WorktreeInfo> {
    const worktreePath = path.join(this.repoRoot, ".worktrees", branchName);

    // Ensure parent dir exists
    fs.mkdirSync(path.dirname(worktreePath), { recursive: true });

    // Create the worktree with a new branch from baseBranch
    try {
      execSync(
        `git worktree add -b "${branchName}" "${worktreePath}" "${this.baseBranch}"`,
        { cwd: this.repoRoot, stdio: "pipe" }
      );
    } catch (e: unknown) {
      // Branch might already exist — try without -b
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("already exists")) {
        this.logger.warn(`Branch ${branchName} already exists, reusing`, { taskId });
        try {
          execSync(`git worktree add "${worktreePath}" "${branchName}"`, {
            cwd: this.repoRoot,
            stdio: "pipe",
          });
        } catch (e2: unknown) {
          const msg2 = e2 instanceof Error ? e2.message : String(e2);
          // Worktree path might already exist
          if (msg2.includes("already registered") || msg2.includes("already exists")) {
            this.logger.warn(`Worktree already exists at ${worktreePath}`, { taskId });
          } else {
            throw e2;
          }
        }
      } else {
        throw e;
      }
    }

    const info: WorktreeInfo = {
      path: worktreePath,
      branch: branchName,
      baseBranch: this.baseBranch,
      taskId,
      createdAt: new Date(),
    };

    this.worktrees.set(taskId, info);
    this.logger.info(`Created worktree`, { taskId, branch: branchName, path: worktreePath });
    return info;
  }

  /** Remove a worktree */
  async remove(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId);
    if (!info) return;

    // Remove junctions first to avoid deleting real node_modules
    this.removeJunctions(info.path);

    try {
      execSync(`git worktree remove "${info.path}" --force`, {
        cwd: this.repoRoot,
        stdio: "pipe",
      });
      this.logger.info(`Removed worktree`, { taskId, branch: info.branch });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Failed to remove worktree: ${msg}`, { taskId });
    }

    this.worktrees.delete(taskId);
  }

  /** Delete the branch associated with a task's worktree */
  async deleteBranch(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId);
    if (!info) return;

    try {
      execSync(`git branch -D "${info.branch}"`, {
        cwd: this.repoRoot,
        stdio: "pipe",
      });
      this.logger.info(`Deleted branch`, { taskId, branch: info.branch });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Failed to delete branch: ${msg}`, { taskId });
    }
  }

  /** Clean up all worktrees created by this manager */
  async cleanupAll(): Promise<void> {
    for (const taskId of [...this.worktrees.keys()]) {
      await this.remove(taskId);
    }
    // Prune stale worktree references
    try {
      execSync("git worktree prune", { cwd: this.repoRoot, stdio: "pipe" });
    } catch { /* best effort */ }
  }

  /** Get worktree info for a task */
  get(taskId: string): WorktreeInfo | undefined {
    return this.worktrees.get(taskId);
  }

  /** List all active worktrees */
  list(): WorktreeInfo[] {
    return [...this.worktrees.values()];
  }

  /** Symlink (junction on Windows) node_modules from main repo into worktree */
  async symlinkNodeModules(taskId: string): Promise<void> {
    const info = this.worktrees.get(taskId);
    if (!info) return;

    const packages = ["Jarble-mvp", "jarble-api-main", "jarble-dev"];
    for (const pkg of packages) {
      const sourceNm = path.join(this.repoRoot, pkg, "node_modules");
      const targetNm = path.join(info.path, pkg, "node_modules");

      if (!fs.existsSync(sourceNm)) continue;
      if (fs.existsSync(targetNm)) continue;

      // Ensure parent directory exists in worktree
      fs.mkdirSync(path.dirname(targetNm), { recursive: true });

      try {
        if (process.platform === "win32") {
          execSync(`cmd /c mklink /J "${targetNm}" "${sourceNm}"`, { stdio: "pipe" });
        } else {
          fs.symlinkSync(sourceNm, targetNm, "junction");
        }
        this.logger.debug(`Linked node_modules for ${pkg}`, { taskId });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`Failed to link node_modules for ${pkg}: ${msg}`, { taskId });
      }
    }
  }

  /** Remove junctions before worktree removal to avoid deleting real node_modules */
  private removeJunctions(worktreePath: string): void {
    const packages = ["Jarble-mvp", "jarble-api-main", "jarble-dev"];
    for (const pkg of packages) {
      const nmPath = path.join(worktreePath, pkg, "node_modules");
      try {
        const stat = fs.lstatSync(nmPath);
        if (stat.isSymbolicLink() || stat.isDirectory()) {
          if (process.platform === "win32") {
            // rmdir removes junction without following it
            execSync(`cmd /c rmdir "${nmPath}"`, { stdio: "pipe" });
          } else {
            fs.unlinkSync(nmPath);
          }
        }
      } catch { /* not found — fine */ }
    }
  }

  /** Check if a worktree has uncommitted changes */
  hasChanges(taskId: string): boolean {
    const info = this.worktrees.get(taskId);
    if (!info) return false;
    try {
      const status = execSync("git status --porcelain", {
        cwd: info.path,
        encoding: "utf-8",
      });
      return status.trim().length > 0;
    } catch {
      return false;
    }
  }

  /** Get the diff of changes in a worktree relative to base */
  getDiff(taskId: string): string {
    const info = this.worktrees.get(taskId);
    if (!info) return "";
    try {
      return execSync(`git diff ${info.baseBranch}...HEAD`, {
        cwd: info.path,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
      });
    } catch {
      return "";
    }
  }
}
