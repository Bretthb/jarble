import fs from "fs";
import path from "path";
import type { OrchestratorState, Task, AgentProcess, WorktreeInfo, MergeResult, QualityReport } from "./types.js";

interface SerializedState {
  runId: string;
  tasks: Array<Task & { startedAt?: string; completedAt?: string }>;
  agents: Record<string, Omit<AgentProcess, "process"> & { startedAt: string; completedAt?: string }>;
  worktrees: Record<string, WorktreeInfo & { createdAt: string }>;
  mergeResults: MergeResult[];
  qualityReports: Array<QualityReport & { timestamp: string }>;
  startedAt: string;
  completedAt?: string;
}

export class StateStore {
  private filePath: string;

  constructor(logDir: string, runId: string) {
    this.filePath = path.join(logDir, `state-${runId}.json`);
  }

  save(state: OrchestratorState): void {
    const serializable: SerializedState = {
      runId: state.runId,
      tasks: state.tasks.map(t => ({
        ...t,
        startedAt: t.startedAt?.toISOString(),
        completedAt: t.completedAt?.toISOString(),
        lastQualityReport: t.lastQualityReport ? {
          ...t.lastQualityReport,
          timestamp: t.lastQualityReport.timestamp.toISOString() as unknown as Date,
        } : undefined,
      })) as SerializedState["tasks"],
      agents: Object.fromEntries(
        [...state.agents.entries()].map(([k, v]) => [k, {
          ...v,
          process: undefined,
          startedAt: v.startedAt.toISOString(),
          completedAt: v.completedAt?.toISOString(),
        }])
      ) as unknown as SerializedState["agents"],
      worktrees: Object.fromEntries(
        [...state.worktrees.entries()].map(([k, v]) => [k, {
          ...v,
          createdAt: v.createdAt.toISOString(),
        }])
      ) as unknown as SerializedState["worktrees"],
      mergeResults: state.mergeResults,
      qualityReports: state.qualityReports.map(r => ({
        ...r,
        timestamp: r.timestamp.toISOString(),
      })) as SerializedState["qualityReports"],
      startedAt: state.startedAt.toISOString(),
      completedAt: state.completedAt?.toISOString(),
    };
    fs.writeFileSync(this.filePath, JSON.stringify(serializable, null, 2));
  }

  load(): OrchestratorState | null {
    if (!fs.existsSync(this.filePath)) return null;
    try {
      const data: SerializedState = JSON.parse(fs.readFileSync(this.filePath, "utf-8"));

      return {
        runId: data.runId,
        tasks: data.tasks.map(t => ({
          ...t,
          startedAt: t.startedAt ? new Date(t.startedAt) : undefined,
          completedAt: t.completedAt ? new Date(t.completedAt) : undefined,
          lastQualityReport: t.lastQualityReport ? {
            ...t.lastQualityReport,
            timestamp: new Date(t.lastQualityReport.timestamp as unknown as string),
          } : undefined,
        })),
        agents: new Map(
          Object.entries(data.agents).map(([k, v]) => [k, {
            ...v,
            startedAt: new Date(v.startedAt),
            completedAt: v.completedAt ? new Date(v.completedAt) : undefined,
          }])
        ),
        worktrees: new Map(
          Object.entries(data.worktrees).map(([k, v]) => [k, {
            ...v,
            createdAt: new Date(v.createdAt),
          }])
        ),
        mergeResults: data.mergeResults,
        qualityReports: data.qualityReports.map(r => ({
          ...r,
          timestamp: new Date(r.timestamp),
        })),
        startedAt: new Date(data.startedAt),
        completedAt: data.completedAt ? new Date(data.completedAt) : undefined,
      };
    } catch {
      return null;
    }
  }

  /** Find most recent state file in log dir */
  static findLatest(logDir: string): StateStore | null {
    try {
      const files = fs.readdirSync(logDir)
        .filter(f => f.startsWith("state-") && f.endsWith(".json"))
        .sort()
        .reverse();

      if (files.length === 0) return null;

      const match = files[0].match(/state-(.+)\.json/);
      if (!match) return null;

      return new StateStore(logDir, match[1]);
    } catch {
      return null;
    }
  }
}
