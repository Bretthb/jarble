import type { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { createRequestLogger } from "../utils/logger.js";
import type { Logger } from "pino";
import { trace, context as otelContext } from "@opentelemetry/api";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
      /**
       * The active OTel trace id for this request, if a span is in progress.
       * Set by `requestIdMiddleware` after the OTel HTTP auto-instrumentation
       * has created its server span. Empty string if OTel is not configured
       * or if there's no active span context (rare — would indicate a bug
       * in the SDK init).
       */
      traceId: string;
    }
  }
}

/**
 * Attaches a unique requestId and a scoped Pino child logger to every request.
 *
 * The requestId is hex-only (16 chars) and is also used as the W3C
 * trace-id when no incoming traceparent header is present. This means:
 *
 *   - The pino `requestId` field == the OTel trace_id for the same request.
 *     Cross-tool correlation is one grep away.
 *   - The downstream services we call (chatViaExec, openclawGateway, MCP)
 *     can be passed `traceparent: 00-{requestId}-{spanId}-01` so the whole
 *     fractal delegation tree stitches into one trace.
 *
 * Respects incoming X-Request-ID header (e.g., from Traefik) AND incoming
 * `traceparent` header (W3C tracecontext spec). If both are present, the
 * traceparent's trace-id wins (it's the canonical wire-format identity).
 */

// W3C trace-id is exactly 32 lowercase hex chars (16 bytes).
// We pad/strip the inbound requestId so it always satisfies the spec.
const HEX_ALPHABET = "0123456789abcdef";
const TRACE_ID_LEN = 32;

function toW3CTraceId(input: string): string {
  // Strip any non-hex chars, lowercase, then pad/truncate to 32.
  const cleaned = input.toLowerCase().replace(/[^0-9a-f]/g, "");
  if (cleaned.length >= TRACE_ID_LEN) return cleaned.slice(0, TRACE_ID_LEN);
  // Pad with deterministic zeros — we don't want non-deterministic IDs
  // because then a single requestId would map to a new trace each call.
  return cleaned.padEnd(TRACE_ID_LEN, "0");
}

function generateHexRequestId(): string {
  // 16 hex chars (8 bytes) — looks like the prefix of a real W3C trace id
  // and is friendly to copy/paste in logs. The full 32-char trace id is
  // derived from this by zero-padding.
  let s = "";
  for (let i = 0; i < 16; i++) {
    s += HEX_ALPHABET[Math.floor(Math.random() * 16)];
  }
  return s;
}

function parseTraceparent(header: string | undefined): { traceId: string; parentSpanId: string } | null {
  // W3C traceparent format: 00-<trace-id>-<parent-id>-<flags>
  // version (2) - trace_id (32) - parent_id (16) - flags (2)
  if (!header) return null;
  const parts = header.trim().split("-");
  if (parts.length !== 4) return null;
  const [version, traceId, parentSpanId, flags] = parts;
  if (version !== "00") return null;
  if (traceId.length !== 32 || !/^[0-9a-f]{32}$/.test(traceId)) return null;
  if (parentSpanId.length !== 16 || !/^[0-9a-f]{16}$/.test(parentSpanId)) return null;
  if (flags.length !== 2) return null;
  return { traceId, parentSpanId };
}

export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  // 1. Try to honor an incoming X-Request-ID header (e.g., Traefik in front
  //    of us already assigned one — preserve it for log correlation).
  // 2. Try to honor an incoming W3C traceparent header — if present, the
  //    trace-id from that header is the canonical id.
  // 3. Otherwise generate a fresh hex request id.
  const incomingTraceparent = parseTraceparent(req.headers["traceparent"] as string);
  const incomingRequestId = req.headers["x-request-id"] as string;

  let requestId: string;
  let traceId: string;

  if (incomingTraceparent) {
    // Wire-format trace context wins. Use a short prefix as the human-friendly
    // requestId so logs stay readable.
    traceId = incomingTraceparent.traceId;
    requestId = incomingRequestId || traceId.slice(0, 16);
  } else if (incomingRequestId) {
    // Caller-supplied request id. Promote it to a W3C trace id.
    requestId = incomingRequestId;
    traceId = toW3CTraceId(incomingRequestId);
  } else {
    // No correlation hint — fabricate one.
    requestId = generateHexRequestId();
    traceId = toW3CTraceId(requestId);
  }

  req.requestId = requestId;
  req.traceId = traceId;
  req.log = createRequestLogger(requestId);

  // Best-effort: bind the OTel context to the active span if one exists.
  // The HTTP auto-instrumentation creates a server span before this
  // middleware runs, so `trace.getActiveSpan()` should return it. We can't
  // override the span's trace_id (it's frozen at creation), but we record
  // our own requestId on it as a span attribute so anyone querying the
  // trace backend can join on either column.
  try {
    const activeSpan = trace.getSpan(otelContext.active());
    if (activeSpan) {
      activeSpan.setAttribute("jarble.request_id", requestId);
      // Reverse direction: log the OTel trace id (which may differ from
      // requestId in the no-incoming-header case) so logs can deep-link
      // back to the trace backend.
      const spanCtx = activeSpan.spanContext();
      if (spanCtx && spanCtx.traceId) {
        req.traceId = spanCtx.traceId;
      }
    }
  } catch {
    // OTel may not be initialized yet (test env, missing SDK). That's fine.
  }

  next();
}
