/**
 * Structured QA Logger
 *
 * Writes timestamped JSON log entries for every QA action.
 * Each cycle gets its own log file. A persistent history file
 * tracks run summaries across all cycles for trend analysis.
 *
 * Log levels: INFO, WARN, ERROR, PASS, FAIL, SKIP
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, appendFileSync } from "fs";
import { join } from "path";

const LOGS_DIR = join(import.meta.dirname, "..", "logs");
const HISTORY_FILE = join(LOGS_DIR, "run-history.jsonl");

export class QALogger {
  constructor(cycleId) {
    mkdirSync(LOGS_DIR, { recursive: true });

    this.cycleId = cycleId;
    this.startTime = Date.now();
    this.entries = [];
    this.logFile = join(LOGS_DIR, `${cycleId}.json`);

    this.log("INFO", "cycle", "QA cycle started", { cycleId });
  }

  /**
   * Log a structured entry.
   * @param {"INFO"|"WARN"|"ERROR"|"PASS"|"FAIL"|"SKIP"} level
   * @param {string} phase - Which phase (discovery, auth, dispatch, agent, healer, reporter, memory)
   * @param {string} message - Human-readable description
   * @param {object} [data] - Structured data for this entry
   */
  log(level, phase, message, data = {}) {
    const entry = {
      timestamp: new Date().toISOString(),
      elapsed: `${((Date.now() - this.startTime) / 1000).toFixed(1)}s`,
      level,
      phase,
      message,
      ...data,
    };

    this.entries.push(entry);

    // Console output with color
    const colors = {
      INFO: "\x1b[36m",   // cyan
      WARN: "\x1b[33m",   // yellow
      ERROR: "\x1b[31m",  // red
      PASS: "\x1b[32m",   // green
      FAIL: "\x1b[31m",   // red
      SKIP: "\x1b[90m",   // gray
    };
    const reset = "\x1b[0m";
    const color = colors[level] || "";
    const elapsed = entry.elapsed.padStart(7);
    console.log(`  ${color}[${elapsed}] [${level.padEnd(5)}] [${phase}]${reset} ${message}`);
  }

  /** Log the start of an agent dispatch */
  agentStart(agentName, goal) {
    this.log("INFO", "dispatch", `Spawning ${agentName}`, { agent: agentName, goal });
  }

  /** Log agent completion with result */
  agentEnd(agentName, status, details = {}) {
    const level = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : status === "WARN" ? "WARN" : "INFO";
    this.log(level, "agent", `${agentName} completed: ${status}`, { agent: agentName, status, ...details });
  }

  /** Log a test goal result */
  goalResult(goal, status, details = {}) {
    const level = status === "PASS" ? "PASS" : status === "FAIL" ? "FAIL" : status === "WARN" ? "WARN" : "SKIP";
    this.log(level, "result", `${goal}: ${status}`, { goal, status, ...details });
  }

  /** Log healer action */
  healerAction(failure, classification, action) {
    this.log("INFO", "healer", `${classification}: ${action}`, { failure, classification, action });
  }

  /** Log an error with context */
  error(phase, message, err = {}) {
    this.log("ERROR", phase, message, { error: err.message || String(err), stack: err.stack });
  }

  /**
   * Finalize the cycle — write log file and append to history.
   * @param {object} summary - { total, passed, failed, warned, skipped }
   */
  finalize(summary = {}) {
    const duration = ((Date.now() - this.startTime) / 1000).toFixed(1);
    this.log("INFO", "cycle", `QA cycle completed in ${duration}s`, summary);

    // Write full log
    const logData = {
      cycleId: this.cycleId,
      startTime: new Date(this.startTime).toISOString(),
      duration: parseFloat(duration),
      summary,
      entries: this.entries,
    };
    writeFileSync(this.logFile, JSON.stringify(logData, null, 2));

    // Append summary to history (one line per run for trend analysis)
    const historyEntry = {
      cycleId: this.cycleId,
      timestamp: new Date(this.startTime).toISOString(),
      duration: parseFloat(duration),
      ...summary,
      errorCount: this.entries.filter(e => e.level === "ERROR").length,
    };
    appendFileSync(HISTORY_FILE, JSON.stringify(historyEntry) + "\n");

    return this.logFile;
  }
}

/**
 * Read the run history for trend analysis.
 * Returns an array of summary objects, one per cycle.
 */
export function readRunHistory() {
  if (!existsSync(HISTORY_FILE)) return [];
  return readFileSync(HISTORY_FILE, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map(line => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Read a specific cycle's full log.
 */
export function readCycleLog(cycleId) {
  const file = join(LOGS_DIR, `${cycleId}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf-8"));
}
