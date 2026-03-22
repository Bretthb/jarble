import { spawn, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { nanoid } from "nanoid";
import type { AgentProcess, ClaudeStreamEvent, Task, JarbleDevConfig, CIEvent } from "./types.js";
import type { Logger } from "./logger.js";
import type { ContextBuilder } from "./contextBuilder.js";
import { RETRY_CONTEXT } from "./prompts/system.js";

export class AgentSpawner extends EventEmitter {
  private config: JarbleDevConfig;
  private logger: Logger;
  private activeAgents: Map<string, AgentProcess> = new Map();
  /** Deferred resolve callbacks — one per agent, set by waitForAgent */
  private completionCallbacks: Map<string, (agent: AgentProcess) => void> = new Map();
  /** Timeout handles — tracked per agent to clear stale timeouts from Promise.race */
  private timeoutHandles: Map<string, NodeJS.Timeout> = new Map();
  /** Optional context builder for enriched prompts */
  private contextBuilder: ContextBuilder | null = null;

  constructor(config: JarbleDevConfig, logger: Logger) {
    super();
    this.config = config;
    this.logger = logger;
  }

  /** Spawn a Claude Code agent for a task in a worktree */
  async spawn(
    task: Task,
    worktreePath: string,
    worktreeBranch: string,
    resumeSessionId?: string,
  ): Promise<AgentProcess> {
    const agentId = nanoid(12);

    const agent: AgentProcess = {
      id: agentId,
      taskId: task.id,
      status: "spawning",
      worktreePath,
      worktreeBranch,
      outputLines: [],
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      startedAt: new Date(),
    };

    const permMode = task.permissionMode || this.config.defaultPermissionMode;
    const budget = task.maxBudgetUsd || this.config.defaultBudgetUsd;

    // Build the prompt: task description + context + retry errors
    const prompt = this.buildPrompt(task);

    const args: string[] = [
      "--print",
      "--verbose",
      "--output-format", "stream-json",
      "--permission-mode", permMode,
      "--max-budget-usd", String(budget),
    ];

    // If a specific agent type is requested, use it
    if (task.agentType) {
      args.push("--agent", task.agentType);
    }

    // Resume a previous session or start fresh
    if (resumeSessionId) {
      args.push("--resume", resumeSessionId);
      args.push("Continue from where you left off. The orchestrator was interrupted. Complete the remaining work and commit.");
    } else {
      // Append system prompt — use context builder if available
      const systemPrompt = this.contextBuilder
        ? this.contextBuilder.buildSystemPrompt(task, worktreeBranch)
        : `You are working on task "${task.name}" in a git worktree branch "${worktreeBranch}". ` +
          `When done, commit your changes with a descriptive message. ` +
          `Do NOT run npm install — node_modules is already linked. ` +
          `Files you should focus on: ${task.touchesFiles.join(", ") || "as needed"}`;
      args.push("--append-system-prompt", systemPrompt);
      args.push(prompt);
    }

    this.logger.agent(`Spawning agent ${agentId} for task "${task.name}"`, {
      taskId: task.id,
      worktree: worktreePath,
      permMode,
      budget,
      agentType: task.agentType,
      resume: !!resumeSessionId,
      retry: task.retryCount || 0,
    });

    // Build env — MUST unset CLAUDECODE to allow nested Claude CLI
    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const child = spawn(this.config.claudePath, args, {
      cwd: worktreePath,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    agent.pid = child.pid;
    agent.process = child;
    agent.status = "running";
    this.activeAgents.set(agentId, agent);

    // Stream stdout — each line is a JSON event
    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleStreamLine(agent, task, line.trim());
      }
    });

    // Capture stderr
    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) {
        this.logger.agentLog(agentId, task.name, `[stderr] ${text}`);
      }
    });

    // Register close handler ONCE at spawn time to avoid race conditions.
    child.on("close", (code) => {
      if (agent.status === "running" || agent.status === "spawning") {
        agent.status = code === 0 ? "done" : "failed";
        agent.completedAt = new Date();
      }
      const cb = this.completionCallbacks.get(agentId);
      if (cb) {
        this.completionCallbacks.delete(agentId);
        cb(agent);
      }
    });

    child.on("error", (err) => {
      agent.status = "failed";
      agent.error = err.message;
      agent.completedAt = new Date();
      const cb = this.completionCallbacks.get(agentId);
      if (cb) {
        this.completionCallbacks.delete(agentId);
        cb(agent);
      }
    });

    return agent;
  }

  /** Spawn an agent in the main repo (not a worktree) for conflict resolution */
  async spawnInRepo(
    prompt: string,
    cwd: string,
    budget: number = 3,
    permMode: string = "acceptEdits",
  ): Promise<AgentProcess> {
    const agentId = nanoid(12);

    const agent: AgentProcess = {
      id: agentId,
      taskId: "merge-resolution",
      status: "spawning",
      worktreePath: cwd,
      worktreeBranch: "merge",
      outputLines: [],
      costUsd: 0,
      tokensIn: 0,
      tokensOut: 0,
      startedAt: new Date(),
    };

    const env = { ...process.env };
    delete env.CLAUDECODE;
    delete env.CLAUDE_CODE_ENTRYPOINT;

    const args = [
      "--print", "--verbose",
      "--output-format", "stream-json",
      "--permission-mode", permMode,
      "--max-budget-usd", String(budget),
      prompt,
    ];

    const child = spawn(this.config.claudePath, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    agent.pid = child.pid;
    agent.process = child;
    agent.status = "running";
    this.activeAgents.set(agentId, agent);

    let buffer = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        this.handleStreamLine(agent, { id: "merge", name: "merge-resolution" } as Task, line.trim());
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text) this.logger.agentLog(agentId, "merge-resolution", `[stderr] ${text}`);
    });

    child.on("close", (code) => {
      if (agent.status === "running" || agent.status === "spawning") {
        agent.status = code === 0 ? "done" : "failed";
        agent.completedAt = new Date();
      }
      const cb = this.completionCallbacks.get(agentId);
      if (cb) { this.completionCallbacks.delete(agentId); cb(agent); }
    });

    child.on("error", (err) => {
      agent.status = "failed";
      agent.error = err.message;
      agent.completedAt = new Date();
      const cb = this.completionCallbacks.get(agentId);
      if (cb) { this.completionCallbacks.delete(agentId); cb(agent); }
    });

    return agent;
  }

  /** Parse a stream-json line from Claude CLI */
  private handleStreamLine(agent: AgentProcess, task: Task, line: string) {
    try {
      const event: ClaudeStreamEvent = JSON.parse(line);

      // Log raw event to agent's log file
      this.logger.agentLog(agent.id, task.name, line);

      switch (event.type) {
        case "system":
          // Capture session ID from init event for resume capability
          if (event.subtype === "init" && event.session_id) {
            agent.sessionId = event.session_id;
          }
          break;

        case "assistant":
          if (event.subtype === "text" && event.content) {
            agent.outputLines.push(event.content);
            // Emit for live dashboard
            this.emit("agent:output", {
              agentId: agent.id,
              taskName: task.name,
              line: event.content,
            });
          } else if (event.subtype === "tool_use") {
            const toolMsg = `Using tool: ${event.tool_name}`;
            this.logger.debug(`Agent ${agent.id} ${toolMsg}`, { taskId: task.id });
            this.emit("agent:output", {
              agentId: agent.id,
              taskName: task.name,
              line: toolMsg,
            });
          }
          break;

        case "result":
          agent.costUsd = event.total_cost_usd || event.cost_usd || 0;
          agent.tokensIn = event.input_tokens || 0;
          agent.tokensOut = event.output_tokens || 0;
          if (event.is_error) {
            agent.status = "failed";
            agent.error = event.result;
            this.logger.error(`Agent ${agent.id} failed: ${event.result}`, { taskId: task.id });
          } else {
            agent.status = "done";
            this.logger.agent(`Agent ${agent.id} completed`, {
              taskId: task.id,
              cost: agent.costUsd,
              tokensIn: agent.tokensIn,
              tokensOut: agent.tokensOut,
            });
          }
          agent.completedAt = new Date();
          break;
      }
    } catch {
      // Non-JSON line — might be a status message
      this.logger.agentLog(agent.id, task.name, `[raw] ${line}`);
    }
  }

  /** Upstream context from completed dependencies — set by orchestrator */
  private upstreamContext: Map<string, string> = new Map();
  /** Structured upstream diffs for context builder */
  private upstreamDiffs: Map<string, Map<string, { taskName: string; diff: string }>> = new Map();

  /** Attach a context builder for enriched prompts */
  setContextBuilder(builder: ContextBuilder) {
    this.contextBuilder = builder;
  }

  /** Set upstream diff context for a task (from completed dependencies) */
  setUpstreamContext(taskId: string, context: string) {
    this.upstreamContext.set(taskId, context);
  }

  /** Set structured upstream diffs for context builder */
  setUpstreamDiffs(taskId: string, diffs: Map<string, { taskName: string; diff: string }>) {
    this.upstreamDiffs.set(taskId, diffs);
  }

  /** Emit a structured CI event */
  emitCI(event: CIEvent) {
    this.emit("ci:event", event);
  }

  /** Build the full prompt for a task */
  private buildPrompt(task: Task): string {
    // Use enriched context builder if available
    if (this.contextBuilder) {
      const diffs = this.upstreamDiffs.get(task.id);
      return this.contextBuilder.buildEnrichedPrompt(task, diffs);
    }

    // Fallback: basic prompt assembly
    const parts = [
      `# Task: ${task.name}\n`,
      task.description,
      "\n---\n",
      task.prompt,
    ];

    // Append upstream context if dependencies produced diffs
    const upstream = this.upstreamContext.get(task.id);
    if (upstream) {
      parts.push("\n\n---\n");
      parts.push(upstream);
    }

    // Append retry context if this is a retry attempt
    if (task.previousErrors && task.previousErrors.length > 0) {
      parts.push("\n\n---\n");
      parts.push(RETRY_CONTEXT(task.previousErrors));
    }

    parts.push("\n\nWhen you are done, create a git commit with all your changes. Use a descriptive commit message.");
    return parts.join("\n");
  }

  /** Wait for an agent to complete (with timeout).
   *  Safe to call multiple times — returns the same result. */
  waitForAgent(agentId: string): Promise<AgentProcess> {
    const agent = this.activeAgents.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    // Already finished (process exited before waitForAgent was called)
    if (agent.status === "done" || agent.status === "failed" || agent.status === "timeout") {
      return Promise.resolve(agent);
    }

    // Clear any stale timeout from a previous waitForAgent call (e.g. from Promise.race)
    const existingTimeout = this.timeoutHandles.get(agentId);
    if (existingTimeout) clearTimeout(existingTimeout);

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        this.timeoutHandles.delete(agentId);
        this.completionCallbacks.delete(agentId);
        agent.status = "timeout";
        agent.completedAt = new Date();
        agent.process?.kill("SIGTERM");
        this.logger.error(`Agent ${agentId} timed out after ${this.config.agentTimeoutMs}ms`);
        resolve(agent);
      }, this.config.agentTimeoutMs);

      this.timeoutHandles.set(agentId, timeout);

      // Store callback — the close handler (registered at spawn time) will call it
      this.completionCallbacks.set(agentId, (a) => {
        clearTimeout(timeout);
        this.timeoutHandles.delete(agentId);
        resolve(a);
      });
    });
  }

  /** Kill a running agent */
  kill(agentId: string) {
    const agent = this.activeAgents.get(agentId);
    if (agent?.process && agent.status === "running") {
      agent.process.kill("SIGTERM");
      agent.status = "failed";
      agent.error = "Killed by orchestrator";
      this.logger.warn(`Killed agent ${agentId}`, { taskId: agent.taskId });
    }
  }

  /** Get all active agents */
  getActive(): AgentProcess[] {
    return [...this.activeAgents.values()].filter(a => a.status === "running");
  }

  /** Get agent by ID */
  get(agentId: string): AgentProcess | undefined {
    return this.activeAgents.get(agentId);
  }
}
