import { EventEmitter } from "events";
import type { BudgetStatus } from "./types.js";
import type { Logger } from "./logger.js";

export class BudgetGuard extends EventEmitter {
  private limit: number; // 0 = unlimited
  private warningThreshold: number;
  private spent: number = 0;
  private paused: boolean = false;
  private warningEmitted: boolean = false;
  private logger: Logger;

  constructor(limit: number, warningThreshold: number, logger: Logger) {
    super();
    this.limit = limit;
    this.warningThreshold = warningThreshold;
    this.logger = logger;

    if (limit > 0) {
      this.logger.info(
        `Budget guard active: $${limit.toFixed(2)} limit, warning at ${(warningThreshold * 100).toFixed(0)}%`,
      );
    }
  }

  /** Record cost from a completed or in-progress agent */
  recordCost(agentId: string, taskName: string, costUsd: number): void {
    this.spent += costUsd;

    if (
      this.limit > 0 &&
      this.spent >= this.limit * this.warningThreshold &&
      !this.warningEmitted
    ) {
      this.logger.warn(
        `Budget warning: $${this.spent.toFixed(2)} / $${this.limit.toFixed(2)} spent (${((this.spent / this.limit) * 100).toFixed(1)}%) — triggered by agent ${agentId} (${taskName})`,
      );
      this.warningEmitted = true;
      this.emit("budget:warning", this.getStatus());
    }

    if (this.limit > 0 && this.spent >= this.limit) {
      this.logger.error(
        `Budget exceeded: $${this.spent.toFixed(2)} / $${this.limit.toFixed(2)} — pausing new agent spawns`,
      );
      this.paused = true;
      this.emit("budget:exceeded", this.getStatus());
    }
  }

  /** Check if we can spawn more agents */
  canSpawn(): boolean {
    if (this.limit === 0) return true;
    return !this.paused;
  }

  /** Get remaining budget (Infinity if unlimited) */
  remaining(): number {
    return this.limit === 0 ? Infinity : Math.max(0, this.limit - this.spent);
  }

  /** Get the per-agent budget cap (remaining / expected agents, or default) */
  perAgentBudget(defaultBudget: number, remainingTasks: number): number {
    if (this.limit === 0) return defaultBudget;
    return Math.min(defaultBudget, this.remaining() / Math.max(remainingTasks, 1));
  }

  /** Get full status */
  getStatus(): BudgetStatus {
    return {
      spent: this.spent,
      limit: this.limit,
      remaining: this.remaining(),
      percent: this.limit > 0 ? (this.spent / this.limit) * 100 : 0,
      paused: this.paused,
    };
  }

  /** Reset (for testing or re-runs) */
  reset(): void {
    this.spent = 0;
    this.paused = false;
    this.warningEmitted = false;
  }
}
