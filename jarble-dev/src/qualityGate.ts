import { execSync } from "child_process";
import type { QualityReport, Task } from "./types.js";
import type { Logger } from "./logger.js";
import type { WorktreeManager } from "./worktreeManager.js";

export class QualityGate {
  private logger: Logger;
  private worktreeManager: WorktreeManager;

  constructor(logger: Logger, worktreeManager: WorktreeManager) {
    this.logger = logger;
    this.worktreeManager = worktreeManager;
  }

  /** Run quality checks on a task's worktree */
  async check(task: Task): Promise<QualityReport> {
    const wt = this.worktreeManager.get(task.id);
    if (!wt) {
      return {
        taskId: task.id,
        branch: task.worktreeBranch || "unknown",
        typecheckPassed: false,
        typecheckErrors: ["No worktree found"],
        testsPassed: false,
        timestamp: new Date(),
      };
    }

    this.logger.quality(`Running quality gates for "${task.name}"`, { taskId: task.id });

    const report: QualityReport = {
      taskId: task.id,
      branch: wt.branch,
      typecheckPassed: false,
      testsPassed: false,
      timestamp: new Date(),
    };

    // Determine which packages were touched
    const touchedDirs = this.detectTouchedPackages(task.touchesFiles);

    // Run typecheck for each touched package
    const typecheckErrors: string[] = [];
    for (const dir of touchedDirs) {
      const result = this.runTypecheck(wt.path, dir);
      if (!result.passed) {
        typecheckErrors.push(...result.errors);
      }
    }

    report.typecheckPassed = typecheckErrors.length === 0;
    report.typecheckErrors = typecheckErrors.length > 0 ? typecheckErrors : undefined;

    if (report.typecheckPassed) {
      this.logger.quality(`Typecheck passed for "${task.name}"`);
    } else {
      this.logger.quality(`Typecheck failed for "${task.name}"`, {
        errorCount: typecheckErrors.length,
      });
    }

    // Run tests for each touched package
    const testFailures: string[] = [];
    for (const dir of touchedDirs) {
      const result = this.runTests(wt.path, dir);
      if (!result.passed) {
        testFailures.push(...result.failures);
      }
    }

    report.testsPassed = testFailures.length === 0;
    report.testFailures = testFailures.length > 0 ? testFailures : undefined;

    if (report.testsPassed) {
      this.logger.quality(`Tests passed for "${task.name}"`);
    } else {
      this.logger.quality(`Tests failed for "${task.name}"`, {
        failureCount: testFailures.length,
      });
    }

    return report;
  }

  /** Detect which monorepo packages are affected by the touched files */
  private detectTouchedPackages(files: string[]): string[] {
    const packages = new Set<string>();

    for (const file of files) {
      if (file.startsWith("jarble-api-main/") || file.startsWith("jarble-api-main\\")) {
        packages.add("jarble-api-main");
      } else if (file.startsWith("Jarble-mvp/") || file.startsWith("Jarble-mvp\\")) {
        packages.add("Jarble-mvp");
      } else if (file.startsWith("shared/") || file.startsWith("shared\\")) {
        // Shared affects both
        packages.add("jarble-api-main");
        packages.add("Jarble-mvp");
      } else if (file.startsWith("jarble-dev/") || file.startsWith("jarble-dev\\")) {
        packages.add("jarble-dev");
      }
    }

    // Default: check the package we're in if nothing specific detected
    if (packages.size === 0) {
      packages.add("jarble-dev");
    }

    return [...packages];
  }

  /** Run TypeScript typecheck in a package directory */
  private runTypecheck(worktreePath: string, packageDir: string): { passed: boolean; errors: string[] } {
    const cwd = `${worktreePath}/${packageDir}`;
    try {
      execSync("npx tsc --noEmit 2>&1", {
        cwd,
        encoding: "utf-8",
        timeout: 120_000,
      });
      return { passed: true, errors: [] };
    } catch (e: unknown) {
      const output = e instanceof Error && "stdout" in e ? (e as { stdout: string }).stdout : String(e);
      const errors = output
        .split("\n")
        .filter((l: string) => l.includes("error TS"))
        .slice(0, 20); // Cap at 20 errors
      return { passed: false, errors: [`[${packageDir}]`, ...errors] };
    }
  }

  /** Run Vitest tests in a package directory */
  private runTests(worktreePath: string, packageDir: string): { passed: boolean; failures: string[] } {
    const cwd = `${worktreePath}/${packageDir}`;
    try {
      execSync("npx vitest run --reporter=verbose 2>&1", {
        cwd,
        encoding: "utf-8",
        timeout: 300_000, // 5 min for tests
      });
      return { passed: true, failures: [] };
    } catch (e: unknown) {
      const output = e instanceof Error && "stdout" in e ? (e as { stdout: string }).stdout : String(e);
      const failures = output
        .split("\n")
        .filter((l: string) => l.includes("FAIL") || l.includes("✗") || l.includes("×"))
        .slice(0, 20);
      return { passed: false, failures: [`[${packageDir}]`, ...failures] };
    }
  }

  /** Quick lint check — just typecheck, no tests */
  async quickCheck(task: Task): Promise<{ passed: boolean; errors: string[] }> {
    const wt = this.worktreeManager.get(task.id);
    if (!wt) return { passed: false, errors: ["No worktree"] };

    const touchedDirs = this.detectTouchedPackages(task.touchesFiles);
    const errors: string[] = [];
    for (const dir of touchedDirs) {
      const result = this.runTypecheck(wt.path, dir);
      if (!result.passed) errors.push(...result.errors);
    }
    return { passed: errors.length === 0, errors };
  }
}
