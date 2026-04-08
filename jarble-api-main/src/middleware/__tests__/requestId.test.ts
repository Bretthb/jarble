/**
 * Unit tests for the requestId / W3C traceparent middleware.
 *
 * JAR-51 Phase 2 — these tests pin the contract:
 *   - requestId is hex-only (so it doubles as the prefix of a W3C trace id)
 *   - traceId is exactly 32 lowercase hex chars (W3C spec compliant)
 *   - incoming traceparent header is honored as the canonical id
 *   - incoming X-Request-ID header is preserved if no traceparent
 *   - both unset → fresh generated id
 */
import { describe, it, expect, vi } from "vitest";
import { requestIdMiddleware } from "../requestId.js";
import type { Request, Response, NextFunction } from "express";

// Mock the logger so we don't pull in pino in unit tests.
vi.mock("../../utils/logger.js", () => ({
  createRequestLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => ({}),
  }),
}));

// Mock OTel so the middleware doesn't try to look up a real span.
vi.mock("@opentelemetry/api", () => ({
  trace: { getSpan: vi.fn(() => null) },
  context: { active: vi.fn(() => null) },
}));

function makeReq(headers: Record<string, string> = {}): Request {
  return { headers } as unknown as Request;
}

function run(req: Request) {
  const res = {} as Response;
  let nextCalled = false;
  const next: NextFunction = () => {
    nextCalled = true;
  };
  requestIdMiddleware(req, res, next);
  expect(nextCalled).toBe(true);
  return req;
}

describe("requestIdMiddleware (W3C trace context)", () => {
  describe("with no incoming headers", () => {
    it("generates a hex-only requestId of length 16", () => {
      const req = run(makeReq());
      expect(req.requestId).toMatch(/^[0-9a-f]{16}$/);
    });

    it("generates a W3C-spec-compliant 32-char trace id", () => {
      const req = run(makeReq());
      expect(req.traceId).toMatch(/^[0-9a-f]{32}$/);
    });

    it("trace id is deterministically derived from requestId (zero-padded)", () => {
      const req = run(makeReq());
      // The first 16 hex chars of the trace id MUST match the requestId
      // so log correlation works without a join table.
      expect(req.traceId.startsWith(req.requestId)).toBe(true);
      // And the remaining 16 chars are zero-padding.
      expect(req.traceId.slice(16)).toBe("0".repeat(16));
    });
  });

  describe("with X-Request-ID header", () => {
    it("preserves the incoming requestId verbatim", () => {
      const req = run(makeReq({ "x-request-id": "incoming-id-123" }));
      expect(req.requestId).toBe("incoming-id-123");
    });

    it("strips non-hex chars when promoting requestId to trace id", () => {
      // "incoming-id-123" → only hex chars [0-9a-f]: c, d, 1, 2, 3 → "cd123"
      // Then zero-padded to 32 hex chars.
      const req = run(makeReq({ "x-request-id": "incoming-id-123" }));
      expect(req.traceId).toMatch(/^[0-9a-f]{32}$/);
      expect(req.traceId.startsWith("cd123")).toBe(true);
      expect(req.traceId).toBe("cd123" + "0".repeat(27));
    });

    it("handles a hex-only x-request-id by zero-padding to 32 chars", () => {
      const req = run(makeReq({ "x-request-id": "abc123" }));
      expect(req.traceId).toBe("abc123" + "0".repeat(26));
    });

    it("truncates an oversized x-request-id to 32 hex chars", () => {
      // 40 hex chars input — should become exactly 32
      const longHex = "a".repeat(40);
      const req = run(makeReq({ "x-request-id": longHex }));
      expect(req.traceId).toBe("a".repeat(32));
      expect(req.traceId.length).toBe(32);
    });
  });

  describe("with W3C traceparent header (wins over x-request-id)", () => {
    it("extracts the trace_id from a valid traceparent header", () => {
      const tid = "0123456789abcdef0123456789abcdef";
      const sid = "0123456789abcdef";
      const req = run(
        makeReq({ traceparent: `00-${tid}-${sid}-01` }),
      );
      expect(req.traceId).toBe(tid);
    });

    it("uses traceparent's trace-id even when x-request-id is also present", () => {
      const tid = "fedcba9876543210fedcba9876543210";
      const sid = "0123456789abcdef";
      const req = run(
        makeReq({
          traceparent: `00-${tid}-${sid}-01`,
          "x-request-id": "should-be-ignored",
        }),
      );
      expect(req.traceId).toBe(tid);
      // The friendly requestId is x-request-id when present
      expect(req.requestId).toBe("should-be-ignored");
    });

    it("falls back to traceparent's first 16 hex when no x-request-id", () => {
      const tid = "abcdef0123456789abcdef0123456789";
      const sid = "0123456789abcdef";
      const req = run(makeReq({ traceparent: `00-${tid}-${sid}-01` }));
      expect(req.requestId).toBe("abcdef0123456789");
    });

    it("rejects malformed traceparent (wrong version)", () => {
      // Version "01" is not yet defined; we MUST ignore unknown versions per spec
      const req = run(
        makeReq({ traceparent: "01-0123456789abcdef0123456789abcdef-0123456789abcdef-01" }),
      );
      // Falls back to fresh generation
      expect(req.traceId.length).toBe(32);
      expect(req.requestId.length).toBe(16);
    });

    it("rejects malformed traceparent (wrong trace_id length)", () => {
      const req = run(makeReq({ traceparent: "00-tooshort-0123456789abcdef-01" }));
      expect(req.traceId.length).toBe(32);
    });

    it("rejects traceparent with non-hex chars in trace_id", () => {
      // 32 chars but contains 'g' which is not hex
      const req = run(
        makeReq({ traceparent: "00-gggggggggggggggggggggggggggggggg-0123456789abcdef-01" }),
      );
      expect(req.traceId).not.toContain("g");
      expect(req.traceId).toMatch(/^[0-9a-f]{32}$/);
    });
  });

  describe("attaches correctly to req", () => {
    it("sets req.requestId, req.traceId, and req.log", () => {
      const req = run(makeReq());
      expect(req.requestId).toBeDefined();
      expect(req.traceId).toBeDefined();
      expect(req.log).toBeDefined();
      expect(typeof req.log.info).toBe("function");
    });
  });
});
