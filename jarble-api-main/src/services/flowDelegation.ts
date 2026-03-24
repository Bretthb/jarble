/**
 * Flow Delegation Service
 *
 * Generates delegation tools from flow edges and executes delegations
 * by calling deployment chat endpoints (same as tamboAgent.ts).
 *
 * Core responsibilities:
 *   1. Build delegation "tools" from outgoing "delegates" edges
 *   2. Augment a bot's system prompt with role, goal, and delegation instructions
 *   3. Execute a delegation by sending a task to a target deployment's pod
 */

import { db, tables } from "../db/index.js";
import { eq } from "drizzle-orm";
import { createModuleLogger } from "../utils/logger.js";
import type { FlowNode, FlowEdge } from "./flowEngine.js";

const log = createModuleLogger("flow-delegation");

// ── Types ────────────────────────────────────────────────────────────────────

export interface DelegationTool {
  name: string;                   // "delegate_to_cto"
  description: string;            // Includes role and goal of target
  targetNodeId: string;
  targetDeploymentId: string;
  contextScope: "task" | "summary" | "full";
}

export interface DelegationResult {
  response: string;
  creditsUsed: number;
  durationMs: number;
  targetNodeId: string;
  targetDeploymentId: string;
}

// ── Constants ────────────────────────────────────────────────────────────────

/** Maximum delegation chain depth to prevent infinite loops */
const MAX_DELEGATION_DEPTH = 5;

/** Timeout for a single delegation call (ms) */
const DELEGATION_TIMEOUT_MS = 90_000;

// ── Build delegation tools ───────────────────────────────────────────────────

/**
 * Build delegation tools for a node based on its outgoing "delegates" edges.
 *
 * Only considers edges where type === "delegates" (or unset, defaulting to
 * "delegates" for backward compatibility). Target nodes must have a valid
 * deploymentId.
 */
export function buildDelegationTools(
  node: FlowNode,
  nodes: FlowNode[],
  edges: FlowEdge[],
): DelegationTool[] {
  if (node.canDelegate === false) return [];

  // Find all outgoing "delegates" edges from this node
  const delegateEdges = edges.filter(
    (e) => e.source === node.id && (e.type === "delegates" || !e.type),
  );

  const tools: DelegationTool[] = [];

  for (const edge of delegateEdges) {
    const targetNode = nodes.find((n) => n.id === edge.target);
    if (!targetNode || !targetNode.deploymentId) continue;

    // Build a safe function name from the target's role/label/id
    const safeName = (targetNode.role || targetNode.label || targetNode.id)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);

    const goalStr = targetNode.goal ? ` Goal: ${targetNode.goal}` : "";

    tools.push({
      name: `delegate_to_${safeName}`,
      description: `Delegate a task to ${targetNode.role || targetNode.label}.${goalStr}`,
      targetNodeId: targetNode.id,
      targetDeploymentId: targetNode.deploymentId,
      contextScope: edge.contextScope || targetNode.contextScope || "task",
    });
  }

  return tools;
}

// ── Build augmented system prompt ────────────────────────────────────────────

/**
 * Build the system prompt augmentation for a bot operating within a flow.
 * Injects role, goal, and delegation instructions, layered on top of the
 * deployment's base system prompt.
 */
export function buildFlowSystemPrompt(
  node: FlowNode,
  delegationTools: DelegationTool[],
  basePrompt: string,
): string {
  const parts = [basePrompt];

  if (node.role || node.goal) {
    parts.push("\n\n## Your Role in This Team");
    if (node.role) parts.push(`You are the **${node.role}**.`);
    if (node.goal) parts.push(`Your goal: ${node.goal}`);
  }

  if (delegationTools.length > 0 && node.canDelegate !== false) {
    parts.push("\n\n## Delegation");
    parts.push("You can delegate tasks to these team members:");
    for (const tool of delegationTools) {
      parts.push(`- **${tool.name}**: ${tool.description}`);
    }
    parts.push(
      "\nWhen the user's request falls outside your expertise or when a specialist " +
      "would produce better results, delegate to the appropriate team member. " +
      "To delegate, respond with a JSON tool call block:\n" +
      "```json\n" +
      '{ "tool": "delegate_to_<name>", "task": "the task description", "context": "optional context" }\n' +
      "```\n" +
      "Always integrate delegation results into your final response to the user. " +
      "If you can handle the request yourself, respond directly without delegating.",
    );
  }

  return parts.join("\n");
}

// ── Parse delegation tool calls from bot response ────────────────────────────

interface ParsedDelegationCall {
  toolName: string;
  task: string;
  context?: string;
}

/**
 * Parse delegation tool call JSON blocks from bot response text.
 *
 * Looks for ```json blocks containing { "tool": "delegate_to_...", "task": "..." }
 * Returns all found delegation calls (there may be multiple for broadcast delegation).
 */
export function parseDelegationCalls(text: string): ParsedDelegationCall[] {
  const calls: ParsedDelegationCall[] = [];

  // Match ```json blocks
  const jsonBlockRegex = /```json\s*\n([\s\S]*?)```/g;
  let match;
  while ((match = jsonBlockRegex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim());
      if (
        parsed.tool &&
        typeof parsed.tool === "string" &&
        parsed.tool.startsWith("delegate_to_") &&
        parsed.task &&
        typeof parsed.task === "string"
      ) {
        calls.push({
          toolName: parsed.tool,
          task: parsed.task,
          context: parsed.context,
        });
      }
    } catch {
      // Not valid JSON or not a delegation call — skip
    }
  }

  return calls;
}

// ── Execute delegation ───────────────────────────────────────────────────────

/**
 * Execute a delegation — send a task to a target deployment and get the response.
 *
 * Uses the same chat pathway as tamboAgent (exec into pod via K8s API).
 * This is the non-streaming variant: the delegation completes and the full
 * response text is returned.
 */
export async function executeDelegation(params: {
  targetDeploymentId: string;
  targetNodeId: string;
  task: string;
  context?: string;
  contextScope: "task" | "summary" | "full";
  conversationHistory?: Array<{ role: string; content: string }>;
  sessionId?: string;
  depth?: number;
}): Promise<DelegationResult> {
  const depth = params.depth ?? 0;
  if (depth >= MAX_DELEGATION_DEPTH) {
    throw new Error(
      `Delegation depth limit reached (${MAX_DELEGATION_DEPTH}). ` +
      "Possible circular delegation or overly deep chain.",
    );
  }

  const startTime = Date.now();

  // Look up the target deployment
  const deployment = await db.query.deployments.findFirst({
    where: eq(tables.deployments.id, params.targetDeploymentId),
  });

  if (!deployment) {
    throw new Error(`Delegation target not found: ${params.targetDeploymentId}`);
  }

  if (deployment.status !== "running") {
    throw new Error(
      `Delegation target "${deployment.name}" is not running (status: ${deployment.status})`,
    );
  }

  // Build the message based on context scope
  let message = params.task;
  if (params.contextScope === "summary" && params.context) {
    message = `Context: ${params.context}\n\nTask: ${params.task}`;
  } else if (params.contextScope === "full" && params.conversationHistory) {
    const history = params.conversationHistory
      .slice(-20) // Cap history to avoid massive payloads
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n");
    message = `Conversation so far:\n${history}\n\nTask: ${params.task}`;
  }

  // Find the pod for this deployment and exec into it
  const { chatViaExec } = await import("./openclawGateway.js");
  const { findPodForDeployment } = await import("../k8s/index.js");

  const podName = await findPodForDeployment(params.targetDeploymentId);
  if (!podName) {
    throw new Error(
      `No running pod found for deployment "${deployment.name}" (${params.targetDeploymentId})`,
    );
  }

  const sessionId =
    params.sessionId || `flow-delegation-${params.targetDeploymentId}-${Date.now()}`;

  log.info(
    {
      targetDeploymentId: params.targetDeploymentId,
      targetNodeId: params.targetNodeId,
      depth,
      messageLen: message.length,
    },
    "Executing delegation",
  );

  // Create an AbortController with timeout
  const abortController = new AbortController();
  const timeout = setTimeout(
    () => abortController.abort(),
    DELEGATION_TIMEOUT_MS,
  );

  try {
    const result = await chatViaExec(
      podName,
      sessionId,
      message,
      undefined, // no onDelta for delegations (not streaming to user)
      undefined, // no canvas image
      abortController.signal,
    );

    const durationMs = Date.now() - startTime;

    log.info(
      {
        targetDeploymentId: params.targetDeploymentId,
        targetNodeId: params.targetNodeId,
        durationMs,
        responseLen: result.text.length,
      },
      "Delegation completed",
    );

    return {
      response: result.text || "",
      creditsUsed: 1, // 1 credit per delegation call
      durationMs,
      targetNodeId: params.targetNodeId,
      targetDeploymentId: params.targetDeploymentId,
    };
  } finally {
    clearTimeout(timeout);
  }
}
