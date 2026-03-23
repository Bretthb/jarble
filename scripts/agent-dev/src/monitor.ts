import type { AgentProcess, OrchestratorState } from "./types.js";
import type { Logger } from "./logger.js";
import chalk from "chalk";

export class Monitor {
  private logger: Logger;
  private intervalHandle?: ReturnType<typeof setInterval>;
  private refreshIntervalMs: number;

  constructor(logger: Logger, refreshIntervalMs = 5000) {
    this.logger = logger;
    this.refreshIntervalMs = refreshIntervalMs;
  }

  /** Start periodic status reporting */
  start(state: OrchestratorState) {
    this.intervalHandle = setInterval(() => {
      this.printStatus(state);
    }, this.refreshIntervalMs);
  }

  /** Stop the monitor */
  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  /** Print current status of all tasks and agents */
  printStatus(state: OrchestratorState) {
    const tasks = state.tasks;
    const pending = tasks.filter(t => t.status === "pending").length;
    const blocked = tasks.filter(t => t.status === "blocked").length;
    const running = tasks.filter(t => t.status === "running").length;
    const done = tasks.filter(t => t.status === "done").length;
    const failed = tasks.filter(t => t.status === "failed").length;

    const totalCost = [...state.agents.values()].reduce((sum, a) => sum + a.costUsd, 0);

    const elapsed = Math.round((Date.now() - state.startedAt.getTime()) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;

    console.log(
      chalk.dim(`\n--- Status [${mins}m${secs}s] ---`) +
      `  ${chalk.yellow(String(pending))} pending` +
      `  ${chalk.cyan(String(running))} running` +
      `  ${chalk.green(String(done))} done` +
      `  ${chalk.red(String(failed))} failed` +
      `  ${chalk.dim(`$${totalCost.toFixed(4)}`)}`
    );

    // Show running agents
    for (const agent of state.agents.values()) {
      if (agent.status !== "running") continue;
      const task = tasks.find(t => t.id === agent.taskId);
      const agentElapsed = Math.round((Date.now() - agent.startedAt.getTime()) / 1000);
      console.log(
        chalk.cyan(`  ▸ ${task?.name || agent.taskId}`) +
        chalk.dim(` [${agentElapsed}s, $${agent.costUsd.toFixed(4)}]`)
      );
    }
  }

  /** Format a duration in ms to a human-readable string */
  static formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    const secs = Math.round(ms / 1000);
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    const remSecs = secs % 60;
    return `${mins}m${remSecs}s`;
  }
}
