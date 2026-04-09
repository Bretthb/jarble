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
}

export interface OrchestrationStepEndEvent extends OrchestrationStepEvent {
  success: boolean;
  durationMs: number;
  error?: string;
  resultPreview?: string;  // first 200 chars of result
}

// ── Cost events ─────────────────────────────────────────────────────────────

export interface CostDeltaEvent {
  deploymentId: string;
  callId: string;
  stepId: string;
  costCents: number;
  promptTokens: number;
  completionTokens: number;
  modelId: string;
  depth: number;
}

export interface CostTotalEvent {
  deploymentId: string;
  traceId: string;
  totalCostCents: number;
  hopCount: number;
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

export function emitCostDelta(event: CostDeltaEvent): void {
  agentCallEvents.emit("cost:delta", event);
}

export function emitCostTotal(event: CostTotalEvent): void {
  agentCallEvents.emit("cost:total", event);
}
