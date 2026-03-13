import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import type { Task } from "./types.js";
import type { Logger } from "./logger.js";

/**
 * Determines which tasks can be skipped based on git changes since the last
 * successful run. Tasks whose touchesFiles haven't changed get marked as
 * 'skipped'.
 */
export class IncrementalChecker {
  private repoRoot: string;
  private logDir: string;
  private logger: Logger;

  constructor(repoRoot: string, logDir: string, logger: Logger) {
    this.repoRoot = repoRoot;
    this.logDir = logDir;
    this.logger = logger;
  }

  /** Get the commit hash from the last successful run */
  getLastSuccessfulCommit(): string | null {
    try {
      const markerPath = path.join(this.logDir, ".last-success-commit");
      if (fs.existsSync(markerPath)) {
        return fs.readFileSync(markerPath, "utf-8").trim();
      }
    } catch {
      // Marker file missing or unreadable
    }
    return null;
  }

  /** Save the current HEAD commit as the last successful run */
  saveSuccessCommit(): void {
    try {
      const hash = execSync("git rev-parse HEAD", {
        cwd: this.repoRoot,
        encoding: "utf-8",
      }).trim();
      const markerPath = path.join(this.logDir, ".last-success-commit");
      fs.writeFileSync(markerPath, hash);
      this.logger.info(`Saved success commit: ${hash.slice(0, 8)}`);
    } catch (e) {
      this.logger.warn(`Failed to save success commit: ${e}`);
    }
  }

  /** Get files changed between a specific commit and HEAD */
  getChangedFiles(sinceCommit: string): string[] {
    try {
      const output = execSync(
        `git diff --name-only ${sinceCommit}..HEAD`,
        {
          cwd: this.repoRoot,
          encoding: "utf-8",
          maxBuffer: 5 * 1024 * 1024,
        },
      );
      return output.trim().split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  /**
   * Mark tasks as skipped if none of their touchesFiles have changed since
   * the last successful run. Uses prefix matching so directory entries like
   * "jarble-api-main/src/trpc/" match changed files underneath them.
   */
  markUnchangedTasks(
    tasks: Task[],
  ): { skipped: string[]; running: string[] } {
    const lastCommit = this.getLastSuccessfulCommit();
    if (!lastCommit) {
      this.logger.info(
        "No previous successful run found — running all tasks",
      );
      return { skipped: [], running: tasks.map((t) => t.name) };
    }

    const changedFiles = this.getChangedFiles(lastCommit);
    this.logger.info(
      `${changedFiles.length} files changed since last success (${lastCommit.slice(0, 8)})`,
    );

    const skipped: string[] = [];
    const running: string[] = [];

    for (const task of tasks) {
      if (task.touchesFiles.length === 0) {
        running.push(task.name);
        continue;
      }

      const hasChanges = task.touchesFiles.some((tf) =>
        changedFiles.some(
          (cf) => cf.startsWith(tf) || tf.startsWith(cf) || cf === tf,
        ),
      );

      if (hasChanges) {
        running.push(task.name);
      } else {
        task.status = "skipped";
        skipped.push(task.name);
        this.logger.info(`Skipping unchanged task: "${task.name}"`);
      }
    }

    return { skipped, running };
  }
}
