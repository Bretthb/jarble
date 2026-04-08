/**
 * agentCallsWriter — Phase 1 of the orchestration observability plan
 * (see docs/audits/orchestration-observability-plan.md).
 *
 * This module is the single choke point for writing `agent_calls` rows.
 * Every delegation hop, every chat turn, every flow step that wants audit
 * coverage goes through here. The writer is deliberately:
 *
 *   1. Fire-and-forget. Never throws, never blocks the hot path. All
 *      database operations are wrapped in try/catch and log on failure.
 *      Observability must never break the application.
 *
 *   2. Insert-then-update. Unlike marketplaceHub.ts which writes once at
 *      the end, we insert a "pending" row on call start and update it on
 *      finish. This lets:
 *        - In-flight calls be visible in the debug drawer
 *        - The runaway cost circuit breaker (Phase 5) count live spans
 *        - Abandoned calls be reaped by a nightly job (`status=pending`
 *          older than 10 min → `abandoned`)
 *
 *   3. OTel-ready. We populate trace_id / span_id / parent_span_id /
 *      span_name / attributes from day one even though Phase 2 hasn't
 *      wired the SDK yet. This means Phase 2 just flips the source of
 *      those IDs from our own nanoid generator to the OTel context.
 *
 *   4. Bounded writes. Request/response bodies are truncated to 10 KB,
 *      matching marketplaceHub. Attributes JSONB is intentionally small.
 */

import { customAlphabet } from "nanoid";
import { db, dbDate, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { eq } from "drizzle-orm";

const logger = createModuleLogger("agentCallsWriter");

// W3C trace-id = 16 random bytes, hex-encoded → 32 chars.
// W3C span-id  = 8 random bytes,  hex-encoded → 16 chars.
const hexAlphabet = "0123456789abcdef";
const genTraceId = customAlphabet(hexAlphabet, 32);
const genSpanId = customAlphabet(hexAlphabet, 16);

const MAX_BODY_CHARS = 10_000;

export type AgentCallKind = "delegation" | "chat_turn" | "tool" | "flow_step" | "llm";
export type AgentCallStatus = "pending" | "completed" | "failed" | "refunded";

export interface StartAgentCallInput {
  /** The `kind` of work this span represents. Drives span name defaults. */
  kind: AgentCallKind;
  /** e.g. "delegate_to_designer", "ask_team", "executeStep:node-3". */
  skillName: string;
  /** Who initiated the call. Null for root chat turns that haven't
   *  delegated yet (the user's browser is the caller). */
  callerDeploymentId: string | null;
  /** Target deployment. Null for root chat turns or in-process flow steps. */
  calleeDeploymentId: string | null;
  /** Parent row id so we can reconstruct the delegation tree. Null for
   *  root spans. */
  parentCallId: string | null;
  /** Parent span id for OTel compatibility. Usually equals the parent
   *  row's span_id. */
  parentSpanId: string | null;
  /** Trace id is the root of the whole fractal tree for one user turn.
   *  Pass through from the parent if one exists, otherwise generate. */
  traceId: string | null;
  /** How deep in the delegation tree. Root = 0, first delegation = 1. */
  depth: number;
  /** User that kicked off the trace. Stays on every child span for
   *  per-user billing rollups. */
  userId: string | null;
  /** Org scope for org-level queries. */
  orgId?: string | null;
  /** OpenClaw session / conversation identifier. */
  sessionId?: string | null;
  /** The pod this span is executing in. */
  podName?: string | null;
  /** OTel service.name — e.g. "jarble-api", "openclaw-runtime". */
  serviceName?: string;
  /** Short span name following the plan's conventions:
   *  "jarble.chat.turn", "jarble.delegation.hop", "jarble.flow.step" ... */
  spanName?: string;
  /** Truncated request payload. Will be JSON.stringify'd + capped. */
  requestBody?: unknown;
  /** Extra attributes for the OTel span. Will be stored as JSONB. */
  attributes?: Record<string, unknown>;
}

export interface StartedAgentCall {
  callId: string;
  traceId: string;
  spanId: string;
  parentSpanId: string | null;
  parentCallId: string | null;
  depth: number;
  startedAt: number; // ms epoch for latency calc
}

/**
 * Insert a `pending` agent_calls row and return the IDs the caller must
 * pass to `finishAgentCall`. Never throws — if the insert fails the
 * returned object still has fresh IDs so downstream code that references
 * them keeps working (the span will just be missing from the audit table).
 */
export async function startAgentCall(
  input: StartAgentCallInput,
): Promise<StartedAgentCall> {
  const callId = `acl_${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`;
  const traceId = input.traceId || genTraceId();
  const spanId = genSpanId();
  const startedAt = Date.now();
  const spanName =
    input.spanName ||
    (input.kind === "chat_turn"
      ? "jarble.chat.turn"
      : input.kind === "delegation"
        ? "jarble.delegation.hop"
        : input.kind === "tool"
          ? "jarble.tool.call"
          : input.kind === "flow_step"
            ? "jarble.flow.step"
            : input.kind === "llm"
              ? "jarble.llm.call"
              : "jarble.unknown");

  const requestBodyText =
    input.requestBody === undefined
      ? null
      : typeof input.requestBody === "string"
        ? input.requestBody.slice(0, MAX_BODY_CHARS)
        : JSON.stringify(input.requestBody).slice(0, MAX_BODY_CHARS);

  try {
    await db.insert(tables.agentCalls).values({
      id: callId,
      callerDeploymentId: input.callerDeploymentId,
      calleeDeploymentId: input.calleeDeploymentId,
      skillName: input.skillName,
      status: "pending",
      requestBody: requestBodyText,
      parentCallId: input.parentCallId,
      depth: input.depth,
      kind: input.kind,
      traceId,
      spanId,
      parentSpanId: input.parentSpanId,
      spanName,
      spanKind: "internal",
      serviceName: input.serviceName || "jarble-api",
      podName: input.podName || null,
      userId: input.userId,
      orgId: input.orgId || null,
      sessionId: input.sessionId || null,
      startMs: startedAt,
      statusCode: "ok",
      attributes: input.attributes || {},
      createdAt: dbDate(),
    } as any);
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, callId, spanName, depth: input.depth },
      "startAgentCall insert failed (non-fatal — span will be missing from audit)",
    );
  }

  return { callId, traceId, spanId, parentSpanId: input.parentSpanId, parentCallId: input.parentCallId, depth: input.depth, startedAt };
}

export interface FinishAgentCallInput {
  call: StartedAgentCall;
  status: Exclude<AgentCallStatus, "pending">;
  responseBody?: unknown;
  errorMessage?: string;
  creditsCharged?: number;
  /** Extra attributes to merge into the span on finish. */
  attributes?: Record<string, unknown>;
}

/**
 * Update a previously-started `agent_calls` row with terminal status and
 * timing. Never throws.
 */
export async function finishAgentCall(input: FinishAgentCallInput): Promise<void> {
  const { call, status } = input;
  const finishedAt = Date.now();
  const durationMs = finishedAt - call.startedAt;

  const responseBodyText =
    input.responseBody === undefined
      ? null
      : typeof input.responseBody === "string"
        ? input.responseBody.slice(0, MAX_BODY_CHARS)
        : JSON.stringify(input.responseBody).slice(0, MAX_BODY_CHARS);

  try {
    await db
      .update(tables.agentCalls)
      .set({
        status,
        responseBody: responseBodyText,
        errorMessage: input.errorMessage || null,
        latencyMs: durationMs,
        durationMs,
        endMs: finishedAt,
        creditsCharged: input.creditsCharged ?? 0,
        statusCode: status === "completed" ? "ok" : "error",
        ...(input.attributes ? { attributes: input.attributes } : {}),
      } as any)
      .where(eq(tables.agentCalls.id, call.callId));
  } catch (err) {
    logger.warn(
      {
        err: err instanceof Error ? err.message : err,
        callId: call.callId,
        status,
        durationMs,
      },
      "finishAgentCall update failed (non-fatal — span row will stay pending)",
    );
  }
}
