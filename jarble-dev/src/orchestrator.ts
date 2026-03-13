import { execSync } from "child_process";
import { nanoid } from "nanoid";
import type { JarbleDevConfig, OrchestratorState, Task, TaskPlan, MergeResult, QualityReport, CIEvent } from "./types.js";
import { Logger } from "./logger.js";
import { WorktreeManager } from "./worktreeManager.js";
import { AgentSpawner } from "./agentSpawner.js";
import { Planner } from "./planner.js";
import { Monitor } from "./monitor.js";
import { Merger } from "./merger.js";
import { QualityGate } from "./qualityGate.js";
import { StateStore } from "./stateStore.js";
import { BudgetGuard } from "./budgetGuard.js";
import { Notifier } from "./notifier.js";
import { IncrementalChecker } from "./incrementalChecker.js";
import { ContextBuilder } from "./contextBuilder.js";

export class Orchestrator {
  private config: JarbleDevConfig;
  private logger: Logger;
  private worktreeManager: WorktreeManager;
  private spawner: AgentSpawner;
  private planner: Planner;
  private monitor: Monitor;
  private merger: Merger;
  private qualityGate: QualityGate;
  private stateStore: StateStore;
  private budgetGuard: BudgetGuard;
  private notifier: Notifier;
  private incrementalChecker: IncrementalChecker;
  private state: OrchestratorState;

  constructor(config: JarbleDevConfig, verbose = false) {
    this.config = config;
    this.logger = new Logger(config.logDir, verbose);
    this.worktreeManager = new WorktreeManager(config.repoRoot, config.baseBranch, this.logger);
    this.spawner = new AgentSpawner(config, this.logger);
    this.planner = new Planner(this.logger);
    this.monitor = new Monitor(this.logger);
    this.qualityGate = new QualityGate(this.logger, this.worktreeManager);

    this.state = {
      runId: nanoid(8),
      tasks: [],
      agents: new Map(),
      worktrees: new Map(),
      mergeResults: [],
      qualityReports: [],
      startedAt: new Date(),
    };

    this.merger = new Merger(
      config.repoRoot, this.logger, this.worktreeManager,
      this.spawner, config.autoResolve,
    );
    this.stateStore = new StateStore(config.logDir, this.state.runId);
    this.budgetGuard = new BudgetGuard(
      config.runBudgetUsd, config.budgetWarningThreshold, this.logger,
    );
    this.notifier = new Notifier(config.webhookUrls, this.logger);
    this.notifier.subscribe(this.spawner);
    this.incrementalChecker = new IncrementalChecker(
      config.repoRoot, config.logDir, this.logger,
    );

    // Attach context builder for enriched agent prompts
    const contextBuilder = new ContextBuilder(config, this.logger);
    this.spawner.setContextBuilder(contextBuilder);
  }

  /** Get the spawner's EventEmitter for live dashboard integration */
  get events() {
    return this.spawner;
  }

  /** Execute a full plan: schedule -> spawn -> monitor -> quality -> merge */
  async run(plan: TaskPlan): Promise<OrchestratorState> {
    this.logger.info(`Starting orchestrator run ${this.state.runId}`, {
      plan: plan.name,
      taskCount: plan.tasks.length,
      maxConcurrency: this.config.maxConcurrency,
    });

    // 1. Hydrate the plan into runnable tasks
    this.state.tasks = this.planner.hydratePlan(plan);

    // 2. Validate — check for circular deps
    this.planner.topoSort(this.state.tasks);

    // 2b. Incremental mode — skip unchanged tasks
    if (this.config.incremental) {
      const { skipped, running } = this.incrementalChecker.markUnchangedTasks(this.state.tasks);
      if (skipped.length > 0) {
        this.logger.info(`Incremental: skipping ${skipped.length} unchanged tasks, running ${running.length}`);
      }
    }

    // 3. Warn about file conflicts
    const readyForConflictCheck = this.planner.getReadyTasks(this.state.tasks);
    const conflicts = this.planner.detectFileConflicts(readyForConflictCheck);
    if (conflicts.length > 0) {
      this.logger.warn(`${conflicts.length} potential file conflict(s) detected between concurrent tasks`);
    }

    // CI event: run started
    this.emitCI("run:start", {
      plan: plan.name,
      taskCount: plan.tasks.length,
      maxConcurrency: this.config.maxConcurrency,
    });

    // 4. Start the monitor
    this.monitor.start(this.state);

    // 5. Main execution loop
    try {
      await this.executionLoop();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Orchestrator crashed: ${msg}`);
    }

    // 6. Stop the monitor
    this.monitor.stop();

    // 7. Print final summary
    this.printSummary();

    // 8. Save state and cleanup
    this.state.completedAt = new Date();
    this.stateStore.save(this.state);

    // Incremental: save success commit if all tasks passed
    const allDone = this.state.tasks.every(t => t.status === "done" || t.status === "skipped");
    if (this.config.incremental && allDone) {
      this.incrementalChecker.saveSuccessCommit();
    }

    // CI event: run complete
    this.emitCI("run:complete", {
      tasks: this.state.tasks.length,
      done: this.state.tasks.filter(t => t.status === "done").length,
      failed: this.state.tasks.filter(t => t.status === "failed").length,
      skipped: this.state.tasks.filter(t => t.status === "skipped").length,
      totalCost: [...this.state.agents.values()].reduce((s, a) => s + a.costUsd, 0),
      durationMs: this.state.completedAt.getTime() - this.state.startedAt.getTime(),
    });

    // Flush webhook notifications
    await this.notifier.flush();

    await this.logger.close();

    return this.state;
  }

  /** Resume a previous run from saved state */
  async resume(savedState: OrchestratorState): Promise<OrchestratorState> {
    this.state = savedState;
    this.state.completedAt = undefined; // mark as in-progress
    this.stateStore = new StateStore(this.config.logDir, this.state.runId);

    this.logger.info(`Resuming orchestrator run ${this.state.runId}`, {
      tasks: this.state.tasks.length,
      done: this.state.tasks.filter(t => t.status === "done").length,
      running: this.state.tasks.filter(t => t.status === "running").length,
    });

    // Reset running tasks to pending (they were interrupted)
    for (const task of this.state.tasks) {
      if (task.status === "running") {
        task.status = "pending";
        // Keep the agentId for potential --resume
      }
    }

    this.monitor.start(this.state);

    try {
      await this.executionLoop();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.error(`Orchestrator crashed on resume: ${msg}`);
    }

    this.monitor.stop();
    this.printSummary();
    this.state.completedAt = new Date();
    this.stateStore.save(this.state);
    await this.logger.close();

    return this.state;
  }

  /** The main loop: keep spawning ready tasks until all done or failed */
  private async executionLoop() {
    while (true) {
      const readyTasks = this.planner.getReadyTasks(this.state.tasks);
      const runningCount = this.state.tasks.filter(t => t.status === "running").length;
      const slotsAvailable = this.config.maxConcurrency - runningCount;

      // Budget guard — stop spawning if budget exhausted
      if (!this.budgetGuard.canSpawn()) {
        this.logger.warn("Budget exhausted — waiting for running agents to finish");
        if (runningCount === 0) break;
        // Fall through to wait for running agents
      }

      // Spawn agents for ready tasks (up to concurrency limit)
      const toSpawn = this.budgetGuard.canSpawn()
        ? readyTasks.slice(0, slotsAvailable)
        : [];

      const spawnPromises = toSpawn.map(task => this.spawnTask(task));
      await Promise.all(spawnPromises);

      // Wait for any running agent to complete
      const runningAgents = this.spawner.getActive();
      if (runningAgents.length === 0) {
        // No running agents — check if we're done
        const pending = this.state.tasks.filter(t => t.status === "pending");
        if (pending.length === 0) break;

        // Check if pending tasks are blocked by failed deps or dangling dep IDs
        const allIds = new Set(this.state.tasks.map(t => t.id));
        const failedIds = new Set(
          this.state.tasks.filter(t => t.status === "failed" || t.status === "skipped").map(t => t.id)
        );

        let anySkipped = false;
        for (const t of pending) {
          const hasDanglingDep = t.dependsOn.some(dep => !allIds.has(dep));
          const hasFailedDep = t.dependsOn.some(dep => failedIds.has(dep));

          if (hasDanglingDep) {
            t.status = "failed";
            t.error = `Unknown dependency: ${t.dependsOn.filter(d => !allIds.has(d)).join(", ")}`;
            this.logger.error(`Task "${t.name}" has unknown dependency — marking failed`, { deps: t.dependsOn });
            anySkipped = true;
          } else if (hasFailedDep) {
            t.status = "skipped";
            this.logger.warn(`Skipping task "${t.name}" — dependency failed`);
            anySkipped = true;
          }
        }

        if (anySkipped) continue; // Re-evaluate after marking

        // Truly stuck — no tasks can progress
        this.logger.error("No running agents and no tasks can progress — breaking");
        break;
      }

      // Wait for the first agent to finish
      const raceResult = await Promise.race(
        runningAgents.map(a => this.spawner.waitForAgent(a.id))
      );

      // Update task status
      const task = this.state.tasks.find(t => t.id === raceResult.taskId);
      if (task) {
        task.status = raceResult.status === "done" ? "done" : "failed";
        task.completedAt = new Date();
        if (raceResult.status === "failed" || raceResult.status === "timeout") {
          task.error = raceResult.status === "timeout" ? "Agent timed out" : (raceResult.error || "Agent failed");
        }

        // Safety net: auto-commit any uncommitted changes the agent left behind
        if (task.status === "done" && this.worktreeManager.hasChanges(task.id)) {
          this.autoCommit(task);
        }

        // Record cost in budget guard
        const costAgent = task.agentId ? this.state.agents.get(task.agentId) : undefined;
        if (costAgent) {
          this.budgetGuard.recordCost(costAgent.id, task.name, costAgent.costUsd);
        }

        // Run quality gate if enabled and task succeeded
        if (task.status === "done" && this.config.qualityGates) {
          const report = await this.qualityGate.check(task);
          this.state.qualityReports.push(report);
          task.lastQualityReport = report;

          this.emitCI("quality:report", {
            taskId: task.id,
            taskName: task.name,
            typecheckPassed: report.typecheckPassed,
            testsPassed: report.testsPassed,
          });

          if (!report.typecheckPassed) {
            this.logger.quality(`Quality gate FAILED for "${task.name}" — typecheck errors`);
            task.error = `Quality gate: ${report.typecheckErrors?.slice(0, 3).join("; ")}`;
            task.status = "failed";
          }
        }

        // Retry logic — if task failed and retries remain
        if (task.status === "failed" && (task.retryCount || 0) < this.config.maxRetries) {
          task.retryCount = (task.retryCount || 0) + 1;
          task.previousErrors = task.previousErrors || [];
          task.previousErrors.push(task.error || "Unknown error");
          task.status = "pending";
          task.error = undefined;
          task.agentId = undefined;
          task.completedAt = undefined;
          task.startedAt = undefined;

          // Clean up old worktree — new one will be created with retry suffix
          await this.worktreeManager.remove(task.id);

          this.logger.warn(`Retrying task "${task.name}" (attempt ${task.retryCount + 1})`);
          this.emitCI("task:retry", {
            taskId: task.id,
            taskName: task.name,
            attempt: task.retryCount + 1,
          });
        }

        // CI event: task completed
        if (task.status === "done" || task.status === "failed") {
          const agent = task.agentId ? this.state.agents.get(task.agentId) : undefined;
          this.emitCI("task:complete", {
            taskId: task.id,
            taskName: task.name,
            status: task.status,
            costUsd: agent?.costUsd || 0,
            durationMs: task.startedAt && task.completedAt
              ? task.completedAt.getTime() - task.startedAt.getTime()
              : 0,
            error: task.error,
          });
        }

        // Save state after each task completion
        this.stateStore.save(this.state);
      }
    }
  }

  /** Spawn a single task: create worktree -> symlink -> forward context -> spawn agent */
  private async spawnTask(task: Task): Promise<void> {
    const retrySuffix = task.retryCount ? `-retry${task.retryCount}` : "";
    const branchName = `jarble-dev/${this.state.runId}/${task.name.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase()}${retrySuffix}`;
    task.worktreeBranch = branchName;
    task.status = "running";
    task.startedAt = new Date();

    // CI event: task started
    this.emitCI("task:start", { taskId: task.id, taskName: task.name });

    try {
      // Create worktree
      const wt = await this.worktreeManager.create(task.id, branchName);
      this.state.worktrees.set(task.id, wt);

      // Symlink node_modules for speed
      await this.worktreeManager.symlinkNodeModules(task.id);

      // Context forwarding: gather diffs from completed dependencies
      if (this.config.contextForwarding && task.dependsOn.length > 0) {
        const contextParts: string[] = [];
        const structuredDiffs = new Map<string, { taskName: string; diff: string }>();

        for (const depId of task.dependsOn) {
          const depTask = this.state.tasks.find(t => t.id === depId);
          if (!depTask || depTask.status !== "done") continue;
          const diff = this.worktreeManager.getDiff(depId);
          if (diff) {
            // Store structured diffs for context builder
            structuredDiffs.set(depId, { taskName: depTask.name, diff });

            // Also store basic context for fallback path
            const truncated = diff.length > 4000
              ? diff.slice(0, 4000) + "\n... (truncated)"
              : diff;
            contextParts.push(
              `### Changes from dependency "${depTask.name}":\n` +
              "```diff\n" + truncated + "\n```"
            );
          }
        }

        if (structuredDiffs.size > 0) {
          this.spawner.setUpstreamDiffs(task.id, structuredDiffs);
        }
        if (contextParts.length > 0) {
          this.spawner.setUpstreamContext(task.id,
            "## Upstream Changes\n" +
            "The following tasks completed before yours. Their changes are already in your worktree's base branch.\n" +
            "Review these diffs to understand what was modified:\n\n" +
            contextParts.join("\n\n")
          );
        }
      }

      // Check if we can resume a previous session
      const previousAgent = task.agentId ? this.state.agents.get(task.agentId) : undefined;
      const resumeSessionId = previousAgent?.sessionId;

      // Spawn agent
      const agent = await this.spawner.spawn(task, wt.path, branchName, resumeSessionId);
      task.agentId = agent.id;
      this.state.agents.set(agent.id, agent);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      task.status = "failed";
      task.error = `Spawn failed: ${msg}`;
      this.logger.error(`Failed to spawn task "${task.name}": ${msg}`);
    }
  }

  /** Merge all completed tasks into the base branch */
  async mergeCompleted(): Promise<MergeResult[]> {
    const sorted = this.planner.topoSort(this.state.tasks);
    const results = await this.merger.mergeAll(sorted, this.config.baseBranch);
    this.state.mergeResults = results;
    return results;
  }

  /** Clean up all worktrees */
  async cleanup() {
    await this.worktreeManager.cleanupAll();
  }

  /** Save current state for resume */
  saveState() {
    this.stateStore.save(this.state);
  }

  /** Print the final summary table */
  private printSummary() {
    const rows = this.state.tasks.map(t => {
      const duration = t.startedAt && t.completedAt
        ? Monitor.formatDuration(t.completedAt.getTime() - t.startedAt.getTime())
        : "-";
      const agent = t.agentId ? this.state.agents.get(t.agentId) : undefined;
      const cost = agent ? `$${agent.costUsd.toFixed(4)}` : "-";
      return {
        task: t.name,
        status: t.status + (t.retryCount ? ` (r${t.retryCount})` : ""),
        duration,
        cost,
      };
    });

    this.logger.summary(rows);
  }

  /** Merge only selected tasks by name */
  async mergeSelected(taskNames: string[]): Promise<MergeResult[]> {
    const nameSet = new Set(taskNames);
    const selected = this.state.tasks.filter(
      t => nameSet.has(t.name) && t.status === "done" && t.worktreeBranch
    );

    if (selected.length === 0) return [];

    // Use topo sort to merge in dependency order
    const sorted = this.planner.topoSort(this.state.tasks)
      .filter(t => nameSet.has(t.name) && t.status === "done");

    const results = await this.merger.mergeAll(sorted, this.config.baseBranch);

    for (const r of results) {
      this.emitCI("merge:result", {
        taskId: r.taskId,
        branch: r.branch,
        status: r.status,
        conflictFiles: r.conflictFiles,
        error: r.error,
      });
    }

    this.state.mergeResults.push(...results);
    return results;
  }

  /** Auto-commit uncommitted changes left by an agent */
  private autoCommit(task: Task): void {
    const wt = this.worktreeManager.get(task.id);
    if (!wt) return;
    try {
      execSync("git add -A", { cwd: wt.path, stdio: "pipe" });
      execSync(
        `git commit -m "chore(jarble-dev): auto-commit changes from task \\"${task.name}\\""`,
        { cwd: wt.path, stdio: "pipe" }
      );
      this.logger.info(`Auto-committed uncommitted changes for "${task.name}"`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`Auto-commit failed for "${task.name}": ${msg}`);
    }
  }

  /** Get current state for external inspection */
  getState(): OrchestratorState {
    return this.state;
  }

  /** Emit a structured CI event */
  private emitCI(event: CIEvent["event"], data: Record<string, unknown>) {
    this.spawner.emitCI({
      timestamp: new Date().toISOString(),
      event,
      runId: this.state.runId,
      data,
    });
  }
}
