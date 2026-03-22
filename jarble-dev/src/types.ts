/** Core types for jarble-dev orchestrator */

export type TaskStatus = "pending" | "blocked" | "running" | "done" | "failed" | "skipped";
export type AgentStatus = "idle" | "spawning" | "running" | "done" | "failed" | "timeout";
export type MergeStatus = "pending" | "merged" | "conflict" | "failed";

export interface Task {
  id: string;
  name: string;
  description: string;
  /** File paths this task will modify */
  touchesFiles: string[];
  /** Task IDs that must complete before this one starts */
  dependsOn: string[];
  /** Which agent type to use (maps to .claude/agents/) */
  agentType?: string;
  /** Custom prompt appended to the task prompt */
  prompt: string;
  /** Budget cap in USD for this task's agent */
  maxBudgetUsd?: number;
  /** Permission mode for the agent */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "auto";
  status: TaskStatus;
  /** Assigned agent ID once running */
  agentId?: string;
  /** Worktree branch name */
  worktreeBranch?: string;
  /** Error message if failed */
  error?: string;
  /** When the task started */
  startedAt?: Date;
  /** When the task completed */
  completedAt?: Date;
  /** Number of times this task has been retried */
  retryCount?: number;
  /** Error messages from previous attempts */
  previousErrors?: string[];
  /** Quality report from the last attempt */
  lastQualityReport?: QualityReport;
}

export interface AgentProcess {
  id: string;
  taskId: string;
  pid?: number;
  status: AgentStatus;
  worktreePath: string;
  worktreeBranch: string;
  /** Streaming output lines from the agent */
  outputLines: string[];
  /** Cost accumulated so far */
  costUsd: number;
  /** Input/output token counts */
  tokensIn: number;
  tokensOut: number;
  startedAt: Date;
  completedAt?: Date;
  /** Error message if failed */
  error?: string;
  /** Claude CLI session ID for resume */
  sessionId?: string;
  /** The child process handle */
  process?: import("child_process").ChildProcess;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
  taskId: string;
  createdAt: Date;
}

export interface MergeResult {
  taskId: string;
  branch: string;
  status: MergeStatus;
  conflictFiles?: string[];
  error?: string;
}

export interface QualityReport {
  taskId: string;
  branch: string;
  typecheckPassed: boolean;
  typecheckErrors?: string[];
  testsPassed: boolean;
  testFailures?: string[];
  timestamp: Date;
}

export interface OrchestratorState {
  runId: string;
  tasks: Task[];
  agents: Map<string, AgentProcess>;
  worktrees: Map<string, WorktreeInfo>;
  mergeResults: MergeResult[];
  qualityReports: QualityReport[];
  startedAt: Date;
  completedAt?: Date;
}

/** Plan file format — what the planner produces */
export interface TaskPlan {
  name: string;
  description: string;
  tasks: Omit<Task, "id" | "status">[];
}

/** Stream JSON event from Claude CLI --output-format stream-json */
export interface ClaudeStreamEvent {
  type: "system" | "assistant" | "result" | "user" | "rate_limit_event";
  subtype?: "init" | "text" | "tool_use" | "tool_result" | "cost";
  session_id?: string;
  /** Text content for assistant text events */
  content?: string;
  /** Tool name for tool_use events */
  tool_name?: string;
  /** Tool input for tool_use events */
  tool_input?: Record<string, unknown>;
  /** Result fields */
  result?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  total_cost_usd?: number;
  num_turns?: number;
  is_error?: boolean;
  input_tokens?: number;
  output_tokens?: number;
}

/** Configuration for a jarble-dev run */
export interface JarbleDevConfig {
  /** Path to the monorepo root */
  repoRoot: string;
  /** Path to Claude CLI executable */
  claudePath: string;
  /** Base branch to create worktrees from */
  baseBranch: string;
  /** Max concurrent agents */
  maxConcurrency: number;
  /** Default budget per agent in USD */
  defaultBudgetUsd: number;
  /** Default permission mode */
  defaultPermissionMode: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "auto";
  /** Log directory */
  logDir: string;
  /** Whether to run quality gates before merging */
  qualityGates: boolean;
  /** Max time per agent in ms before timeout */
  agentTimeoutMs: number;
  /** Max retries per task on failure */
  maxRetries: number;
  /** Auto-resolve merge conflicts with a Claude agent */
  autoResolve: boolean;
  /** Forward completed task diffs to dependent tasks as context */
  contextForwarding: boolean;
  /** JSON output mode for CI pipelines */
  jsonOutput: boolean;
  /** Total budget cap across ALL agents in a run (0 = unlimited) */
  runBudgetUsd: number;
  /** Warn when this fraction of runBudget is consumed (default 0.8) */
  budgetWarningThreshold: number;
  /** Webhook URLs to POST CI events to */
  webhookUrls: string[];
  /** Skip tasks whose touchesFiles haven't changed since last successful run */
  incremental: boolean;
  /** Max tokens for injected context per agent (default 100K — uses ~half of 200K context window) */
  contextBudgetTokens: number;
}

/** Structured JSON event for CI output */
export interface CIEvent {
  timestamp: string;
  event: "run:start" | "run:complete" | "task:start" | "task:complete" | "task:retry" | "merge:result" | "quality:report" | "team:start" | "team:complete";
  runId: string;
  data: Record<string, unknown>;
}

/** Budget status for the overall run */
export interface BudgetStatus {
  spent: number;
  limit: number;
  remaining: number;
  percent: number;
  paused: boolean;
}

/** Result from creating a GitHub PR */
export interface PRResult {
  url: string;
  number: number;
  title: string;
}

/** Plan template metadata */
export interface PlanTemplate {
  name: string;
  description: string;
  plan: TaskPlan;
}

// ─── Team Orchestration Types ───────────────────────────────────────

/** A team is a sub-orchestrator that manages its own group of tasks */
export interface TeamDef {
  /** Team name — used as branch prefix and for dependency references */
  name: string;
  /** What this team is responsible for */
  description: string;
  /** Tasks this team will execute */
  tasks: Omit<Task, "id" | "status">[];
  /** Other team names that must complete before this team starts */
  dependsOn: string[];
  /** Default agent type for all tasks in this team */
  agentType?: string;
  /** Budget cap for this team's total spend */
  budget?: number;
  /** Default permission mode for this team's agents */
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "auto";
  /** File scope for quality gates */
  scope?: string[];
}

export type TeamStatus = "pending" | "running" | "done" | "failed" | "skipped";

/** Runtime state of a team during execution */
export interface TeamState {
  name: string;
  status: TeamStatus;
  /** The child orchestrator's state (null until started) */
  childState: OrchestratorState | null;
  /** Branch that this team's merged work lives on */
  branch: string;
  /** Combined diff of all team work (for context forwarding) */
  diff?: string;
  /** Total cost across all agents in this team */
  costUsd: number;
  startedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/** A plan that uses teams instead of flat tasks */
export interface TeamPlan {
  name: string;
  description: string;
  teams: TeamDef[];
}

/** Result from a team orchestrator run */
export interface TeamResult {
  teamName: string;
  status: TeamStatus;
  state: OrchestratorState;
  branch: string;
  diff: string;
  costUsd: number;
  durationMs: number;
}
