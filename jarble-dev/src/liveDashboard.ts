import chalk from "chalk";
import type { OrchestratorState, AgentProcess } from "./types.js";
import type { Logger } from "./logger.js";
import { Monitor } from "./monitor.js";
import { EventEmitter } from "events";
import readline from "readline";

interface AgentOutputEvent {
  agentId: string;
  taskName: string;
  line: string;
}

/**
 * Live terminal dashboard using ANSI escape codes.
 * Redraws the full screen every refreshInterval with task status + agent output.
 */
export class LiveDashboard {
  private logger: Logger;
  private state: OrchestratorState;
  private intervalHandle?: ReturnType<typeof setInterval>;
  private refreshMs: number;
  private agentOutputBuffer: Map<string, string[]> = new Map();
  private maxOutputLines = 8;
  private events: EventEmitter;
  private rl?: readline.Interface;
  private onKill?: (agentId: string) => void;

  constructor(logger: Logger, state: OrchestratorState, events: EventEmitter, refreshMs = 1000) {
    this.logger = logger;
    this.state = state;
    this.events = events;
    this.refreshMs = refreshMs;

    events.on("agent:output", (evt: AgentOutputEvent) => {
      if (!this.agentOutputBuffer.has(evt.agentId)) {
        this.agentOutputBuffer.set(evt.agentId, []);
      }
      const buf = this.agentOutputBuffer.get(evt.agentId)!;
      buf.push(`${chalk.dim(evt.taskName)} ${evt.line}`);
      if (buf.length > this.maxOutputLines * 3) {
        buf.splice(0, buf.length - this.maxOutputLines * 3);
      }
    });
  }

  start(opts?: { onKill?: (agentId: string) => void }) {
    this.onKill = opts?.onKill;

    // Set up keyboard listener
    if (process.stdin.isTTY) {
      this.rl = readline.createInterface({ input: process.stdin });
      readline.emitKeypressEvents(process.stdin, this.rl);
      if (process.stdin.setRawMode) {
        process.stdin.setRawMode(true);
      }
      process.stdin.on("keypress", (_ch: string, key: readline.Key) => {
        if (key?.name === "q" || (key?.ctrl && key?.name === "c")) {
          this.stop();
          process.emit("SIGINT");
        }
      });
    }

    // Start refresh loop
    this.intervalHandle = setInterval(() => this.render(), this.refreshMs);
    this.render(); // initial render
  }

  stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
    if (process.stdin.setRawMode) {
      process.stdin.setRawMode(false);
    }
    this.rl?.close();
  }

  private render() {
    const { tasks } = this.state;
    const cols = process.stdout.columns || 100;
    const rows = process.stdout.rows || 30;

    // Clear screen
    process.stdout.write("\x1B[2J\x1B[H");

    // Header
    const elapsed = Monitor.formatDuration(Date.now() - this.state.startedAt.getTime());
    const totalCost = [...this.state.agents.values()].reduce((s, a) => s + a.costUsd, 0);

    process.stdout.write(
      chalk.bold(" jarble-dev") +
      chalk.dim(` | run ${this.state.runId} | ${elapsed} | $${totalCost.toFixed(4)}`) +
      "\n"
    );
    process.stdout.write(chalk.dim("─".repeat(Math.min(cols, 120))) + "\n");

    // Task table
    const pending = tasks.filter(t => t.status === "pending").length;
    const running = tasks.filter(t => t.status === "running").length;
    const done = tasks.filter(t => t.status === "done").length;
    const failed = tasks.filter(t => t.status === "failed" || t.status === "skipped").length;

    process.stdout.write(
      ` ${chalk.yellow(String(pending))} pending  ` +
      `${chalk.cyan(String(running))} running  ` +
      `${chalk.green(String(done))} done  ` +
      `${chalk.red(String(failed))} failed\n\n`
    );

    // Task list
    const taskColWidth = Math.min(35, Math.floor(cols * 0.35));
    process.stdout.write(
      chalk.dim(
        " " +
        "Task".padEnd(taskColWidth) +
        "Status".padEnd(10) +
        "Time".padEnd(10) +
        "Cost".padEnd(10) +
        "Retry"
      ) + "\n"
    );

    for (const t of tasks) {
      const statusColor = {
        pending: chalk.dim, running: chalk.cyan, done: chalk.green,
        failed: chalk.red, skipped: chalk.yellow, blocked: chalk.dim,
      }[t.status] || chalk.dim;

      const dur = t.startedAt
        ? Monitor.formatDuration((t.completedAt || new Date()).getTime() - t.startedAt.getTime())
        : "-";

      const agent = t.agentId ? this.state.agents.get(t.agentId) : undefined;
      const cost = agent ? `$${agent.costUsd.toFixed(3)}` : "-";
      const retry = t.retryCount ? `${t.retryCount}/${this.state.tasks.length > 0 ? "1" : "0"}` : "-";

      const indicator = t.status === "running" ? chalk.cyan("▸ ") : "  ";
      process.stdout.write(
        indicator +
        t.name.slice(0, taskColWidth - 1).padEnd(taskColWidth) +
        statusColor(t.status.padEnd(10)) +
        dur.padEnd(10) +
        cost.padEnd(10) +
        retry + "\n"
      );
    }

    // Agent output section
    const runningAgents = [...this.state.agents.values()].filter(a => a.status === "running");
    if (runningAgents.length > 0) {
      process.stdout.write("\n" + chalk.dim("─".repeat(Math.min(cols, 120))) + "\n");
      process.stdout.write(chalk.bold(" Agent Output") + "\n\n");

      const linesPerAgent = Math.max(3, Math.floor((rows - tasks.length - 12) / runningAgents.length));

      for (const agent of runningAgents) {
        const task = tasks.find(t => t.id === agent.taskId);
        const taskName = task?.name || agent.taskId;
        const buffer = this.agentOutputBuffer.get(agent.id) || [];
        const recentLines = buffer.slice(-linesPerAgent);

        process.stdout.write(chalk.cyan(` [${taskName}]`) + "\n");
        for (const line of recentLines) {
          const trimmed = line.slice(0, cols - 4);
          process.stdout.write(chalk.dim(`   ${trimmed}`) + "\n");
        }
      }
    }

    // Footer
    process.stdout.write("\n" + chalk.dim(" q: quit") + "\n");
  }
}
