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
import { trace, context as otelContext } from "@opentelemetry/api";
import { db, dbDate, tables } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { eq, sql } from "drizzle-orm";

const logger = createModuleLogger("agentCallsWriter");

// W3C trace-id = 16 random bytes, hex-encoded → 32 chars.
// W3C span-id  = 8 random bytes,  hex-encoded → 16 chars.
const hexAlphabet = "0123456789abcdef";
const genTraceId = customAlphabet(hexAlphabet, 32);
const genSpanId = customAlphabet(hexAlphabet, 16);

/**
 * Runaway cost circuit breaker (JAR-51 Phase 6).
 *
 * Prevents a single chat turn from producing an unbounded number of
 * fractal delegation hops. Two safety rails:
 *
 *   1. MAX_SPANS_PER_TRACE — total agent_calls rows per trace_id.
 *      Default 50 (plenty of headroom for 4-level delegation trees).
 *      Override: JARBLE_MAX_SPANS_PER_TRACE
 *
 *   2. MAX_CREDITS_PER_TRACE_CENTS — cumulative credits_charged across
 *      all completed rows in a trace. Default 500 (= $5). When the
 *      running total exceeds this, the next startAgentCall is rejected
 *      with a bot-readable error.
 *      Override: JARBLE_MAX_CREDITS_PER_TRACE_CENTS
 *
 * The cost check only fires for depth >= 1 (delegation hops), not
 * depth 0 chat_turns, so every root call gets to run at least once.
 *
 * Both checks are best-effort: the SELECT runs in parallel with the
 * critical path, and if the query fails we LET THE CALL THROUGH and
 * log a warning. Observability must never break the app.
 */
const MAX_SPANS_PER_TRACE = (() => {
  const raw = process.env.JARBLE_MAX_SPANS_PER_TRACE;
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n > 0 && n < 10_000) return Math.floor(n);
  return 50;
})();

const MAX_CREDITS_PER_TRACE_CENTS = (() => {
  const raw = process.env.JARBLE_MAX_CREDITS_PER_TRACE_CENTS;
  const n = raw ? Number(raw) : NaN;
  if (Number.isFinite(n) && n >= 0 && n < 1_000_000) return Math.floor(n);
  return 500; // $5.00 per trace
})();

export class RunawayTraceError extends Error {
  public readonly reason: "spans" | "credits";
  public readonly limit: number;
  public readonly actual: number;
  constructor(reason: "spans" | "credits", limit: number, actual: number) {
    super(
      reason === "spans"
        ? `Runaway delegation detected — this conversation has already produced ${actual} spans (limit: ${limit}). The call was blocked to prevent infinite loops. If this is unexpected, check for a bot delegating in a cycle.`
        : `Runaway cost detected — this conversation has already charged ${actual} credit cents (limit: ${limit}). The call was blocked to prevent runaway cost. If you need a higher limit, increase JARBLE_MAX_CREDITS_PER_TRACE_CENTS.`,
    );
    this.name = "RunawayTraceError";
    this.reason = reason;
    this.limit = limit;
    this.actual = actual;
  }
}

/**
 * Query cumulative stats for a trace. Returns a best-effort snapshot
 * and NEVER throws. When DB is wedged this returns zeros, which is
 * the "let the call through" fallback.
 */
async function getTraceStats(traceId: string): Promise<{ spanCount: number; creditsCents: number }> {
  try {
    // Intentionally no postgres-specific casts so the SQLite test mirror
    // executes the same query. drizzle returns count() as a string in
    // postgres so we Number() coerce defensively.
    const rows = await db
      .select({
        spanCount: sql<number>`count(*)`,
        creditsCents: sql<number>`coalesce(sum(${tables.agentCalls.creditsCharged}), 0)`,
      })
      .from(tables.agentCalls)
      .where(eq(tables.agentCalls.traceId, traceId));
    const row = rows[0];
    return {
      spanCount: Number(row?.spanCount ?? 0),
      creditsCents: Number(row?.creditsCents ?? 0),
    };
  } catch (err) {
    logger.warn(
      { err: err instanceof Error ? err.message : err, traceId },
      "getTraceStats query failed — letting the call through (fail-open)",
    );
    return { spanCount: 0, creditsCents: 0 };
  }
}

/**
 * Runaway circuit breaker check. Throws RunawayTraceError when tripped.
 * Only fires for non-zero depth so root calls always succeed.
 */
async function checkRunawayLimits(traceId: string, depth: number): Promise<void> {
  if (depth <= 0) return;
  const { spanCount, creditsCents } = await getTraceStats(traceId);
  if (spanCount >= MAX_SPANS_PER_TRACE) {
    throw new RunawayTraceError("spans", MAX_SPANS_PER_TRACE, spanCount);
  }
  if (creditsCents >= MAX_CREDITS_PER_TRACE_CENTS) {
    throw new RunawayTraceError("credits", MAX_CREDITS_PER_TRACE_CENTS, creditsCents);
  }
}

/**
 * JAR-51 Phase 2 OTel bridge — when an OTel span is active on the calling
 * code path, reuse its trace_id / span_id so the agent_calls rows correlate
 * with the exported Langfuse traces. When no active span (e.g. a background
 * job or a test), fall back to the nanoid generator so rows still work.
 *
 * Returns { traceId, spanId } — the span_id is the CURRENT active span's id,
 * which the caller will use as `parent_span_id` on downstream hops. The row
 * itself still gets a fresh span_id per logical DB row — this lets multiple
 * rows share a trace while remaining individually addressable.
 */
function resolveOtelContext(
  fallbackTraceId: string | null,
  fallbackParentSpanId: string | null,
): { traceId: string; parentSpanId: string | null } {
  const activeSpan = trace.getSpan(otelContext.active());
  if (activeSpan) {
    const sc = activeSpan.spanContext();
    // valid span context has non-zero trace/span ids
    if (sc.traceId && sc.traceId !== "00000000000000000000000000000000") {
      return {
        traceId: sc.traceId,
        // If the caller explicitly passed a parentSpanId, honor it;
        // otherwise use the active span as the parent.
        parentSpanId: fallbackParentSpanId ?? sc.spanId,
      };
    }
  }
  return {
    traceId: fallbackTraceId || genTraceId(),
    parentSpanId: fallbackParentSpanId,
  };
}

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
 * pass to `finishAgentCall`. Throwing behavior:
 *
 *   - **RunawayTraceError** IS thrown when the circuit breaker trips
 *     (Phase 6, MAX_SPANS_PER_TRACE or MAX_CREDITS_PER_TRACE_CENTS).
 *     Callers MUST handle this error and treat it as a terminal
 *     delegation failure — that's the whole point of the breaker.
 *     See flowDelegation.ts for the preferred try/catch pattern that
 *     re-throws RunawayTraceError while swallowing other errors.
 *
 *   - **Any OTHER error** (DB outage, transient network, etc.) is
 *     caught internally, logged, and the function returns a valid
 *     handle (the row simply won't be in the audit table). This
 *     preserves the "DB outage doesn't break the delegation path"
 *     contract that predates the circuit breaker.
 */
export async function startAgentCall(
  input: StartAgentCallInput,
): Promise<StartedAgentCall> {
  const callId = `acl_${Math.random().toString(36).slice(2, 14)}${Date.now().toString(36)}`;
  // Bridge to OTel active span context when available (JAR-51 Phase 2).
  // The resolver reuses the active trace_id and, when the caller didn't pass
  // an explicit parent_span_id, uses the current OTel span as the parent.
  const otelCtx = resolveOtelContext(input.traceId, input.parentSpanId);
  const traceId = otelCtx.traceId;
  const spanId = genSpanId();
  const resolvedParentSpanId = otelCtx.parentSpanId;
  const startedAt = Date.now();

  // Runaway circuit breaker (JAR-51 Phase 6). Rejects calls in
  // traces that have exceeded per-trace span count or cumulative
  // credits. Only fires for depth >= 1 so root calls always succeed.
  // Throws RunawayTraceError on trip — callers should treat this as
  // a terminal failure of the delegation and surface the error text
  // to the user.
  await checkRunawayLimits(traceId, input.depth);
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
      parentSpanId: resolvedParentSpanId,
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

  return { callId, traceId, spanId, parentSpanId: resolvedParentSpanId, parentCallId: input.parentCallId, depth: input.depth, startedAt };
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
