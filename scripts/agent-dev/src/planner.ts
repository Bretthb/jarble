import { nanoid } from "nanoid";
import type { Task, TaskPlan } from "./types.js";
import type { Logger } from "./logger.js";

export class Planner {
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** Parse a task plan and generate task IDs */
  hydratePlan(plan: TaskPlan): Task[] {
    // First pass: assign IDs
    const idMap = new Map<string, string>();
    const tasks: Task[] = plan.tasks.map((t) => {
      const id = nanoid(10);
      idMap.set(t.name, id);
      return {
        ...t,
        id,
        status: "pending" as const,
        dependsOn: t.dependsOn || [],
      };
    });

    // Second pass: resolve dependency names to IDs
    for (const task of tasks) {
      task.dependsOn = task.dependsOn.map((dep) => {
        // If dep is already an ID, keep it; otherwise look up by name
        return idMap.get(dep) || dep;
      });
    }

    this.logger.info(`Plan hydrated: ${tasks.length} tasks`, {
      tasks: tasks.map(t => t.name),
    });

    return tasks;
  }

  /** Topological sort — returns tasks in dependency-respecting order */
  topoSort(tasks: Task[]): Task[] {
    const taskMap = new Map(tasks.map(t => [t.id, t]));
    const visited = new Set<string>();
    const result: Task[] = [];
    const visiting = new Set<string>(); // cycle detection

    const visit = (id: string) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        this.logger.error(`Circular dependency detected involving task ${id}`);
        throw new Error(`Circular dependency: ${id}`);
      }
      visiting.add(id);

      const task = taskMap.get(id);
      if (!task) return;

      for (const depId of task.dependsOn) {
        visit(depId);
      }

      visiting.delete(id);
      visited.add(id);
      result.push(task);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  /** Get tasks that are ready to run (all deps satisfied) */
  getReadyTasks(tasks: Task[]): Task[] {
    const doneIds = new Set(
      tasks.filter(t => t.status === "done").map(t => t.id)
    );
    return tasks.filter(t =>
      t.status === "pending" &&
      t.dependsOn.every(dep => doneIds.has(dep))
    );
  }

  /** Check for file conflicts between concurrently runnable tasks */
  detectFileConflicts(tasks: Task[]): Array<[string, string, string[]]> {
    const conflicts: Array<[string, string, string[]]> = [];

    for (let i = 0; i < tasks.length; i++) {
      for (let j = i + 1; j < tasks.length; j++) {
        const a = tasks[i];
        const b = tasks[j];
        const overlap = a.touchesFiles.filter(f => b.touchesFiles.includes(f));
        if (overlap.length > 0) {
          conflicts.push([a.id, b.id, overlap]);
          this.logger.warn(`File conflict between "${a.name}" and "${b.name}"`, {
            files: overlap,
          });
        }
      }
    }

    return conflicts;
  }

  /** Serialize a set of tasks to a plan file */
  serialize(name: string, description: string, tasks: Task[]): TaskPlan {
    return {
      name,
      description,
      tasks: tasks.map(({ id, status, agentId, worktreeBranch, error, startedAt, completedAt, ...rest }) => rest),
    };
  }
}
