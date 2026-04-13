/**
 * Flow Execution Engine - executes flow graphs with cycle support,
 * human-in-the-loop pausing, and nested subflow execution.
 *
 * Architecture:
 * 1. Parse flow definition -> build adjacency graph
 * 2. State-machine execution: start from entry nodes, follow edges
 * 3. Cycle support: nodes can be revisited up to maxIterations times
 * 4. waitForInput nodes pause execution until resume() is called
 * 5. subflow nodes execute a nested flow as a child engine
 * 6. Parallel execution for nodes that become ready simultaneously
 * 7. Resolve template variables. Three equivalent forms are supported:
 *      {{nodeId.field}}         (direct — recommended)
 *      {{nodeId.result.field}}  (alias — matches JS object access intuition)
 *      {{stepN_result.field}}   (positional — nth completed step)
 * 8. Bill credits via existing executeAgentCall()
 * 9. Emit SSE events for each step start/finish
 */

import { EventEmitter } from "events";
import { db, tables, dbDate } from "../db/index.js";
import { eq, and, or } from "drizzle-orm";
import {
  buildDelegationTools,
  executeDelegation,
} from "./flowDelegation.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("flow-engine");

// ── Types ──────────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type: "deployment" | "transform" | "condition" | "output" | "waitForInput" | "subflow";
  deploymentId?: string;
  serviceId?: string;
  skillName?: string;
  label: string;
  // Bot team fields
  role?: string;              // "CTO", "Chart Generator", etc.
  goal?: string;              // "Oversee technical architecture"
  canDelegate?: boolean;      // Can this bot delegate to connected bots?
  contextScope?: "task" | "summary" | "full"; // What context to pass
  modelOverride?: string;     // Override deployment's default model
  isEntryPoint?: boolean;     // Is this the bot users talk to?
  config?: Record<string, unknown>;
  position: { x: number; y: number };
  /** Max iterations when this node is part of a cycle. Default: 10 */
  maxIterations?: number;
}

export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: "delegates" | "reports" | "collaborates"; // Communication channel type
  contextScope?: "task" | "summary" | "full";      // Per-edge context override
  label?: string;
  condition?: string;
  /** Max iterations for feedback loops on this edge */
  maxIterations?: number;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

/**
 * Normalize a flow node so that orchestration fields (role, goal, canDelegate,
 * contextScope, isEntryPoint) are always readable at the top level.
 *
 * Historically the frontend canvas saves these fields into `node.config.*`
 * while the Zod schema and server code read them from the top level. This
 * helper bridges both formats so a UI-saved flow and an API-created flow
 * behave identically.
 *
 * Top-level values win when set; otherwise values under `config` are promoted.
 */
type NormalizedFlowNode<T> = T &
  Pick<
    FlowNode,
    "role" | "goal" | "canDelegate" | "contextScope" | "isEntryPoint" | "modelOverride"
  >;

export function normalizeFlowNode<T extends Partial<FlowNode> & { config?: any }>(
  node: T,
): NormalizedFlowNode<T> {
  const cfg = (node?.config ?? {}) as Record<string, unknown>;
  const pick = <K extends keyof FlowNode>(key: K): FlowNode[K] | undefined => {
    const top = (node as any)[key];
    if (top !== undefined) return top;
    const fromCfg = cfg[key as string];
    return fromCfg as FlowNode[K] | undefined;
  };
  return {
    ...node,
    role: pick("role"),
    goal: pick("goal"),
    canDelegate: pick("canDelegate"),
    contextScope: pick("contextScope"),
    isEntryPoint: pick("isEntryPoint"),
    modelOverride: pick("modelOverride"),
  } as NormalizedFlowNode<T>;
}

/**
 * Normalize every node in a flow definition. Safe to call on already-normalized
 * definitions (idempotent).
 */
export function normalizeFlowDefinition<T extends { nodes?: any[]; edges?: any[] }>(
  def: T,
): T {
  if (!def || !Array.isArray(def.nodes)) return def;
  return {
    ...def,
    nodes: def.nodes.map((n) => normalizeFlowNode(n)),
  };
}

export interface StepResult {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
  durationMs?: number;
  creditsCharged?: number;

  // ── Phase 4: Time-travel debugging fields ─────────────────────────────
  // These are captured at step execution time and persisted via
  // checkpointState() so the frontend can reconstruct the full
  // input/output trail for any completed execution.

  /**
   * Snapshot of the resolved arguments that were passed to the step's
   * executor. For deployment nodes this is the template-resolved config
   * (including `{{nodeId.field}}` substitutions); for transform/condition
   * nodes it's the resolved expression + input data. Captured at the
   * START of execution so users can see exactly what the step received.
   */
  inputSnapshot?: unknown;

  /**
   * Condition evaluations on incoming edges. When a node has conditional
   * edges, each condition is evaluated before the node runs. This array
   * records what each condition resolved to so users can understand WHY
   * a branch was taken or skipped.
   */
  conditionEvaluations?: Array<{
    edgeId: string;
    condition: string;
    resolved: string;
    result: boolean;
  }>;

  /**
   * How many times this node has been visited in the current execution.
   * For non-cyclic nodes this is always 1. For cyclic nodes (part of a
   * feedback loop with maxIterations), this tracks the current iteration
   * so the time-travel UI can show progress through the loop.
   */
  visitCount?: number;
}

export interface FlowExecutionState {
  flowId: string;
  executionId: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "paused";
  stepResults: Map<string, StepResult>;
  totalCredits: number;
  startedAt: number;
  completedAt?: number;
  /** When paused, which node is waiting for input */
  pausedAtNodeId?: string;
}

// ── Engine Events ──────────────────────────────────────────────────────────

export interface FlowEngineEvents {
  "step:started": {
    nodeId: string;
    label: string;
    index: number;
    total: number;
  };
  "step:finished": {
    nodeId: string;
    label: string;
    status: StepResult["status"];
    result?: unknown;
    error?: string;
    durationMs: number;
    credits: number;
    index: number;
    total: number;
  };
  "step:iteration": {
    nodeId: string;
    iteration: number;
    maxIterations: number;
  };
  "flow:state": {
    status: FlowExecutionState["status"];
    completedSteps: number;
    totalSteps: number;
    totalCredits: number;
  };
  "flow:completed": {
    executionId: string;
    totalCredits: number;
    durationMs: number;
    stepResults: Record<string, StepResult>;
  };
  "flow:paused": {
    nodeId: string;
    label: string;
    inputSchema?: unknown;
  };
  "flow:error": {
    executionId: string;
    error: string;
  };
  "substep:started": {
    parentNodeId: string;
    nodeId: string;
    label: string;
    index: number;
    total: number;
  };
  "substep:finished": {
    parentNodeId: string;
    nodeId: string;
    label: string;
    status: StepResult["status"];
    result?: unknown;
    error?: string;
    durationMs: number;
    credits: number;
    index: number;
    total: number;
  };
}

// ── Engine ─────────────────────────────────────────────────────────────────

export class FlowExecutionEngine extends EventEmitter {
  private state: FlowExecutionState;
  private abortController: AbortController;
  private nodeMap: Map<string, FlowNode> = new Map();
  private incomingEdges: Map<string, FlowEdge[]> = new Map();
  private outgoingEdges: Map<string, FlowEdge[]> = new Map();

  /** Track how many times each node has been executed (for cycle support) */
  private nodeVisitCount: Map<string, number> = new Map();
  /** Phase 4: temp stash for condition evaluations to pass to executeStep */
  private _lastConditionEvals?: StepResult["conditionEvaluations"];

  /** When resuming, start from this set of nodes instead of entry nodes */
  private resumeFromNodes: string[] | null = null;

  /** Nesting depth for subflow execution (prevents infinite recursion) */
  private nestingDepth: number;

  /** Maximum allowed nesting depth for subflows */
  static MAX_NESTING_DEPTH = 3;

  /** Optional initial prompt injected into entry node args as `task` */
  private initialPrompt?: string;

  constructor(
    flowId: string,
    executionId: string,
    private definition: FlowDefinition,
    private userId: string,
    private callerDeploymentId?: string,
    initialPromptOrNestingDepth?: string | number,
    nestingDepth?: number
  ) {
    super();
    this.setMaxListeners(50);

    // Handle overloaded constructor: (string prompt, number depth) or (number depth)
    if (typeof initialPromptOrNestingDepth === "string") {
      this.initialPrompt = initialPromptOrNestingDepth;
      this.nestingDepth = nestingDepth ?? 0;
    } else {
      this.nestingDepth = initialPromptOrNestingDepth ?? nestingDepth ?? 0;
    }

    this.abortController = new AbortController();

    this.state = {
      flowId,
      executionId,
      status: "pending",
      stepResults: new Map(),
      totalCredits: 0,
      startedAt: Date.now(),
    };

    // Index nodes
    for (const node of definition.nodes) {
      this.nodeMap.set(node.id, node);
      this.state.stepResults.set(node.id, { status: "pending" });
      this.nodeVisitCount.set(node.id, 0);
    }

    // Index edges per source and target
    for (const edge of definition.edges) {
      if (!this.nodeMap.has(edge.source) || !this.nodeMap.has(edge.target)) {
        continue; // Skip edges referencing non-existent nodes
      }

      const incoming = this.incomingEdges.get(edge.target) ?? [];
      incoming.push(edge);
      this.incomingEdges.set(edge.target, incoming);

      const outgoing = this.outgoingEdges.get(edge.source) ?? [];
      outgoing.push(edge);
      this.outgoingEdges.set(edge.source, outgoing);
    }
  }

  /** Cancel a running execution. In-flight steps will complete but no new ones start. */
  cancel(): void {
    this.abortController.abort();
    this.state.status = "cancelled";
    this.emitFlowState();
  }

  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  get executionState(): FlowExecutionState {
    return this.state;
  }

  // ── Main entry point ───────────────────────────────────────────────────

  async execute(): Promise<FlowExecutionState> {
    const totalNodes = this.definition.nodes.length;

    if (totalNodes === 0) {
      this.state.status = "completed";
      this.state.completedAt = Date.now();
      this.emitFlowState();
      this.emit("flow:completed", {
        executionId: this.state.executionId,
        totalCredits: 0,
        durationMs: 0,
        stepResults: {},
      });
      return this.state;
    }

    this.state.status = "running";
    this.emitFlowState();

    try {
      await this.executeStateMachine();
    } catch (err: any) {
      if ((this.state.status as string) !== "paused") {
        this.state.status = "failed";
        this.emit("flow:error", {
          executionId: this.state.executionId,
          error: err.message,
        });
      }
    }

    // If paused, don't finalize - resume() will continue
    if ((this.state.status as string) === "paused") {
      // Checkpoint the paused state
      await this.checkpointState().catch((err) => {
        log.warn({ executionId: this.state.executionId, err }, "Paused checkpoint failed (non-fatal)");
      });
      return this.state;
    }

    this.state.completedAt = Date.now();
    this.emitFlowState();

    this.emit("flow:completed", {
      executionId: this.state.executionId,
      totalCredits: this.state.totalCredits,
      durationMs: this.state.completedAt - this.state.startedAt,
      stepResults: Object.fromEntries(this.state.stepResults),
    });

    // Persist final state to DB (best-effort)
    await this.persistState().catch((err) => {
      log.error(
        { executionId: this.state.executionId, err },
        "Failed to persist final execution state"
      );
    });

    return this.state;
  }

  // ── State machine execution (supports cycles) ──────────────────────────

  /**
   * State-machine execution model:
   * 1. Find entry nodes (no incoming edges, or lowest in-degree for pure cycles)
   * 2. Execute ready nodes in parallel
   * 3. After each node completes/fails/skips, follow outgoing edges
   * 4. Nodes can be revisited (cycles) up to maxIterations
   * 5. waitForInput nodes pause the engine
   */
  private async executeStateMachine(): Promise<void> {
    const totalNodes = this.definition.nodes.length;

    let readyQueue: string[];

    if (this.resumeFromNodes) {
      // Resuming from a paused state - start from the specified nodes
      readyQueue = [...this.resumeFromNodes];
      this.resumeFromNodes = null;
    } else {
      // Find entry nodes: nodes with no incoming edges
      readyQueue = [];
      for (const node of this.definition.nodes) {
        const incoming = this.incomingEdges.get(node.id) ?? [];
        if (incoming.length === 0) {
          readyQueue.push(node.id);
        }
      }

      // If no natural entry nodes exist (pure cycle), pick nodes with minimum in-degree
      if (readyQueue.length === 0) {
        let minInDegree = Infinity;
        for (const node of this.definition.nodes) {
          const incoming = this.incomingEdges.get(node.id) ?? [];
          if (incoming.length < minInDegree) {
            minInDegree = incoming.length;
          }
        }
        for (const node of this.definition.nodes) {
          const incoming = this.incomingEdges.get(node.id) ?? [];
          if (incoming.length === minInDegree) {
            readyQueue.push(node.id);
          }
        }
      }
    }

    while (readyQueue.length > 0) {
      if (this.abortController.signal.aborted) break;

      // Execute all ready nodes in parallel
      const currentBatch = [...readyQueue];
      readyQueue = [];

      const results = await Promise.allSettled(
        currentBatch.map((nodeId) => this.executeNodeInStateMachine(nodeId, totalNodes))
      );

      // Check for unhandled rejections
      for (const r of results) {
        if (r.status === "rejected") {
          log.error(
            { executionId: this.state.executionId, err: r.reason },
            "Unexpected step rejection"
          );
        }
      }

      // If engine was paused by a waitForInput node, stop the loop
      if (this.state.status === "paused") {
        return;
      }

      // Collect next ready nodes from completed/failed/skipped batch
      for (const nodeId of currentBatch) {
        const stepResult = this.state.stepResults.get(nodeId);
        if (!stepResult) continue;

        // Only follow edges from terminal states
        if (
          stepResult.status !== "completed" &&
          stepResult.status !== "failed" &&
          stepResult.status !== "skipped"
        ) {
          continue;
        }

        const outgoing = this.outgoingEdges.get(nodeId) ?? [];
        for (const edge of outgoing) {
          const targetId = edge.target;
          const node = this.nodeMap.get(targetId);
          if (!node) continue;

          // Check if all incoming dependencies are resolved (completed/failed/skipped)
          if (!this.allDependenciesResolved(targetId)) continue;

          const visitCount = this.nodeVisitCount.get(targetId) ?? 0;
          const maxIter = node.maxIterations ?? 10;

          if (visitCount >= maxIter) {
            // Max iterations reached - emit warning and skip
            log.warn(
              { nodeId: targetId, visitCount, maxIter },
              "Node max iterations reached, skipping"
            );
            this.emit("step:iteration", {
              nodeId: targetId,
              iteration: visitCount,
              maxIterations: maxIter,
            });
            continue;
          }

          // Avoid duplicate entries in the queue
          if (!readyQueue.includes(targetId)) {
            readyQueue.push(targetId);
          }
        }
      }
    }

    // Determine final status
    const allResults = [...this.state.stepResults.values()];
    const anyFailed = allResults.some((r) => r.status === "failed");

    if (this.abortController.signal.aborted) {
      this.state.status = "cancelled";
    } else if (anyFailed) {
      this.state.status = "failed";
    } else {
      this.state.status = "completed";
    }
  }

  /**
   * Check if all incoming dependencies of a node are resolved
   * (completed, failed, or skipped).
   */
  private allDependenciesResolved(nodeId: string): boolean {
    const incoming = this.incomingEdges.get(nodeId) ?? [];
    if (incoming.length === 0) return true;

    for (const edge of incoming) {
      const sourceResult = this.state.stepResults.get(edge.source);
      if (!sourceResult) return false;
      if (
        sourceResult.status !== "completed" &&
        sourceResult.status !== "failed" &&
        sourceResult.status !== "skipped"
      ) {
        return false;
      }
    }

    return true;
  }

  /**
   * Execute a single node within the state machine model.
   * Handles iteration tracking, dependency checks, and condition evaluation.
   */
  private async executeNodeInStateMachine(
    nodeId: string,
    totalNodes: number
  ): Promise<void> {
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

    // Increment visit count
    const visitCount = (this.nodeVisitCount.get(nodeId) ?? 0) + 1;
    this.nodeVisitCount.set(nodeId, visitCount);

    const maxIter = node.maxIterations ?? 10;

    // Emit iteration event if this is a revisit
    if (visitCount > 1) {
      this.emit("step:iteration", {
        nodeId,
        iteration: visitCount,
        maxIterations: maxIter,
      });
    }

    // Check if any dependency failed - if so, skip this step
    const incoming = this.incomingEdges.get(nodeId) ?? [];
    for (const edge of incoming) {
      const depResult = this.state.stepResults.get(edge.source);
      if (depResult?.status === "failed" || depResult?.status === "skipped") {
        this.state.stepResults.set(nodeId, {
          status: "skipped",
          error: `Dependency "${edge.source}" ${depResult.status}`,
        });
        const completedCount = this.countCompleted();
        this.emit("step:finished", {
          nodeId,
          label: node.label,
          status: "skipped",
          error: `Dependency "${edge.source}" ${depResult.status}`,
          durationMs: 0,
          credits: 0,
          index: completedCount,
          total: totalNodes,
        });
        this.emitFlowState();
        return;
      }
    }

    // Check conditions on incoming edges. Phase 4: record each evaluation
    // in the conditionEvaluations audit trail so the time-travel UI can
    // show why a branch was taken or skipped.
    const conditionEvals: StepResult["conditionEvaluations"] = [];
    for (const edge of incoming) {
      if (edge.condition) {
        const resolved = String(
          this.resolveTemplateVars(edge.condition, this.state.stepResults) ?? edge.condition,
        );
        const conditionMet = this.evaluateCondition(
          edge.condition,
          this.state.stepResults
        );
        conditionEvals.push({
          edgeId: edge.id,
          condition: edge.condition,
          resolved,
          result: conditionMet,
        });
        if (!conditionMet) {
          this.state.stepResults.set(nodeId, {
            status: "skipped",
            error: `Condition not met: ${edge.condition}`,
            conditionEvaluations: conditionEvals,
          });
          const completedCount = this.countCompleted();
          this.emit("step:finished", {
            nodeId,
            label: node.label,
            status: "skipped",
            error: `Condition not met: ${edge.condition}`,
            durationMs: 0,
            credits: 0,
            index: completedCount,
            total: totalNodes,
          });
          this.emitFlowState();
          return;
        }
      }
    }

    // Handle waitForInput: pause synchronously without blocking execute()
    if (node.type === "waitForInput") {
      this.handleWaitForInput(node, totalNodes);
      return;
    }

    // Phase 4: stash condition evaluations for executeStep to include
    // in the completed StepResult. This avoids changing executeStep's
    // signature (which would ripple through many callers).
    this._lastConditionEvals = conditionEvals.length > 0 ? conditionEvals : undefined;
    await this.executeStep(node, totalNodes);
  }

  // ── Topological sort into parallel groups (legacy, still used for acyclic detection) ──

  buildExecutionOrder(nodes: FlowNode[], edges: FlowEdge[]): string[][] {
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const node of nodes) {
      inDegree.set(node.id, 0);
      adjacency.set(node.id, []);
    }

    for (const edge of edges) {
      if (!inDegree.has(edge.source) || !inDegree.has(edge.target)) {
        continue; // Skip edges referencing non-existent nodes
      }
      inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
      adjacency.get(edge.source)!.push(edge.target);
    }

    const groups: string[][] = [];
    let queue = [...inDegree.entries()]
      .filter(([, deg]) => deg === 0)
      .map(([id]) => id);

    let processed = 0;

    while (queue.length > 0) {
      groups.push([...queue]);
      processed += queue.length;

      const nextQueue: string[] = [];
      for (const nodeId of queue) {
        for (const neighbor of adjacency.get(nodeId) ?? []) {
          const newDeg = (inDegree.get(neighbor) ?? 1) - 1;
          inDegree.set(neighbor, newDeg);
          if (newDeg === 0) {
            nextQueue.push(neighbor);
          }
        }
      }
      queue = nextQueue;
    }

    if (processed !== nodes.length) {
      throw new Error(
        `Cycle detected in flow graph: processed ${processed} of ${nodes.length} nodes`
      );
    }

    return groups;
  }

  // ── Execute a single step ──────────────────────────────────────────────

  private async executeStep(node: FlowNode, totalNodes: number): Promise<void> {
    const startTime = Date.now();

    // Mark as running. Capture the visit count for cyclic nodes.
    const nodeVisitCount = (this.nodeVisitCount?.get(node.id) ?? 0);
    this.state.stepResults.set(node.id, {
      status: "running",
      visitCount: nodeVisitCount + 1,
    });
    const runningIndex = this.countCompleted() + 1;

    // JAR-50: log the success path at info level so we can find slow nodes
    // in prod. Previously only warn/error branches logged, meaning a
    // successfully-slow 40-step flow gave no timing trail.
    log.info(
      {
        executionId: this.state.executionId,
        nodeId: node.id,
        nodeType: node.type,
        iteration: runningIndex,
        total: totalNodes,
      },
      "flow: step started",
    );

    this.emit("step:started", {
      nodeId: node.id,
      label: node.label,
      index: runningIndex,
      total: totalNodes,
    });

    // Phase 4: snapshot resolved input args BEFORE the try block so both
    // success and failure paths can include it in the step result.
    const inputSnapshot = (() => {
      try {
        const resolved = this.resolveTemplateVars(
          node.config ?? {},
          this.state.stepResults,
        );
        const json = JSON.stringify(resolved);
        return json.length > 10_000
          ? JSON.parse(json.slice(0, 10_000) + '..."')
          : resolved;
      } catch {
        return node.config ?? {};
      }
    })();

    try {
      if (this.abortController.signal.aborted) {
        throw new Error("Execution cancelled");
      }

      let result: unknown;
      let creditsCharged = 0;

      switch (node.type) {
        case "deployment": {
          const callResult = await this.executeDeploymentNode(node);
          result = callResult.result;
          creditsCharged = callResult.creditsCharged;
          break;
        }
        case "transform": {
          result = this.executeTransformNode(node);
          break;
        }
        case "condition": {
          result = this.executeConditionNode(node);
          break;
        }
        case "output": {
          result = this.executeOutputNode(node);
          break;
        }
        case "subflow": {
          const subResult = await this.executeSubflowNode(node);
          result = subResult.result;
          creditsCharged = subResult.creditsCharged;
          break;
        }
        case "waitForInput":
          // Handled separately by handleWaitForInput; should not reach here
          throw new Error("waitForInput should not be executed via executeStep");
        default:
          throw new Error(`Unknown node type: ${(node as any).type}`);
      }

      const durationMs = Date.now() - startTime;
      this.state.totalCredits += creditsCharged;

      this.state.stepResults.set(node.id, {
        status: "completed",
        result,
        durationMs,
        creditsCharged,
        // Phase 4: time-travel fields persisted on completion
        inputSnapshot,
        visitCount: nodeVisitCount + 1,
        conditionEvaluations: this._lastConditionEvals,
      });
      this._lastConditionEvals = undefined; // clear after use

      const completedCount = this.countCompleted();

      // JAR-50: log the success path with timing + credits so prod flame
      // graphs are queryable even before OTel (Phase 2) is wired.
      log.info(
        {
          executionId: this.state.executionId,
          nodeId: node.id,
          nodeType: node.type,
          durationMs,
          creditsCharged,
          completed: completedCount,
          total: totalNodes,
        },
        "flow: step completed",
      );

      this.emit("step:finished", {
        nodeId: node.id,
        label: node.label,
        status: "completed",
        result,
        durationMs,
        credits: creditsCharged,
        index: completedCount,
        total: totalNodes,
      });
      this.emitFlowState();

      // Checkpoint: persist intermediate state after each step (crash recovery)
      this.checkpointState().catch((err) => {
        log.warn({ executionId: this.state.executionId, nodeId: node.id, err }, "Checkpoint failed (non-fatal)");
      });
    } catch (err: any) {
      const durationMs = Date.now() - startTime;
      const errorMsg = err.message || "Unknown error";

      this.state.stepResults.set(node.id, {
        status: "failed",
        error: errorMsg,
        durationMs,
        // Phase 4: persist input snapshot even on failure so the time-travel
        // UI can show what input caused the failure
        inputSnapshot,
        visitCount: nodeVisitCount + 1,
      });

      const completedCount = this.countCompleted();
      this.emit("step:finished", {
        nodeId: node.id,
        label: node.label,
        status: "failed",
        error: errorMsg,
        durationMs,
        credits: 0,
        index: completedCount,
        total: totalNodes,
      });
      this.emitFlowState();

      log.warn(
        { executionId: this.state.executionId, nodeId: node.id, err: errorMsg },
        "Flow step failed"
      );
    }
  }

  // ── Node type executors ────────────────────────────────────────────────

  private async executeDeploymentNode(
    node: FlowNode
  ): Promise<{ result: unknown; creditsCharged: number }> {
    // Resolve template variables in config/args
    const resolvedArgs = this.resolveTemplateVars(
      node.config ?? {},
      this.state.stepResults
    );

    // Inject initial prompt into entry node if provided and no task/message already set
    if (this.initialPrompt && !resolvedArgs.task && !resolvedArgs.message) {
      const incoming = this.incomingEdges.get(node.id) ?? [];
      if (incoming.length === 0) {
        // This is an entry node — inject the user's prompt
        resolvedArgs.task = this.initialPrompt;
      }
    }

    if (!node.deploymentId) {
      throw new Error(
        `Deployment node "${node.id}" has no deploymentId for delegation`
      );
    }

    return this.executeDeploymentViaDelegation(node, resolvedArgs);
  }

  /**
   * Execute a deployment node via the delegation system.
   * Builds delegation tools from outgoing edges, augments the system prompt
   * with team context, and calls executeDelegation.
   */
  private async executeDeploymentViaDelegation(
    node: FlowNode,
    resolvedArgs: Record<string, unknown>
  ): Promise<{ result: unknown; creditsCharged: number }> {
    // Build the task string from resolved args — use "task", "message", or
    // "prompt" field, falling back to a JSON serialization of all args.
    const task =
      typeof resolvedArgs.task === "string"
        ? resolvedArgs.task
        : typeof resolvedArgs.message === "string"
          ? resolvedArgs.message
          : typeof resolvedArgs.prompt === "string"
            ? resolvedArgs.prompt
            : JSON.stringify(resolvedArgs);

    // Gather context from completed prior steps
    const priorContext = this.buildPriorStepContext(node);

    // Build delegation tools from outgoing "delegates" edges
    const delegationTools = buildDelegationTools(
      node,
      this.definition.nodes,
      this.definition.edges,
    );

    log.info(
      {
        nodeId: node.id,
        deploymentId: node.deploymentId,
        role: node.role,
        delegationToolCount: delegationTools.length,
        flowId: this.state.flowId,
      },
      "Executing deployment node via delegation system"
    );

    const delegationResult = await executeDelegation({
      targetDeploymentId: node.deploymentId!,
      targetNodeId: node.id,
      task,
      context: priorContext || undefined,
      contextScope: node.contextScope || "task",
      userId: this.userId,
      flowId: this.state.flowId,
      sourceDeploymentId: this.callerDeploymentId || undefined,
      // Use executionId as traceId so budget checks and OTel spans
      // stitch all delegation hops in this flow execution into one trace.
      traceId: this.state.executionId,
    });

    return {
      result: {
        response: delegationResult.response,
        uiBlocks: delegationResult.uiBlocks,
        componentDefs: delegationResult.componentDefs,
        suggestions: delegationResult.suggestions,
        children: delegationResult.children,
        callId: delegationResult.callId,
        depth: delegationResult.depth,
      },
      creditsCharged: delegationResult.creditsUsed,
    };
  }

  /**
   * Build a context string from completed prior steps that feed into this node.
   * Uses incoming edges to find parent nodes and includes their results.
   */
  private buildPriorStepContext(node: FlowNode): string {
    const incoming = this.incomingEdges.get(node.id) ?? [];
    if (incoming.length === 0) return "";

    const contextParts: string[] = [];
    for (const edge of incoming) {
      const sourceResult = this.state.stepResults.get(edge.source);
      if (sourceResult?.status === "completed" && sourceResult.result != null) {
        const sourceNode = this.nodeMap.get(edge.source);
        const label = sourceNode?.label || edge.source;
        const resultStr =
          typeof sourceResult.result === "string"
            ? sourceResult.result
            : JSON.stringify(sourceResult.result);
        contextParts.push(`[${label}]: ${resultStr}`);
      }
    }

    return contextParts.join("\n\n");
  }

  private executeTransformNode(node: FlowNode): unknown {
    const config = node.config ?? {};
    const resolvedConfig = this.resolveTemplateVars(
      config,
      this.state.stepResults
    );

    if (typeof resolvedConfig.expression === "string") {
      return this.applyTransform(
        resolvedConfig.expression as string,
        resolvedConfig
      );
    }

    return resolvedConfig;
  }

  private executeConditionNode(node: FlowNode): unknown {
    const config = node.config ?? {};
    const resolvedConfig = this.resolveTemplateVars(
      config,
      this.state.stepResults
    );

    if (typeof resolvedConfig.condition === "string") {
      return this.evaluateCondition(
        resolvedConfig.condition as string,
        this.state.stepResults
      );
    }

    return !!resolvedConfig.value;
  }

  private executeOutputNode(node: FlowNode): unknown {
    const config = node.config ?? {};
    return this.resolveTemplateVars(config, this.state.stepResults);
  }

  // ── Feature 2: waitForInput - synchronous pause ─────────────────────────

  /**
   * Pause the engine at a waitForInput node. Does NOT block execute().
   * Sets engine state to "paused" and stores the node ID.
   * The caller (execute) checks for "paused" status and returns immediately.
   * Use resume() to provide input and continue execution.
   */
  private handleWaitForInput(node: FlowNode, totalNodes: number): void {
    const config = node.config ?? {};

    // Mark node as running
    this.state.stepResults.set(node.id, { status: "running" });
    this.emit("step:started", {
      nodeId: node.id,
      label: node.label,
      index: this.countCompleted() + 1,
      total: totalNodes,
    });

    // Set engine state to paused
    this.state.status = "paused";
    this.state.pausedAtNodeId = node.id;

    // Emit flow:paused event
    this.emit("flow:paused", {
      nodeId: node.id,
      label: node.label,
      inputSchema: config.inputSchema,
    });

    this.emitFlowState();
  }

  /**
   * Resume a paused execution by providing input for the waiting node.
   * Completes the waitForInput node with the provided input as its result,
   * then re-runs the state machine from the outgoing nodes.
   */
  async resume(nodeId: string, input: unknown): Promise<FlowExecutionState> {
    if (this.state.status !== "paused") {
      throw new Error(`Cannot resume: execution is "${this.state.status}", not "paused"`);
    }

    if (this.state.pausedAtNodeId !== nodeId) {
      throw new Error(
        `Cannot resume: execution is paused at node "${this.state.pausedAtNodeId}", not "${nodeId}"`
      );
    }

    const node = this.nodeMap.get(nodeId);
    if (!node) {
      throw new Error(`Cannot resume: node "${nodeId}" not found`);
    }

    // Complete the waitForInput node with the provided input
    this.state.stepResults.set(nodeId, {
      status: "completed",
      result: input,
      durationMs: 0,
      creditsCharged: 0,
    });

    const completedCount = this.countCompleted();
    const totalNodes = this.definition.nodes.length;
    this.emit("step:finished", {
      nodeId,
      label: node.label,
      status: "completed",
      result: input,
      durationMs: 0,
      credits: 0,
      index: completedCount,
      total: totalNodes,
    });

    // Clear paused state
    this.state.pausedAtNodeId = undefined;

    // Set up resume: continue from outgoing edges of the paused node
    const outgoing = this.outgoingEdges.get(nodeId) ?? [];
    this.resumeFromNodes = outgoing.map((e) => e.target);

    // If no outgoing edges, the flow is done - use empty array so execute
    // will proceed to final status determination
    if (this.resumeFromNodes.length === 0) {
      this.resumeFromNodes = [];
    }

    // Continue execution
    return this.execute();
  }

  // ── Feature 3: Subflow (nested flow) node ──────────────────────────────

  /**
   * Execute a nested flow as a child engine.
   * Bubbles up child events with "substep:" prefix.
   * Accumulates child credits into parent total.
   */
  private async executeSubflowNode(
    node: FlowNode
  ): Promise<{ result: unknown; creditsCharged: number }> {
    const config = node.config ?? {};
    const flowId = config.flowId as string | undefined;

    if (!flowId) {
      throw new Error(`Subflow node "${node.id}" has no config.flowId`);
    }

    // Check nesting depth
    if (this.nestingDepth + 1 > FlowExecutionEngine.MAX_NESTING_DEPTH) {
      throw new Error(
        `Subflow nesting depth exceeded: max ${FlowExecutionEngine.MAX_NESTING_DEPTH} levels allowed`
      );
    }

    // Look up the nested flow from DB (verify ownership or public)
    const dbFlows = await db
      .select({
        id: tables.orchestrationFlows.id,
        definition: tables.orchestrationFlows.definition,
        userId: tables.orchestrationFlows.userId,
        isPublic: tables.orchestrationFlows.isPublic,
      })
      .from(tables.orchestrationFlows)
      .where(
        and(
          eq(tables.orchestrationFlows.id, flowId),
          or(
            eq(tables.orchestrationFlows.userId, this.userId),
            eq(tables.orchestrationFlows.isPublic, true)
          )
        )
      )
      .limit(1);

    if (dbFlows.length === 0) {
      throw new Error(`Subflow "${flowId}" not found or not accessible`);
    }

    let childDefinition: FlowDefinition;
    try {
      const raw = dbFlows[0].definition;
      childDefinition = typeof raw === "string" ? JSON.parse(raw) : raw;
    } catch {
      throw new Error(`Subflow "${flowId}" has invalid definition`);
    }

    // Enforce cumulative node budget (prevent subflow amplification)
    const MAX_TOTAL_NODES = 100;
    const parentNodeCount = this.definition.nodes.length;
    const childNodeCount = childDefinition.nodes.length;
    if (parentNodeCount + childNodeCount > MAX_TOTAL_NODES) {
      throw new Error(
        `Subflow "${flowId}" would exceed total node budget: ${parentNodeCount} parent + ${childNodeCount} child > ${MAX_TOTAL_NODES} max`
      );
    }

    // Create child engine
    const childExecId = `${this.state.executionId}_sub_${node.id}`;
    const childEngine = new FlowExecutionEngine(
      flowId,
      childExecId,
      childDefinition,
      this.userId,
      this.callerDeploymentId,
      this.nestingDepth + 1
    );

    // Forward child events with substep prefix
    const parentNodeId = node.id;

    childEngine.on("step:started", (event: any) => {
      this.emit("substep:started", {
        parentNodeId,
        nodeId: event.nodeId,
        label: event.label,
        index: event.index,
        total: event.total,
      });
    });

    childEngine.on("step:finished", (event: any) => {
      this.emit("substep:finished", {
        parentNodeId,
        nodeId: event.nodeId,
        label: event.label,
        status: event.status,
        result: event.result,
        error: event.error,
        durationMs: event.durationMs,
        credits: event.credits,
        index: event.index,
        total: event.total,
      });
    });

    // If parent is cancelled, cancel child too
    if (this.abortController.signal.aborted) {
      childEngine.cancel();
    }
    this.abortController.signal.addEventListener("abort", () => {
      childEngine.cancel();
    }, { once: true });

    // Execute child flow
    const childState = await childEngine.execute();

    if (childState.status === "failed") {
      const childError = childEngine["findFirstError"]?.() ?? "Subflow failed";
      // Don't include the subflow's ID in the error message — repeated
      // subflow failures would walk the full call tree and leak internal
      // resource identifiers to the client. Log the full chain for ops
      // debugging via the logger (not the thrown message).
      log.warn({ subflowId: flowId, childError }, "Subflow execution failed");
      throw new Error(`Subflow failed: ${childError}`);
    }

    if (childState.status === "cancelled") {
      log.debug({ subflowId: flowId }, "Subflow was cancelled");
      throw new Error(`Subflow was cancelled`);
    }

    // Collect the final output: look for output nodes, or use all completed results
    let finalResult: unknown;
    const outputNodes = childDefinition.nodes.filter((n) => n.type === "output");
    if (outputNodes.length > 0) {
      const lastOutput = outputNodes[outputNodes.length - 1];
      finalResult = childState.stepResults.get(lastOutput.id)?.result;
    } else {
      const resultMap: Record<string, unknown> = {};
      for (const [id, sr] of childState.stepResults) {
        if (sr.status === "completed") {
          resultMap[id] = sr.result;
        }
      }
      finalResult = resultMap;
    }

    return {
      result: finalResult,
      creditsCharged: childState.totalCredits,
    };
  }

  // ── Template variable resolution ──────────────────────────────────────

  resolveTemplateVars(
    value: unknown,
    stepResults: Map<string, StepResult>
  ): any {
    if (typeof value === "string") {
      return this.resolveStringTemplate(value, stepResults);
    }

    if (Array.isArray(value)) {
      return value.map((item) => this.resolveTemplateVars(item, stepResults));
    }

    if (value !== null && typeof value === "object") {
      const resolved: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        resolved[key] = this.resolveTemplateVars(val, stepResults);
      }
      return resolved;
    }

    return value;
  }

  private resolveStringTemplate(
    template: string,
    stepResults: Map<string, StepResult>
  ): unknown {
    const pattern = /\{\{([^}]+)\}\}/g;

    const fullMatch = template.match(/^\{\{([^}]+)\}\}$/);
    if (fullMatch) {
      return this.resolveTemplatePath(fullMatch[1].trim(), stepResults);
    }

    return template.replace(pattern, (_match, path: string) => {
      const resolved = this.resolveTemplatePath(path.trim(), stepResults);
      if (resolved === undefined || resolved === null) return "";
      if (typeof resolved === "object") return JSON.stringify(resolved);
      return String(resolved);
    });
  }

  /**
   * Resolve a template path like `stage1.response` or `stage1.result.response`
   * against the current step results map.
   *
   * Supports three equivalent forms so users don't get silent empty substitutions
   * when they type the one that feels natural:
   *
   *   {{nodeId.field}}           — direct: walks node result.field
   *   {{nodeId.result.field}}    — pass-through: `.result` is aliased to the
   *                                same root (matches JS object access intuition,
   *                                since {@link StepResult.result} is already where
   *                                the data lives)
   *   {{stepN_result.field}}     — positional: nth completed step by insertion order
   *
   * Previously only forms 1 and 3 worked. Form 2 silently returned undefined
   * because the walker tried to read `.result` off the unwrapped result object,
   * which only has `response`/`uiBlocks`/etc. Found during Cycle 3 of the
   * 2026-04-11 bot teams QA marathon — flagged because the docstring on the
   * file header shows `{{stepN_result.field}}` and users (including me) wrote
   * `{{nodeId.result.field}}` assuming `.result` was part of the canonical path.
   */
  private resolveTemplatePath(
    path: string,
    stepResults: Map<string, StepResult>
  ): unknown {
    const parts = path.split(".");
    const nodeId = parts[0];

    const stepMatch = nodeId.match(/^step(\d+)_result$/);
    let stepResult: StepResult | undefined;

    if (stepMatch) {
      const stepIndex = parseInt(stepMatch[1], 10) - 1;
      const nodeIds = [...stepResults.keys()];
      if (stepIndex >= 0 && stepIndex < nodeIds.length) {
        stepResult = stepResults.get(nodeIds[stepIndex]);
      }
    } else {
      stepResult = stepResults.get(nodeId);
    }

    if (!stepResult || stepResult.status !== "completed") {
      return undefined;
    }

    let current: unknown = stepResult.result;
    // Alias: {{nodeId.result.field}} === {{nodeId.field}}. If the next path
    // segment is literally "result" and the current object does NOT have a
    // "result" key, treat it as a no-op and advance. This lets both the
    // intuitive JS-object syntax and the docstring syntax work.
    let i = 1;
    if (
      parts[1] === "result" &&
      typeof current === "object" &&
      current !== null &&
      !Object.prototype.hasOwnProperty.call(current, "result")
    ) {
      i = 2;
    }
    for (; i < parts.length; i++) {
      if (current === null || current === undefined) return undefined;
      if (typeof current === "object") {
        current = (current as Record<string, unknown>)[parts[i]];
      } else {
        return undefined;
      }
    }

    return current;
  }

  // ── Condition evaluation ──────────────────────────────────────────────

  private evaluateCondition(
    condition: string,
    stepResults: Map<string, StepResult>
  ): boolean {
    const resolved = this.resolveStringTemplate(condition, stepResults);
    const resolvedStr = String(resolved);

    const operators = ["!=", "==", ">=", "<=", ">", "<"];
    for (const op of operators) {
      const idx = resolvedStr.indexOf(op);
      if (idx === -1) continue;

      const left = resolvedStr.slice(0, idx).trim();
      const right = resolvedStr.slice(idx + op.length).trim();

      const leftNum = Number(left);
      const rightNum = Number(right);
      const useNumeric = !isNaN(leftNum) && !isNaN(rightNum);

      switch (op) {
        case "==":
          return useNumeric ? leftNum === rightNum : left === right;
        case "!=":
          return useNumeric ? leftNum !== rightNum : left !== right;
        case ">":
          return leftNum > rightNum;
        case "<":
          return leftNum < rightNum;
        case ">=":
          return leftNum >= rightNum;
        case "<=":
          return leftNum <= rightNum;
      }
    }

    // No operator found - warn about potentially malformed condition
    if (resolved && resolvedStr.length > 10) {
      log.warn({ condition, resolved }, "Condition has no recognized operator - treating as truthy check");
    }
    return !!resolved && resolved !== "false" && resolved !== "0";
  }

  // ── Transform helpers ─────────────────────────────────────────────────

  private applyTransform(
    expression: string,
    context: Record<string, unknown>
  ): unknown {
    const [op, ...argParts] = expression.split(":");
    const arg = argParts.join(":");

    const input = context.input ?? context;

    switch (op) {
      case "pick": {
        if (typeof input !== "object" || input === null) return input;
        const fields = arg.split(",").map((f) => f.trim());
        const result: Record<string, unknown> = {};
        for (const field of fields) {
          result[field] = (input as Record<string, unknown>)[field];
        }
        return result;
      }
      case "merge": {
        if (typeof input !== "object" || input === null) return input;
        return { ...input as object };
      }
      case "stringify": {
        return JSON.stringify(input);
      }
      case "parse": {
        if (typeof input === "string") {
          try {
            return JSON.parse(input);
          } catch {
            return input;
          }
        }
        return input;
      }
      default:
        return input;
    }
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private countCompleted(): number {
    let count = 0;
    for (const [, r] of this.state.stepResults) {
      if (
        r.status === "completed" ||
        r.status === "failed" ||
        r.status === "skipped"
      ) {
        count++;
      }
    }
    return count;
  }

  private emitFlowState(): void {
    this.emit("flow:state", {
      status: this.state.status,
      completedSteps: this.countCompleted(),
      totalSteps: this.definition.nodes.length,
      totalCredits: this.state.totalCredits,
    });
  }

  private async checkpointState(): Promise<void> {
    const stepResultsObj: Record<string, StepResult> = {};
    for (const [k, v] of this.state.stepResults) {
      stepResultsObj[k] = v;
    }

    await db.update(tables.flowExecutions)
      .set({
        status: this.state.status === "paused" ? "paused" as any : "running",
        stepResults: JSON.stringify(stepResultsObj),
        totalCreditsCharged: this.state.totalCredits,
      })
      .where(eq(tables.flowExecutions.id, this.state.executionId));
  }

  private async persistState(): Promise<void> {
    const stepResultsObj: Record<string, StepResult> = {};
    for (const [k, v] of this.state.stepResults) {
      stepResultsObj[k] = v;
    }

    await db.update(tables.flowExecutions)
      .set({
        status: this.state.status === "completed" ? "completed" : "failed",
        stepResults: JSON.stringify(stepResultsObj),
        totalCreditsCharged: this.state.totalCredits,
        error: this.state.status === "failed" ? this.findFirstError() : null,
        completedAt: dbDate(),
      })
      .where(eq(tables.flowExecutions.id, this.state.executionId));

    await db.insert(tables.agentCalls).values({
      id: this.state.executionId,
      callerDeploymentId:
        this.callerDeploymentId || `flow_${this.state.flowId}`,
      calleeDeploymentId: `flow_${this.state.flowId}`,
      skillName: "__flow_execution__",
      creditsCharged: this.state.totalCredits,
      status: this.state.status === "completed" ? "completed" : "failed",
      requestBody: JSON.stringify({
        flowId: this.state.flowId,
        nodeCount: this.definition.nodes.length,
      }),
      responseBody: JSON.stringify(stepResultsObj).slice(0, 10_000),
      errorMessage:
        this.state.status === "failed"
          ? this.findFirstError()
          : null,
      latencyMs: (this.state.completedAt ?? Date.now()) - this.state.startedAt,
      createdAt: dbDate(),
    } as any);
  }

  private findFirstError(): string | null {
    for (const [nodeId, r] of this.state.stepResults) {
      if (r.status === "failed" && r.error) {
        return `Node "${nodeId}": ${r.error}`;
      }
    }
    return null;
  }
}
