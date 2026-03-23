/**
 * Flow Execution Engine — executes a DAG of deployment/service calls.
 *
 * Architecture:
 * 1. Parse flow definition -> build dependency graph
 * 2. Topological sort -> identify parallel execution groups
 * 3. For each group: execute steps in parallel via Promise.allSettled
 * 4. Resolve template variables: {{stepN_result.field}} -> actual values
 * 5. Bill credits via existing executeAgentCall()
 * 6. Emit SSE events for each step start/finish
 */

import { EventEmitter } from "events";
import { db, tables, dbDate } from "../db/index.js";
import { eq } from "drizzle-orm";
import { executeAgentCall } from "./marketplaceHub.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("flow-engine");

// ── Types ──────────────────────────────────────────────────────────────────

export interface FlowNode {
  id: string;
  type: "deployment" | "transform" | "condition" | "output";
  deploymentId?: string;
  serviceId?: string;
  skillName?: string;
  label: string;
  config?: Record<string, unknown>;
  position: { x: number; y: number };
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
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  stepResults: Map<string, StepResult>;
  totalCredits: number;
  startedAt: number;
  completedAt?: number;
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
  "flow:error": {
    executionId: string;
    error: string;
  };
}

// ── Engine ─────────────────────────────────────────────────────────────────

export class FlowExecutionEngine extends EventEmitter {
  private state: FlowExecutionState;
  private abortController: AbortController;
  private executionOrder: string[][] = [];
  private nodeMap: Map<string, FlowNode> = new Map();
  private incomingEdges: Map<string, FlowEdge[]> = new Map();

  constructor(
    flowId: string,
    executionId: string,
    private definition: FlowDefinition,
    private userId: string,
    private callerDeploymentId?: string
  ) {
    super();
    this.setMaxListeners(50);

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
    }

    // Index incoming edges per target node
    for (const edge of definition.edges) {
      const existing = this.incomingEdges.get(edge.target) ?? [];
      existing.push(edge);
      this.incomingEdges.set(edge.target, existing);
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

    try {
      this.executionOrder = this.buildExecutionOrder(
        this.definition.nodes,
        this.definition.edges
      );
    } catch (err: any) {
      this.state.status = "failed";
      this.state.completedAt = Date.now();
      this.emit("flow:error", {
        executionId: this.state.executionId,
        error: err.message,
      });
      return this.state;
    }

    this.state.status = "running";
    this.emitFlowState();

    try {
      // Execute groups sequentially; within each group, steps run in parallel
      for (const group of this.executionOrder) {
        if (this.abortController.signal.aborted) break;

        const results = await Promise.allSettled(
          group.map((nodeId) => this.executeStepIfReady(nodeId, totalNodes))
        );

        // Check for unhandled rejections (should not happen since executeStepIfReady catches)
        for (const r of results) {
          if (r.status === "rejected") {
            log.error(
              { executionId: this.state.executionId, err: r.reason },
              "Unexpected step rejection"
            );
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
    } catch (err: any) {
      this.state.status = "failed";
      this.emit("flow:error", {
        executionId: this.state.executionId,
        error: err.message,
      });
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

  // ── Topological sort into parallel groups ──────────────────────────────

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

  private async executeStepIfReady(
    nodeId: string,
    totalNodes: number
  ): Promise<void> {
    const node = this.nodeMap.get(nodeId);
    if (!node) return;

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
        default:
          throw new Error(`Unknown node type: ${node.type}`);
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
        status: "running",
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
