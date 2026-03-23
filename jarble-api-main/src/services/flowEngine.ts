/**
 * Flow Execution Engine — executes flow graphs with cycle support,
 * human-in-the-loop pausing, and nested subflow execution.
 *
 * Architecture:
 * 1. Parse flow definition -> build adjacency graph
 * 2. State-machine execution: start from entry nodes, follow edges
 * 3. Cycle support: nodes can be revisited up to maxIterations times
 * 4. waitForInput nodes pause execution until resume() is called
 * 5. subflow nodes execute a nested flow as a child engine
 * 6. Parallel execution for nodes that become ready simultaneously
 * 7. Resolve template variables: {{stepN_result.field}} -> actual values
 * 8. Bill credits via existing executeAgentCall()
 * 9. Emit SSE events for each step start/finish
 */

import { EventEmitter } from "events";
import { db, tables, dbDate } from "../db/index.js";
import { eq, and, or } from "drizzle-orm";
import { executeAgentCall } from "./marketplaceHub.js";
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
  label?: string;
  condition?: string;
}

export interface FlowDefinition {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface StepResult {
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
  durationMs?: number;
  creditsCharged?: number;
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

  /** Resolve function stored when paused on a waitForInput node */
  private resumeResolver: ((input: { nodeId: string; input: unknown }) => void) | null = null;

  /** Nesting depth for subflow execution (prevents infinite recursion) */
  private nestingDepth: number;

  /** Maximum allowed nesting depth for subflows */
  static MAX_NESTING_DEPTH = 3;

  constructor(
    flowId: string,
    executionId: string,
    private definition: FlowDefinition,
    private userId: string,
    private callerDeploymentId?: string,
    nestingDepth: number = 0
  ) {
    super();
    this.setMaxListeners(50);

    this.abortController = new AbortController();
    this.nestingDepth = nestingDepth;

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
      if (this.state.status === "paused") {
        // Paused is not an error — return current state
        return this.state;
      }
      this.state.status = "failed";
      this.emit("flow:error", {
        executionId: this.state.executionId,
        error: err.message,
      });
    }

    // If paused, don't finalize — resume() will continue
    if (this.state.status === "paused") {
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
   * 1. Find entry nodes (no incoming edges)
   * 2. Execute ready nodes in parallel
   * 3. After each node completes, follow outgoing edges
   * 4. Nodes can be revisited (cycles) up to maxIterations
   * 5. waitForInput nodes pause the engine
   */
  private async executeStateMachine(): Promise<void> {
    const totalNodes = this.definition.nodes.length;

    // Find entry nodes (nodes with no incoming edges)
    const entryNodes: string[] = [];
    for (const node of this.definition.nodes) {
      const incoming = this.incomingEdges.get(node.id) ?? [];
      if (incoming.length === 0) {
        entryNodes.push(node.id);
      }
    }

    if (entryNodes.length === 0) {
      throw new Error("No entry nodes found (all nodes have incoming edges — pure cycle with no entry point)");
    }

    // readyQueue: nodes that are ready to execute
    let readyQueue: string[] = [...entryNodes];

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

      // Collect next ready nodes from completed batch
      for (const nodeId of currentBatch) {
        const stepResult = this.state.stepResults.get(nodeId);
        if (!stepResult || stepResult.status !== "completed") continue;

        const outgoing = this.outgoingEdges.get(nodeId) ?? [];
        for (const edge of outgoing) {
          const targetId = edge.target;

          // Check if the edge condition is met
          if (edge.condition) {
            const conditionMet = this.evaluateCondition(
              edge.condition,
              this.state.stepResults
            );
            if (!conditionMet) continue;
          }

          // Check if all incoming edges for the target have their source completed
          // (or at least one source completed for cycle-back edges)
          if (this.isNodeReady(targetId)) {
            const node = this.nodeMap.get(targetId);
            if (!node) continue;

            const visitCount = this.nodeVisitCount.get(targetId) ?? 0;
            const maxIter = node.maxIterations ?? 10;

            if (visitCount >= maxIter) {
              // Max iterations reached — skip this node and emit warning
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
   * Check if a node is ready to execute.
   * A node is ready when all its non-back-edge sources have completed.
   * For cycle back-edges, the node is ready if the triggering source just completed.
   */
  private isNodeReady(nodeId: string): boolean {
    const incoming = this.incomingEdges.get(nodeId) ?? [];
    if (incoming.length === 0) return true;

    // Node is ready if at least one source has completed in this round
    // For strict DAG-like deps, all sources must be completed/failed/skipped
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
   * Handles iteration tracking and waitForInput pausing.
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

    // Check if any dependency failed — if so, skip this step
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

    // Check conditions on incoming edges
    for (const edge of incoming) {
      if (edge.condition) {
        const conditionMet = this.evaluateCondition(
          edge.condition,
          this.state.stepResults
        );
        if (!conditionMet) {
          this.state.stepResults.set(nodeId, {
            status: "skipped",
            error: `Condition not met: ${edge.condition}`,
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

    // Mark as running
    this.state.stepResults.set(node.id, { status: "running" });
    const runningIndex = this.countCompleted() + 1;
    this.emit("step:started", {
      nodeId: node.id,
      label: node.label,
      index: runningIndex,
      total: totalNodes,
    });

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
        case "waitForInput": {
          result = await this.executeWaitForInputNode(node);
          // If we got paused, return immediately — don't mark as completed
          if (this.state.status === "paused") return;
          break;
        }
        case "subflow": {
          const subResult = await this.executeSubflowNode(node);
          result = subResult.result;
          creditsCharged = subResult.creditsCharged;
          break;
        }
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
      });

      const completedCount = this.countCompleted();
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
    const serviceId = node.serviceId;
    const skillName = node.skillName || "default";

    if (!serviceId) {
      throw new Error(`Deployment node "${node.id}" has no serviceId`);
    }

    // Resolve template variables in config/args
    const resolvedArgs = this.resolveTemplateVars(
      node.config ?? {},
      this.state.stepResults
    );

    const callResult = await executeAgentCall({
      callerDeploymentId: this.callerDeploymentId || `flow_${this.state.flowId}`,
      calleeServiceId: serviceId,
      skillName,
      args: resolvedArgs,
      callerUserId: this.userId,
    });

    return {
      result: callResult.result,
      creditsCharged: callResult.creditsCharged,
    };
  }

  private executeTransformNode(node: FlowNode): unknown {
    const config = node.config ?? {};
    const resolvedConfig = this.resolveTemplateVars(
      config,
      this.state.stepResults
    );

    // Transform node: apply a JS-like expression from config.expression
    // or simply pass through resolved config as the result
    if (typeof resolvedConfig.expression === "string") {
      // Simple field extraction / mapping — NOT eval, just structured transforms
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

    // Condition nodes evaluate to true/false and return that as their result
    if (typeof resolvedConfig.condition === "string") {
      return this.evaluateCondition(
        resolvedConfig.condition as string,
        this.state.stepResults
      );
    }

    // Default: truthy check on resolved value
    return !!resolvedConfig.value;
  }

  private executeOutputNode(node: FlowNode): unknown {
    const config = node.config ?? {};
    return this.resolveTemplateVars(config, this.state.stepResults);
  }

  // ── Feature 2: waitForInput node ────────────────────────────────────────

  /**
   * Pause the engine and wait for external input via resume().
   * Returns the input value when resume() is called.
   */
  private async executeWaitForInputNode(node: FlowNode): Promise<unknown> {
    const config = node.config ?? {};

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

    // Checkpoint paused state to DB
    await this.checkpointState().catch((err) => {
      log.warn({ executionId: this.state.executionId, nodeId: node.id, err }, "Paused checkpoint failed");
    });

    // Wait for resume() to be called — returns a promise that resolves when input is provided
    const resumeInput = await new Promise<{ nodeId: string; input: unknown }>((resolve) => {
      this.resumeResolver = resolve;
    });

    // Validate that the resume is for the correct node
    if (resumeInput.nodeId !== node.id) {
      throw new Error(
        `Resume nodeId mismatch: expected "${node.id}", got "${resumeInput.nodeId}"`
      );
    }

    // Clear paused state
    this.state.status = "running";
    this.state.pausedAtNodeId = undefined;
    this.resumeResolver = null;

    return resumeInput.input;
  }

  /**
   * Resume a paused execution by providing input for the waiting node.
   */
  async resume(nodeId: string, input: unknown): Promise<void> {
    if (this.state.status !== "paused") {
      throw new Error(`Cannot resume: execution is "${this.state.status}", not "paused"`);
    }

    if (this.state.pausedAtNodeId !== nodeId) {
      throw new Error(
        `Cannot resume: execution is paused at node "${this.state.pausedAtNodeId}", not "${nodeId}"`
      );
    }

    if (!this.resumeResolver) {
      throw new Error("Cannot resume: no resume resolver registered (internal error)");
    }

    // Provide the input, which unblocks the waitForInput promise
    this.resumeResolver({ nodeId, input });
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

    // Resolve template variables for the child's context
    const resolvedConfig = this.resolveTemplateVars(
      config,
      this.state.stepResults
    );

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
      throw new Error(`Subflow "${flowId}" failed: ${childError}`);
    }

    if (childState.status === "cancelled") {
      throw new Error(`Subflow "${flowId}" was cancelled`);
    }

    // Collect the final output: look for output nodes, or use all completed results
    let finalResult: unknown;
    const outputNodes = childDefinition.nodes.filter((n) => n.type === "output");
    if (outputNodes.length > 0) {
      // Use the last output node's result
      const lastOutput = outputNodes[outputNodes.length - 1];
      finalResult = childState.stepResults.get(lastOutput.id)?.result;
    } else {
      // Return all step results as a map
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

  /**
   * Recursively resolve {{node_id.field.subfield}} template variables
   * in an object, array, or string using results from completed steps.
   */
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
    // Pattern: {{node_id.field.subfield}} or {{node_id}}
    const pattern = /\{\{([^}]+)\}\}/g;

    // If the entire string is a single template, return the raw value (preserves types)
    const fullMatch = template.match(/^\{\{([^}]+)\}\}$/);
    if (fullMatch) {
      return this.resolveTemplatePath(fullMatch[1].trim(), stepResults);
    }

    // Otherwise, do string interpolation
    return template.replace(pattern, (_match, path: string) => {
      const resolved = this.resolveTemplatePath(path.trim(), stepResults);
      if (resolved === undefined || resolved === null) return "";
      if (typeof resolved === "object") return JSON.stringify(resolved);
      return String(resolved);
    });
  }

  private resolveTemplatePath(
    path: string,
    stepResults: Map<string, StepResult>
  ): unknown {
    const parts = path.split(".");
    const nodeId = parts[0];

    // Also support the workflow agent's "stepN_result" format
    // e.g. "step1_result.field" -> look up by step index
    const stepMatch = nodeId.match(/^step(\d+)_result$/);
    let stepResult: StepResult | undefined;

    if (stepMatch) {
      const stepIndex = parseInt(stepMatch[1], 10) - 1; // 1-indexed
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

    // Navigate into the result object
    let current: unknown = stepResult.result;
    for (let i = 1; i < parts.length; i++) {
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

  /**
   * Evaluate a simple condition string. Supports:
   * - "{{node_id.field}} == value"
   * - "{{node_id.field}} != value"
   * - "{{node_id.field}} > value"  (numeric)
   * - "{{node_id.field}}" (truthy check)
   */
  private evaluateCondition(
    condition: string,
    stepResults: Map<string, StepResult>
  ): boolean {
    // Resolve any template vars in the condition string first
    const resolved = this.resolveStringTemplate(condition, stepResults);
    const resolvedStr = String(resolved);

    // Try operator patterns
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

    // Fallback: truthy check
    return !!resolved && resolved !== "false" && resolved !== "0";
  }

  // ── Transform helpers ─────────────────────────────────────────────────

  private applyTransform(
    expression: string,
    context: Record<string, unknown>
  ): unknown {
    // Simple supported transforms:
    // "pick:field1,field2" — extract fields from input
    // "merge" — merge all inputs into one object
    // "stringify" — JSON.stringify the input
    // "parse" — JSON.parse a string input
    // Default: pass through the input

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

  /**
   * Checkpoint intermediate state to flow_executions table after each step.
   * Enables crash recovery — if the server restarts, the last checkpoint
   * shows which steps completed and their results.
   */
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

  /**
   * Persist the final execution state to the DB.
   * Uses the agentCalls table for now — a dedicated flow_executions table
   * can be added later when the schema is extended.
   */
  private async persistState(): Promise<void> {
    const stepResultsObj: Record<string, StepResult> = {};
    for (const [k, v] of this.state.stepResults) {
      stepResultsObj[k] = v;
    }

    // Final checkpoint to flow_executions
    await db.update(tables.flowExecutions)
      .set({
        status: this.state.status === "completed" ? "completed" : "failed",
        stepResults: JSON.stringify(stepResultsObj),
        totalCreditsCharged: this.state.totalCredits,
        error: this.state.status === "failed" ? this.findFirstError() : null,
        completedAt: dbDate(),
      })
      .where(eq(tables.flowExecutions.id, this.state.executionId));

    // Also record in agentCalls as a flow execution summary
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
