import fs from "fs";
import path from "path";
import chalk from "chalk";

export type LogLevel = "debug" | "info" | "warn" | "error" | "agent" | "merge" | "quality";

const LEVEL_COLORS: Record<LogLevel, (s: string) => string> = {
  debug: chalk.gray,
  info: chalk.blue,
  warn: chalk.yellow,
  error: chalk.red,
  agent: chalk.cyan,
  merge: chalk.magenta,
  quality: chalk.green,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: "DBG",
  info: "INF",
  warn: "WRN",
  error: "ERR",
  agent: "AGT",
  merge: "MRG",
  quality: "QAL",
};

export class Logger {
  private logDir: string;
  private mainStream: fs.WriteStream;
  private agentStreams: Map<string, fs.WriteStream> = new Map();
  private verbose: boolean;

  constructor(logDir: string, verbose = false) {
    this.logDir = logDir;
    this.verbose = verbose;
    fs.mkdirSync(logDir, { recursive: true });
    this.mainStream = fs.createWriteStream(
      path.join(logDir, `run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`),
      { flags: "a" }
    );
  }

  private timestamp(): string {
    return new Date().toISOString().slice(11, 23);
  }

  private write(level: LogLevel, message: string, context?: Record<string, unknown>) {
    const ts = this.timestamp();
    const label = LEVEL_LABELS[level];
    const contextStr = context ? ` ${JSON.stringify(context)}` : "";
    const raw = `[${ts}] ${label} ${message}${contextStr}\n`;

    // Always write to file
    this.mainStream.write(raw);

    // Console output
    if (level !== "debug" || this.verbose) {
      const colorFn = LEVEL_COLORS[level];
      const prefix = colorFn(`[${label}]`);
      const formatted = `${chalk.dim(ts)} ${prefix} ${message}`;
      if (level === "error") {
        console.error(formatted);
      } else {
        console.log(formatted);
      }
    }
  }

  /** Get or create a per-agent log stream */
  getAgentStream(agentId: string, taskName: string): fs.WriteStream {
    if (!this.agentStreams.has(agentId)) {
      const safeName = taskName.replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 50);
      const filePath = path.join(this.logDir, `agent-${safeName}-${agentId.slice(0, 8)}.log`);
      const stream = fs.createWriteStream(filePath, { flags: "a" });
      this.agentStreams.set(agentId, stream);
    }
    return this.agentStreams.get(agentId)!;
  }

  /** Write a line to a specific agent's log */
  agentLog(agentId: string, taskName: string, line: string) {
    const stream = this.getAgentStream(agentId, taskName);
    stream.write(`[${this.timestamp()}] ${line}\n`);
  }

  debug(msg: string, ctx?: Record<string, unknown>) { this.write("debug", msg, ctx); }
  info(msg: string, ctx?: Record<string, unknown>) { this.write("info", msg, ctx); }
  warn(msg: string, ctx?: Record<string, unknown>) { this.write("warn", msg, ctx); }
  error(msg: string, ctx?: Record<string, unknown>) { this.write("error", msg, ctx); }
  agent(msg: string, ctx?: Record<string, unknown>) { this.write("agent", msg, ctx); }
  merge(msg: string, ctx?: Record<string, unknown>) { this.write("merge", msg, ctx); }
  quality(msg: string, ctx?: Record<string, unknown>) { this.write("quality", msg, ctx); }

  /** Summary table at end of run */
  summary(rows: { task: string; status: string; duration: string; cost: string }[]) {
    const header = `${"Task".padEnd(40)} ${"Status".padEnd(10)} ${"Duration".padEnd(12)} Cost`;
    const sep = "-".repeat(header.length);
    console.log("\n" + chalk.bold("Run Summary"));
    console.log(sep);
    console.log(chalk.dim(header));
    console.log(sep);
    for (const r of rows) {
      const statusColor = r.status === "done" ? chalk.green : r.status === "failed" ? chalk.red : chalk.yellow;
      console.log(`${r.task.padEnd(40)} ${statusColor(r.status.padEnd(10))} ${r.duration.padEnd(12)} ${r.cost}`);
    }
    console.log(sep);
  }

  /** Flush all streams */
  async close() {
    this.mainStream.end();
    for (const stream of this.agentStreams.values()) {
      stream.end();
    }
  }
}
