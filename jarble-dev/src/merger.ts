import { execSync } from "child_process";
import type { MergeResult, Task } from "./types.js";
import type { Logger } from "./logger.js";
import type { WorktreeManager } from "./worktreeManager.js";
import type { AgentSpawner } from "./agentSpawner.js";
import { CONFLICT_RESOLUTION_PROMPT } from "./prompts/system.js";

export class Merger {
  private repoRoot: string;
  private logger: Logger;
  private worktreeManager: WorktreeManager;
  private spawner?: AgentSpawner;
  private autoResolve: boolean;

  constructor(
    repoRoot: string,
    logger: Logger,
    worktreeManager: WorktreeManager,
    spawner?: AgentSpawner,
    autoResolve = true,
  ) {
    this.repoRoot = repoRoot;
    this.logger = logger;
    this.worktreeManager = worktreeManager;
    this.spawner = spawner;
    this.autoResolve = autoResolve;
  }

  /** Merge a task's worktree branch into the target branch */
  async mergeBranch(task: Task, targetBranch: string): Promise<MergeResult> {
    const wt = this.worktreeManager.get(task.id);
    if (!wt) {
      return {
        taskId: task.id,
        branch: task.worktreeBranch || "unknown",
        status: "failed",
        error: "No worktree found for task",
      };
    }

    const branch = wt.branch;
    this.logger.merge(`Merging branch "${branch}" into "${targetBranch}"`, { taskId: task.id });

    try {
      // Switch to target branch in main repo
      execSync(`git checkout "${targetBranch}"`, {
        cwd: this.repoRoot,
        stdio: "pipe",
      });

      // Attempt merge
      try {
        execSync(`git merge "${branch}" --no-edit`, {
          cwd: this.repoRoot,
          stdio: "pipe",
        });

        this.logger.merge(`Successfully merged "${branch}"`, { taskId: task.id });
        return { taskId: task.id, branch, status: "merged" };
      } catch (mergeErr: unknown) {
        // Check for conflicts
        const status = execSync("git status --porcelain", {
          cwd: this.repoRoot,
          encoding: "utf-8",
        });

        const conflictFiles = status
          .split("\n")
          .filter(l => l.startsWith("UU") || l.startsWith("AA") || l.startsWith("DD"))
          .map(l => l.slice(3).trim());

        if (conflictFiles.length > 0) {
          // Abort the merge — let the user or a resolution agent handle it
          execSync("git merge --abort", { cwd: this.repoRoot, stdio: "pipe" });

          this.logger.merge(`Merge conflict in "${branch}"`, {
            taskId: task.id,
            conflictFiles,
          });

          return {
            taskId: task.id,
            branch,
            status: "conflict",
            conflictFiles,
          };
        }

        // Some other merge error
        const msg = mergeErr instanceof Error ? mergeErr.message : String(mergeErr);
        execSync("git merge --abort", { cwd: this.repoRoot, stdio: "pipe" }).toString();
        return {
          taskId: task.id,
          branch,
          status: "failed",
          error: msg,
        };
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Merge failed for "${branch}": ${msg}`, { taskId: task.id });
      return {
        taskId: task.id,
        branch,
        status: "failed",
        error: msg,
      };
    }
  }

  /** Merge all completed tasks in dependency order.
   *  Saves and restores the current branch, stashes dirty changes. */
  async mergeAll(tasks: Task[], targetBranch: string): Promise<MergeResult[]> {
    const results: MergeResult[] = [];
    const doneTasks = tasks.filter(t => t.status === "done" && t.worktreeBranch);
    if (doneTasks.length === 0) return results;

    // Save current branch so we can restore it after merging
    let originalBranch: string | null = null;
    let stashed = false;
    try {
      originalBranch = execSync("git rev-parse --abbrev-ref HEAD", {
        cwd: this.repoRoot, encoding: "utf-8",
      }).trim();
    } catch { /* detached HEAD — fine */ }

    // Stash any uncommitted changes in the main repo
    try {
      const status = execSync("git status --porcelain", {
        cwd: this.repoRoot, encoding: "utf-8",
      }).trim();
      if (status) {
        execSync('git stash push -m "jarble-dev: auto-stash before merge"', {
          cwd: this.repoRoot, stdio: "pipe",
        });
        stashed = true;
        this.logger.merge("Stashed uncommitted changes before merging");
      }
    } catch (e) {
      this.logger.warn(`Failed to stash: ${e}`);
    }

    for (const task of doneTasks) {
      const result = await this.mergeBranch(task, targetBranch);
      results.push(result);

      if (result.status === "conflict") {
        if (this.autoResolve && this.spawner) {
          this.logger.merge(`Attempting auto-resolution for "${task.name}"...`);
          const resolved = await this.resolveConflictWithAgent(task, targetBranch, result.conflictFiles!);
          results[results.length - 1] = resolved;
          if (resolved.status !== "merged") {
            this.logger.warn(
              `Auto-resolution failed for "${task.name}". Stopping merge sequence.`
            );
            break;
          }
        } else {
          this.logger.warn(
            `Stopping merge sequence due to conflict in "${task.name}". ` +
            `Remaining tasks not merged. Use --auto-resolve or resolve manually.`
          );
          break;
        }
      }
    }

    // Restore original branch
    if (originalBranch && originalBranch !== targetBranch) {
      try {
        execSync(`git checkout "${originalBranch}"`, {
          cwd: this.repoRoot, stdio: "pipe",
        });
      } catch {
        this.logger.warn(`Could not restore branch ${originalBranch}`);
      }
    }

    // Restore stashed changes
    if (stashed) {
      try {
        execSync("git stash pop", { cwd: this.repoRoot, stdio: "pipe" });
        this.logger.merge("Restored stashed changes");
      } catch {
        this.logger.warn("Failed to restore stash — run 'git stash pop' manually");
      }
    }

    return results;
  }

  /** Resolve a merge conflict by spawning a Claude agent */
  async resolveConflictWithAgent(
    task: Task,
    targetBranch: string,
    conflictFiles: string[],
  ): Promise<MergeResult> {
    if (!this.spawner) {
      return {
        taskId: task.id,
        branch: task.worktreeBranch!,
        status: "conflict",
        conflictFiles,
        error: "No agent spawner available for conflict resolution",
      };
    }

    this.logger.merge(`Spawning conflict resolution agent for "${task.name}"`, {
      conflictFiles,
    });

    try {
      // Re-attempt the merge to leave conflict markers in the working tree
      execSync(`git checkout "${targetBranch}"`, {
        cwd: this.repoRoot,
        stdio: "pipe",
      });

      try {
        execSync(`git merge "${task.worktreeBranch}" --no-edit`, {
          cwd: this.repoRoot,
          stdio: "pipe",
        });
        // No conflict after all
        return { taskId: task.id, branch: task.worktreeBranch!, status: "merged" };
      } catch {
        // Expected — conflict markers are now in the working tree
      }

      // Verify there are actual conflicts
      const status = execSync("git status --porcelain", {
        cwd: this.repoRoot,
        encoding: "utf-8",
      });
      const actualConflicts = status
        .split("\n")
        .filter(l => l.startsWith("UU") || l.startsWith("AA") || l.startsWith("DD"))
        .map(l => l.slice(3).trim());

      if (actualConflicts.length === 0) {
        // Auto-resolved by git
        execSync("git commit --no-edit", { cwd: this.repoRoot, stdio: "pipe" });
        return { taskId: task.id, branch: task.worktreeBranch!, status: "merged" };
      }

      // Spawn a Claude agent to resolve the conflicts
      const prompt = CONFLICT_RESOLUTION_PROMPT(
        task.worktreeBranch!,
        targetBranch,
        actualConflicts,
      );

      const agent = await this.spawner.spawnInRepo(prompt, this.repoRoot, 3, "acceptEdits");
      const result = await this.spawner.waitForAgent(agent.id);

      if (result.status === "done") {
        // Verify the merge was completed (agent should have committed)
        try {
          const mergeStatus = execSync("git status --porcelain", {
            cwd: this.repoRoot,
            encoding: "utf-8",
          }).trim();

          if (mergeStatus === "") {
            this.logger.merge(`Conflict resolved successfully for "${task.name}"`);
            return { taskId: task.id, branch: task.worktreeBranch!, status: "merged" };
          }

          // Agent didn't fully resolve — abort
          execSync("git merge --abort", { cwd: this.repoRoot, stdio: "pipe" });
          return {
            taskId: task.id,
            branch: task.worktreeBranch!,
            status: "conflict",
            conflictFiles: actualConflicts,
            error: "Agent did not fully resolve conflicts",
          };
        } catch {
          return {
            taskId: task.id,
            branch: task.worktreeBranch!,
            status: "failed",
            error: "Failed to check merge status after resolution",
          };
        }
      }

      // Agent failed — abort the merge
      try { execSync("git merge --abort", { cwd: this.repoRoot, stdio: "pipe" }); } catch {}
      return {
        taskId: task.id,
        branch: task.worktreeBranch!,
        status: "conflict",
        conflictFiles: actualConflicts,
        error: `Resolution agent failed: ${result.error || "unknown"}`,
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      try { execSync("git merge --abort", { cwd: this.repoRoot, stdio: "pipe" }); } catch {}
      return {
        taskId: task.id,
        branch: task.worktreeBranch!,
        status: "failed",
        error: `Conflict resolution error: ${msg}`,
      };
    }
  }
}
