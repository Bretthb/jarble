import fs from "fs";
import path from "path";
import type { TaskPlan, TeamPlan } from "./types.js";
import { Planner } from "./planner.js";
import { Logger } from "./logger.js";

export interface ValidationError {
  type: "missing_field" | "invalid_dep" | "cycle" | "invalid_agent" | "invalid_permission";
  message: string;
  taskName?: string;
}

export interface ValidationWarning {
  type: "file_not_found" | "file_conflict" | "high_budget" | "no_touches_files";
  message: string;
  taskName?: string;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: ValidationWarning[];
}

const VALID_PERMISSIONS = ["default", "acceptEdits", "bypassPermissions", "plan", "auto"];

export class PlanValidator {
  private repoRoot: string;
  private availableAgents: string[];

  constructor(repoRoot: string) {
    this.repoRoot = repoRoot;
    this.availableAgents = this.discoverAgents();
  }

  validate(plan: TaskPlan): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!plan.name) {
      errors.push({ type: "missing_field", message: "Plan is missing 'name'" });
    }
    if (!plan.tasks || !Array.isArray(plan.tasks)) {
      errors.push({ type: "missing_field", message: "Plan is missing 'tasks' array" });
      return { valid: false, errors, warnings };
    }

    const taskNames = new Set(plan.tasks.map(t => t.name));

    for (const task of plan.tasks) {
      // Required fields
      if (!task.name) {
        errors.push({ type: "missing_field", message: "Task is missing 'name'" });
        continue;
      }
      if (!task.prompt) {
        errors.push({ type: "missing_field", message: `Task "${task.name}" is missing 'prompt'`, taskName: task.name });
      }
      if (!task.description) {
        errors.push({ type: "missing_field", message: `Task "${task.name}" is missing 'description'`, taskName: task.name });
      }

      // Dependency validation
      for (const dep of (task.dependsOn || [])) {
        if (!taskNames.has(dep)) {
          errors.push({
            type: "invalid_dep",
            message: `Task "${task.name}" depends on "${dep}" which doesn't exist in the plan`,
            taskName: task.name,
          });
        }
      }

      // Agent type validation
      if (task.agentType && !this.availableAgents.includes(task.agentType)) {
        errors.push({
          type: "invalid_agent",
          message: `Task "${task.name}" uses agent "${task.agentType}" which is not in .claude/agents/. Available: ${this.availableAgents.join(", ")}`,
          taskName: task.name,
        });
      }

      // Permission mode validation
      if (task.permissionMode && !VALID_PERMISSIONS.includes(task.permissionMode)) {
        errors.push({
          type: "invalid_permission",
          message: `Task "${task.name}" has invalid permissionMode "${task.permissionMode}"`,
          taskName: task.name,
        });
      }

      // Warnings
      if (!task.touchesFiles || task.touchesFiles.length === 0) {
        warnings.push({
          type: "no_touches_files",
          message: `Task "${task.name}" has no touchesFiles — quality gate scope will be ambiguous`,
          taskName: task.name,
        });
      } else {
        // Check if files exist (warning only — new files are valid)
        for (const f of task.touchesFiles) {
          const fullPath = path.join(this.repoRoot, f);
          if (!fs.existsSync(fullPath) && !f.includes("__tests__")) {
            warnings.push({
              type: "file_not_found",
              message: `Task "${task.name}": file "${f}" not found (may be a new file)`,
              taskName: task.name,
            });
          }
        }
      }

      if (task.maxBudgetUsd && task.maxBudgetUsd > 20) {
        warnings.push({
          type: "high_budget",
          message: `Task "${task.name}" has high budget: $${task.maxBudgetUsd}`,
          taskName: task.name,
        });
      }
    }

    // File conflict detection between tasks without dependency ordering
    const taskList = plan.tasks.map((t, i) => ({ ...t, id: String(i), status: "pending" as const }));
    for (let i = 0; i < taskList.length; i++) {
      for (let j = i + 1; j < taskList.length; j++) {
        const a = taskList[i];
        const b = taskList[j];
        const overlap = (a.touchesFiles || []).filter(f => (b.touchesFiles || []).includes(f));
        if (overlap.length > 0) {
          const aDepsOnB = (a.dependsOn || []).includes(b.name);
          const bDepsOnA = (b.dependsOn || []).includes(a.name);
          if (!aDepsOnB && !bDepsOnA) {
            warnings.push({
              type: "file_conflict",
              message: `Tasks "${a.name}" and "${b.name}" both touch ${overlap.join(", ")} but have no dependency between them`,
            });
          }
        }
      }
    }

    // Cycle detection
    try {
      const logger = new Logger(path.join(this.repoRoot, "jarble-dev", "logs"), false);
      const planner = new Planner(logger);
      const hydrated = planner.hydratePlan({ name: plan.name, description: plan.description || "", tasks: plan.tasks });
      planner.topoSort(hydrated);
      void logger.close();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ type: "cycle", message: `Circular dependency detected: ${msg}` });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /** Validate a team-based plan */
  validateTeamPlan(plan: TeamPlan): ValidationResult {
    const errors: ValidationError[] = [];
    const warnings: ValidationWarning[] = [];

    if (!plan.name) {
      errors.push({ type: "missing_field", message: "Plan is missing 'name'" });
    }
    if (!plan.teams || !Array.isArray(plan.teams) || plan.teams.length === 0) {
      errors.push({ type: "missing_field", message: "Plan must have a non-empty 'teams' array" });
      return { valid: false, errors, warnings };
    }

    const teamNames = new Set(plan.teams.map(t => t.name));

    for (const team of plan.teams) {
      if (!team.name) {
        errors.push({ type: "missing_field", message: "Team is missing 'name'" });
        continue;
      }
      if (!team.tasks || !Array.isArray(team.tasks) || team.tasks.length === 0) {
        errors.push({ type: "missing_field", message: `Team "${team.name}" must have at least one task`, taskName: team.name });
      }

      // Team dependency validation
      for (const dep of (team.dependsOn || [])) {
        if (!teamNames.has(dep)) {
          errors.push({
            type: "invalid_dep",
            message: `Team "${team.name}" depends on unknown team "${dep}"`,
            taskName: team.name,
          });
        }
      }

      // Agent type validation (team-level default)
      if (team.agentType && !this.availableAgents.includes(team.agentType)) {
        errors.push({
          type: "invalid_agent",
          message: `Team "${team.name}" uses agent "${team.agentType}" which is not in .claude/agents/`,
          taskName: team.name,
        });
      }

      // Permission mode validation
      if (team.permissionMode && !VALID_PERMISSIONS.includes(team.permissionMode)) {
        errors.push({
          type: "invalid_permission",
          message: `Team "${team.name}" has invalid permissionMode "${team.permissionMode}"`,
          taskName: team.name,
        });
      }

      // Validate each team's internal tasks
      if (team.tasks && team.tasks.length > 0) {
        const internalPlan: TaskPlan = {
          name: team.name,
          description: team.description || "",
          tasks: team.tasks,
        };
        const internalResult = this.validate(internalPlan);
        for (const err of internalResult.errors) {
          errors.push({ ...err, message: `[Team "${team.name}"] ${err.message}` });
        }
        for (const warn of internalResult.warnings) {
          warnings.push({ ...warn, message: `[Team "${team.name}"] ${warn.message}` });
        }
      }

      // Budget warnings
      if (team.budget && team.budget > 50) {
        warnings.push({
          type: "high_budget",
          message: `Team "${team.name}" has high budget: $${team.budget}`,
          taskName: team.name,
        });
      }
    }

    // Team-level cycle detection
    try {
      const visited = new Set<string>();
      const visiting = new Set<string>();
      const visit = (name: string) => {
        if (visited.has(name)) return;
        if (visiting.has(name)) throw new Error(name);
        visiting.add(name);
        const team = plan.teams.find(t => t.name === name);
        if (team) for (const dep of team.dependsOn || []) visit(dep);
        visiting.delete(name);
        visited.add(name);
      };
      for (const team of plan.teams) visit(team.name);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push({ type: "cycle", message: `Circular team dependency detected: ${msg}` });
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  private discoverAgents(): string[] {
    const agentsDir = path.join(this.repoRoot, ".claude", "agents");
    try {
      return fs.readdirSync(agentsDir)
        .filter(f => f.endsWith(".md"))
        .map(f => f.replace(".md", ""));
    } catch {
      return [];
    }
  }
}
