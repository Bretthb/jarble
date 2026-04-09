/**
 * In-process event bridge for agent-to-agent call notifications.
 *
 * When a bot calls `call_agent` via the MCP server, the request flows:
 *   Pod MCP → API /api/agent-hub/call → this emitter → chat SSE handler → frontend
 *
 * The chat SSE handler subscribes during streaming so it can push
 * CUSTOM_AGENT_CALL_START/END events to the frontend in real-time.
 */

import { EventEmitter } from "events";

export interface AgentCallStartEvent {
  deploymentId: string;
  serviceId: string;
  skillName: string;
  agentName?: string;
}

export interface AgentCallEndEvent {
  deploymentId: string;
  serviceId: string;
  skillName: string;
  agentName?: string;
  creditsCharged: number;
  success: boolean;
}

// ── Orchestration events ──────────────────────────────────────────────────

export interface OrchestrationStepEvent {
  deploymentId: string;
  stepId: string;
  agentType: "subagent" | "delegation" | "platform";
  agentName: string;       // human-readable: "Research Agent"
  toolName: string;        // MCP tool name: "agent_research"
  task?: string;           // truncated task (max 200 chars)
  targetDeploymentId?: string; // for delegations
  /**
   * Parent step id in the delegation tree. For recursive delegations this
   * mirrors `agent_calls.parent_call_id` on the row for this step. Absent
   * on top-level (entry bot → first specialist) steps.
   */
  parentStepId?: string;
  /**
   * Delegation depth — 1 for entry → first specialist, 2 for the next hop,
   * etc. 0 is reserved for non-delegation agent calls (subagent/platform).
   */
  depth?: number;
}

export interface OrchestrationStepEndEvent extends OrchestrationStepEvent {
  success: boolean;
  durationMs: number;
  error?: string;
  resultPreview?: string;  // first 200 chars of result
}

class AgentCallEmitter extends EventEmitter {}

export const agentCallEvents = new AgentCallEmitter();
agentCallEvents.setMaxListeners(100); // Many concurrent SSE streams may listen

export function emitOrchestrationStart(event: OrchestrationStepEvent): void {
  agentCallEvents.emit("orchestration:step:start", event);
}

export function emitOrchestrationEnd(event: OrchestrationStepEndEvent): void {
  agentCallEvents.emit("orchestration:step:end", event);
}
