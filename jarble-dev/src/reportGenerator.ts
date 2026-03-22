import fs from "fs";
import path from "path";
import chalk from "chalk";
import { Monitor } from "./monitor.js";
import { StateStore } from "./stateStore.js";
import type { OrchestratorState } from "./types.js";

export class ReportGenerator {
  /** Generate a formatted report from a saved state */
  static fromState(state: OrchestratorState): string {
    const lines: string[] = [];

    // Header
    const totalDuration = state.completedAt
      ? Monitor.formatDuration(state.completedAt.getTime() - state.startedAt.getTime())
      : "in progress";
    const totalCost = [...state.agents.values()].reduce((s, a) => s + a.costUsd, 0);
    const totalTokensIn = [...state.agents.values()].reduce((s, a) => s + a.tokensIn, 0);
    const totalTokensOut = [...state.agents.values()].reduce((s, a) => s + a.tokensOut, 0);

    lines.push(chalk.bold("\n  Run Report\n"));
    lines.push(`  Run ID:     ${chalk.cyan(state.runId)}`);
    lines.push(`  Started:    ${chalk.dim(state.startedAt.toISOString())}`);
    if (state.completedAt) {
      lines.push(`  Completed:  ${chalk.dim(state.completedAt.toISOString())}`);
    }
    lines.push(`  Duration:   ${chalk.yellow(totalDuration)}`);
    lines.push("");

    // Summary
    const done = state.tasks.filter(t => t.status === "done").length;
    const failed = state.tasks.filter(t => t.status === "failed").length;
    const skipped = state.tasks.filter(t => t.status === "skipped").length;
    const pending = state.tasks.filter(t => t.status === "pending").length;

    lines.push(chalk.bold("  Summary"));
    lines.push(`  Tasks:      ${state.tasks.length} total — ${chalk.green(String(done))} done, ${chalk.red(String(failed))} failed, ${chalk.yellow(String(skipped))} skipped, ${chalk.dim(String(pending))} pending`);
    lines.push(`  Total cost: ${chalk.yellow("$" + totalCost.toFixed(4))}`);
    lines.push(`  Tokens:     ${chalk.dim(totalTokensIn.toLocaleString() + " in / " + totalTokensOut.toLocaleString() + " out")}`);
    lines.push("");

    // Per-task breakdown
    lines.push(chalk.bold("  Tasks"));
    const sep = "  " + "-".repeat(90);
    lines.push(sep);
    lines.push(chalk.dim("  " + "Name".padEnd(30) + "Status".padEnd(10) + "Duration".padEnd(12) + "Cost".padEnd(12) + "Tokens In".padEnd(14) + "Tokens Out"));
    lines.push(sep);

    for (const task of state.tasks) {
      const agent = task.agentId ? state.agents.get(task.agentId) : undefined;
      const dur = task.startedAt && task.completedAt
        ? Monitor.formatDuration(task.completedAt.getTime() - task.startedAt.getTime())
        : "-";
      const cost = agent ? "$" + agent.costUsd.toFixed(4) : "-";
      const tokIn = agent ? agent.tokensIn.toLocaleString() : "-";
      const tokOut = agent ? agent.tokensOut.toLocaleString() : "-";

      const statusColor = {
        done: chalk.green,
        failed: chalk.red,
        skipped: chalk.yellow,
        pending: chalk.dim,
        running: chalk.cyan,
        blocked: chalk.dim,
      }[task.status] || chalk.dim;

      const retryTag = task.retryCount ? ` (r${task.retryCount})` : "";

      lines.push(
        "  " +
        task.name.slice(0, 29).padEnd(30) +
        statusColor((task.status + retryTag).padEnd(10)) +
        dur.padEnd(12) +
        cost.padEnd(12) +
        tokIn.padEnd(14) +
        tokOut
      );

      if (task.error) {
        lines.push(chalk.red("    Error: " + task.error.slice(0, 80)));
      }
    }

    lines.push(sep);

    // Quality reports
    if (state.qualityReports.length > 0) {
      lines.push("");
      lines.push(chalk.bold("  Quality Gates"));
      for (const report of state.qualityReports) {
        const task = state.tasks.find(t => t.id === report.taskId);
        const tc = report.typecheckPassed ? chalk.green("pass") : chalk.red("FAIL");
        const test = report.testsPassed ? chalk.green("pass") : chalk.red("FAIL");
        lines.push(`  ${(task?.name || report.taskId).padEnd(30)} typecheck: ${tc}  tests: ${test}`);
      }
    }

    // Merge results
    if (state.mergeResults.length > 0) {
      lines.push("");
      lines.push(chalk.bold("  Merge Results"));
      for (const r of state.mergeResults) {
        const icon = r.status === "merged" ? chalk.green("ok") : r.status === "conflict" ? chalk.yellow("conflict") : chalk.red("FAIL");
        lines.push(`  ${r.branch.padEnd(60)} ${icon}`);
        if (r.conflictFiles) {
          for (const f of r.conflictFiles) {
            lines.push(chalk.dim(`    conflict: ${f}`));
          }
        }
      }
    }

    // Cost efficiency
    if (done > 0 && totalCost > 0) {
      lines.push("");
      lines.push(chalk.bold("  Cost Efficiency"));
      lines.push(`  Avg cost/task:  $${(totalCost / state.tasks.length).toFixed(4)}`);
      lines.push(`  Cost/success:   $${(totalCost / done).toFixed(4)}`);
      if (state.completedAt) {
        const durationMin = (state.completedAt.getTime() - state.startedAt.getTime()) / 60_000;
        lines.push(`  Cost/minute:    $${(totalCost / durationMin).toFixed(4)}`);
      }
    }

    lines.push("");
    return lines.join("\n");
  }

  /** Generate a JSON report (for CI/machine consumption) */
  static toJSON(state: OrchestratorState): object {
    const totalCost = [...state.agents.values()].reduce((s, a) => s + a.costUsd, 0);
    const totalTokensIn = [...state.agents.values()].reduce((s, a) => s + a.tokensIn, 0);
    const totalTokensOut = [...state.agents.values()].reduce((s, a) => s + a.tokensOut, 0);

    return {
      runId: state.runId,
      startedAt: state.startedAt.toISOString(),
      completedAt: state.completedAt?.toISOString(),
      durationMs: state.completedAt
        ? state.completedAt.getTime() - state.startedAt.getTime()
        : null,
      summary: {
        total: state.tasks.length,
        done: state.tasks.filter(t => t.status === "done").length,
        failed: state.tasks.filter(t => t.status === "failed").length,
        skipped: state.tasks.filter(t => t.status === "skipped").length,
        totalCostUsd: totalCost,
        totalTokensIn,
        totalTokensOut,
      },
      tasks: state.tasks.map(t => {
        const agent = t.agentId ? state.agents.get(t.agentId) : undefined;
        return {
          name: t.name,
          status: t.status,
          durationMs: t.startedAt && t.completedAt
            ? t.completedAt.getTime() - t.startedAt.getTime()
            : null,
          costUsd: agent?.costUsd || 0,
          tokensIn: agent?.tokensIn || 0,
          tokensOut: agent?.tokensOut || 0,
          retryCount: t.retryCount || 0,
          error: t.error,
        };
      }),
      qualityReports: state.qualityReports.map(r => ({
        taskId: r.taskId,
        typecheckPassed: r.typecheckPassed,
        testsPassed: r.testsPassed,
      })),
      mergeResults: state.mergeResults.map(r => ({
        taskId: r.taskId,
        branch: r.branch,
        status: r.status,
        conflictFiles: r.conflictFiles,
        error: r.error,
      })),
    };
  }

  /** Load state and generate report */
  static loadAndReport(logDir: string, runId?: string): { state: OrchestratorState; report: string } | null {
    let store: StateStore | null;
    if (runId) {
      store = new StateStore(logDir, runId);
    } else {
      store = StateStore.findLatest(logDir);
    }
    if (!store) return null;

    const state = store.load();
    if (!state) return null;

    return { state, report: ReportGenerator.fromState(state) };
  }

  /** Cross-run analytics from all saved state files */
  static aggregateHistory(logDir: string): string {
    const lines: string[] = [];

    try {
      const files = fs.readdirSync(logDir)
        .filter(f => f.startsWith("state-") && f.endsWith(".json"))
        .sort()
        .reverse();

      if (files.length === 0) {
        return chalk.dim("  No saved runs found.");
      }

      lines.push(chalk.bold("\n  Run History\n"));
      lines.push(chalk.dim("  " + "Run ID".padEnd(12) + "Tasks".padEnd(8) + "Done".padEnd(8) + "Failed".padEnd(8) + "Cost".padEnd(12) + "Duration"));
      lines.push("  " + "-".repeat(70));

      let totalCostAll = 0;
      let totalTasksAll = 0;
      let totalDoneAll = 0;

      for (const file of files.slice(0, 20)) {
        const match = file.match(/state-(.+)\.json/);
        if (!match) continue;

        try {
          const store = new StateStore(logDir, match[1]);
          const state = store.load();
          if (!state) continue;

          const cost = [...state.agents.values()].reduce((s, a) => s + a.costUsd, 0);
          const done = state.tasks.filter(t => t.status === "done").length;
          const failed = state.tasks.filter(t => t.status === "failed").length;
          const dur = state.completedAt
            ? Monitor.formatDuration(state.completedAt.getTime() - state.startedAt.getTime())
            : "incomplete";

          totalCostAll += cost;
          totalTasksAll += state.tasks.length;
          totalDoneAll += done;

          lines.push(
            "  " +
            match[1].padEnd(12) +
            String(state.tasks.length).padEnd(8) +
            chalk.green(String(done).padEnd(8)) +
            (failed > 0 ? chalk.red(String(failed).padEnd(8)) : chalk.dim("0".padEnd(8))) +
            ("$" + cost.toFixed(4)).padEnd(12) +
            dur
          );
        } catch { /* skip corrupted state files */ }
      }

      if (files.length > 0) {
        lines.push("  " + "-".repeat(70));
        lines.push(
          chalk.bold("  Totals".padEnd(14)) +
          String(totalTasksAll).padEnd(8) +
          chalk.green(String(totalDoneAll).padEnd(8)) +
          chalk.dim("".padEnd(8)) +
          chalk.yellow("$" + totalCostAll.toFixed(4))
        );
        lines.push(`  Success rate: ${chalk.green((totalDoneAll / Math.max(totalTasksAll, 1) * 100).toFixed(1) + "%")}`);
      }

      lines.push("");
    } catch {
      return chalk.dim("  Failed to read log directory.");
    }

    return lines.join("\n");
  }
}
