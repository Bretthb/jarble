import { execSync } from "child_process";
import { nanoid } from "nanoid";
import type {
  JarbleDevConfig, TeamDef, TeamPlan, TeamState, TeamResult,
  OrchestratorState, TaskPlan,
} from "./types.js";
import { Logger } from "./logger.js";
import { Orchestrator } from "./orchestrator.js";
import { Monitor } from "./monitor.js";

export class TeamOrchestrator {
  private config: JarbleDevConfig;
  private logger: Logger;
  private runId: string;
  private teamStates: Map<string, TeamState> = new Map();
  private startedAt: Date;

  constructor(config: JarbleDevConfig, verbose = false) {
    this.config = config;
    this.logger = new Logger(config.logDir, verbose);
    this.runId = nanoid(8);
    this.startedAt = new Date();
  }

  /** Execute a team plan */
  async run(plan: TeamPlan): Promise<TeamResult[]> {
    this.logger.info(`Starting team orchestrator run ${this.runId}`, {
      plan: plan.name,
      teamCount: plan.teams.length,
    });

    // Initialize team states
    for (const team of plan.teams) {
      this.teamStates.set(team.name, {
        name: team.name,
        status: "pending",
        childState: null,
        branch: `jarble-dev/${this.runId}/team-${team.name}`,
        costUsd: 0,
      });
    }

    // Validate team deps
    this.validateTeamDeps(plan.teams);

    const results: TeamResult[] = [];

    while (true) {
      // Find teams whose deps are all done/skipped
      const readyTeams = plan.teams.filter(t => {
        const state = this.teamStates.get(t.name)!;
        if (state.status !== "pending") return false;
        return t.dependsOn.every(dep => {
          const depState = this.teamStates.get(dep);
          return depState?.status === "done" || depState?.status === "skipped";
        });
      });

      const runningCount = [...this.teamStates.values()].filter(s => s.status === "running").length;
      const slotsAvailable = Math.max(1, this.config.maxConcurrency - runningCount);
      const toStart = readyTeams.slice(0, slotsAvailable);

      // Start teams in parallel
      const teamPromises = toStart.map(team => this.runTeam(team, plan));

      if (teamPromises.length === 0) {
        const running = [...this.teamStates.values()].filter(s => s.status === "running");
        const pending = [...this.teamStates.values()].filter(s => s.status === "pending");

        if (running.length === 0 && pending.length === 0) break;

        if (running.length === 0 && pending.length > 0) {
          let anySkipped = false;
          for (const team of plan.teams) {
            const state = this.teamStates.get(team.name)!;
            if (state.status !== "pending") continue;
            const hasFailedDep = team.dependsOn.some(dep => {
              const ds = this.teamStates.get(dep);
              return ds?.status === "failed";
            });
            if (hasFailedDep) {
              state.status = "skipped";
              this.logger.warn(`Skipping team "${team.name}" — dependency failed`);
              anySkipped = true;
            }
          }
          if (!anySkipped) {
            this.logger.error("No teams can progress — breaking");
            break;
          }
          continue;
        }
      }

      // Wait for started teams
      const settled = await Promise.allSettled(teamPromises);
      for (const result of settled) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        }
      }
    }

    this.printSummary(results);
    await this.logger.close();
    return results;
  }

  /** Run a single team as a child orchestrator */
  private async runTeam(team: TeamDef, plan: TeamPlan): Promise<TeamResult> {
    const teamState = this.teamStates.get(team.name)!;
    teamState.status = "running";
    teamState.startedAt = new Date();

    this.logger.info(`Starting team "${team.name}"`, {
      tasks: team.tasks.length,
      budget: team.budget,
      dependsOn: team.dependsOn,
    });

    try {
      // Build child config with team-specific overrides
      const childConfig: JarbleDevConfig = {
        ...this.config,
        runBudgetUsd: team.budget || this.config.runBudgetUsd,
        defaultBudgetUsd: team.budget
          ? Math.min(this.config.defaultBudgetUsd, team.budget / Math.max(team.tasks.length, 1))
          : this.config.defaultBudgetUsd,
        defaultPermissionMode: team.permissionMode || this.config.defaultPermissionMode,
        logDir: `${this.config.logDir}/team-${team.name}`,
      };

      // Apply default agent type to tasks that don't specify one
      const tasks = team.tasks.map(t => ({
        ...t,
        agentType: t.agentType || team.agentType,
      }));

      const childPlan: TaskPlan = {
        name: `${plan.name} / ${team.name}`,
        description: team.description,
        tasks,
      };

      // Inject upstream context into root tasks
      const upstreamContext = this.buildTeamContext(team);
      if (upstreamContext) {
        const rootTasks = childPlan.tasks.filter(
          t => !t.dependsOn || t.dependsOn.length === 0,
        );
        for (const t of rootTasks) {
          t.prompt = upstreamContext + "\n\n---\n\n" + t.prompt;
        }
      }

      // Run child orchestrator
      const child = new Orchestrator(childConfig, false);
      const state = await child.run(childPlan);

      // Merge the child's completed tasks
      await child.mergeCompleted();

      // Get combined diff
      const diff = this.getCombinedDiff(state);

      const costUsd = [...state.agents.values()].reduce((s, a) => s + a.costUsd, 0);

      await child.cleanup();

      const anyFailed = state.tasks.some(t => t.status === "failed");
      teamState.status = anyFailed ? "failed" : "done";
      teamState.childState = state;
      teamState.diff = diff;
      teamState.costUsd = costUsd;
      teamState.completedAt = new Date();

      if (anyFailed) {
        const failedNames = state.tasks.filter(t => t.status === "failed").map(t => t.name);
        teamState.error = `Failed tasks: ${failedNames.join(", ")}`;
        this.logger.error(`Team "${team.name}" had failures: ${failedNames.join(", ")}`);
      } else {
        this.logger.info(`Team "${team.name}" completed`, { costUsd, tasks: state.tasks.length });
      }

      return {
        teamName: team.name,
        status: teamState.status,
        state,
        branch: teamState.branch,
        diff: diff || "",
        costUsd,
        durationMs: teamState.completedAt.getTime() - (teamState.startedAt?.getTime() || 0),
      };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      teamState.status = "failed";
      teamState.error = msg;
      teamState.completedAt = new Date();
      this.logger.error(`Team "${team.name}" crashed: ${msg}`);

      return {
        teamName: team.name,
        status: "failed",
        state: {
          runId: "", tasks: [], agents: new Map(), worktrees: new Map(),
          mergeResults: [], qualityReports: [], startedAt: new Date(),
        },
        branch: teamState.branch,
        diff: "",
        costUsd: 0,
        durationMs: (teamState.completedAt?.getTime() || Date.now()) - (teamState.startedAt?.getTime() || Date.now()),
      };
    }
  }

  /** Build context string from completed dependency teams' diffs */
  buildTeamContext(team: TeamDef): string | null {
    const parts: string[] = [];

    for (const depName of team.dependsOn) {
      const depState = this.teamStates.get(depName);
      if (!depState || !depState.diff) continue;

      const truncated = depState.diff.length > 6000
        ? depState.diff.slice(0, 6000) + "\n... (truncated)"
        : depState.diff;

      parts.push(
        `### Changes from team "${depName}":\n` +
        "```diff\n" + truncated + "\n```",
      );
    }

    if (parts.length === 0) return null;

    return (
      "## Upstream Team Changes\n" +
      "The following teams completed before yours. Their changes are merged into your base branch.\n" +
      "Review these diffs to understand what was modified:\n\n" +
      parts.join("\n\n")
    );
  }

  /** Get combined diff from an orchestrator state */
  private getCombinedDiff(state: OrchestratorState): string {
    const diffs: string[] = [];
    for (const task of state.tasks) {
      if (task.status !== "done" || !task.worktreeBranch) continue;
      try {
        const diff = execSync(
          `git diff ${this.config.baseBranch}...${task.worktreeBranch}`,
          { cwd: this.config.repoRoot, encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 },
        );
        if (diff.trim()) diffs.push(diff);
      } catch { /* branch may be cleaned up */ }
    }
    return diffs.join("\n");
  }

  /** Validate team dependencies */
  validateTeamDeps(teams: TeamDef[]): void {
    const names = new Set(teams.map(t => t.name));
    for (const team of teams) {
      for (const dep of team.dependsOn) {
        if (!names.has(dep)) {
          throw new Error(`Team "${team.name}" depends on unknown team "${dep}"`);
        }
      }
    }

    // Cycle detection
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const teamMap = new Map(teams.map(t => [t.name, t]));

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error(`Circular team dependency: ${name}`);
      visiting.add(name);
      const team = teamMap.get(name)!;
      for (const dep of team.dependsOn) visit(dep);
      visiting.delete(name);
      visited.add(name);
    };

    for (const team of teams) visit(team.name);
  }

  /** Print team summary table */
  private printSummary(results: TeamResult[]) {
    console.log("\n  Team Summary");
    console.log("  " + "-".repeat(80));
    console.log("  " + "Team".padEnd(25) + "Status".padEnd(10) + "Tasks".padEnd(8) + "Duration".padEnd(12) + "Cost");
    console.log("  " + "-".repeat(80));

    let totalCost = 0;
    for (const r of results) {
      totalCost += r.costUsd;
      const taskCount = r.state.tasks.length;
      const done = r.state.tasks.filter(t => t.status === "done").length;
      console.log(
        "  " +
        r.teamName.padEnd(25) +
        r.status.padEnd(10) +
        `${done}/${taskCount}`.padEnd(8) +
        Monitor.formatDuration(r.durationMs).padEnd(12) +
        "$" + r.costUsd.toFixed(4),
      );
    }

    console.log("  " + "-".repeat(80));
    console.log("  " + "Total".padEnd(25) + "".padEnd(10) + "".padEnd(8) + "".padEnd(12) + "$" + totalCost.toFixed(4));
    console.log();
  }

  /** Get team states for external inspection */
  getTeamStates(): Map<string, TeamState> {
    return this.teamStates;
  }
}
