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

class AgentCallEmitter extends EventEmitter {}

export const agentCallEvents = new AgentCallEmitter();
agentCallEvents.setMaxListeners(100); // Many concurrent SSE streams may listen
