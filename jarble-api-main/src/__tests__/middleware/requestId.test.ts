/**
 * Unit tests for the pure helpers in src/middleware/requestId.ts.
 *
 * Three internal helpers exported for testing:
 *
 *   - `toW3CTraceId(input)` — coerces an arbitrary string into a
 *     valid 32-char W3C trace-id (lowercase hex). Strips non-hex,
 *     pads/truncates deterministically.
 *
 *   - `generateHexRequestId()` — fabricates a 16-char hex string
 *     used as the human-friendly request id when nothing came in.
 *
 *   - `parseTraceparent(header)` — strict parser for the W3C
 *     `traceparent` header. Returns null on any malformed input.
 *
 * The trace-id correlation is the spine of fractal-delegation
 * observability: every log line, every span, every webhook all
 * stitch on the same id. A regression in any of these three
 * helpers would silently fragment traces across our pino logs +
 * OTel spans + downstream pod logs.
 */

import { describe, it, expect } from "vitest";
import {
  toW3CTraceId,
  generateHexRequestId,
  parseTraceparent,
} from "../../middleware/requestId.js";

// ── toW3CTraceId ────────────────────────────────────────────────────────────

describe("toW3CTraceId", () => {
  it("returns input unchanged when it's already a valid 32-char lowercase hex", () => {
    const ok = "abcdef0123456789abcdef0123456789";
    expect(toW3CTraceId(ok)).toBe(ok);
  });

  it("lowercases mixed-case hex input", () => {
    const out = toW3CTraceId("ABCDEF0123456789ABCDEF0123456789");
    expect(out).toBe("abcdef0123456789abcdef0123456789");
  });

  it("strips non-hex characters before pad/truncate", () => {
    // Hyphens are common (UUID format) — must be removed.
    const out = toW3CTraceId("aaaa-bbbb-cccc-dddd");
    expect(out).toMatch(/^[0-9a-f]{32}$/);
    // The 16 hex chars are preserved at the start.
    expect(out.startsWith("aaaabbbbccccdddd")).toBe(true);
    // Padded with zeros.
    expect(out.endsWith("0".repeat(16))).toBe(true);
  });

  it("truncates input longer than 32 chars without dropping the prefix", () => {
    const long = "0123456789abcdef0123456789abcdef" + "morechars";
    const out = toW3CTraceId(long);
    expect(out.length).toBe(32);
    expect(out).toBe("0123456789abcdef0123456789abcdef");
  });

  it("pads short input with deterministic zeros (same input → same output)", () => {
    // The padding has to be deterministic — otherwise a single
    // requestId would map to a NEW trace id on every call.
    const a = toW3CTraceId("abc");
    const b = toW3CTraceId("abc");
    expect(a).toBe(b);
    expect(a).toBe("abc" + "0".repeat(29));
  });

  it("returns 32 zeros for an empty input", () => {
    expect(toW3CTraceId("")).toBe("0".repeat(32));
  });

  it("returns 32 zeros for input with no hex chars at all", () => {
    expect(toW3CTraceId("zzzzzzzz")).toBe("0".repeat(32));
  });

  it("output is always exactly 32 chars and matches /^[0-9a-f]{32}$/", () => {
    for (const sample of ["", "x", "abc", "uuid-with-hyphens", "ABCDEF".repeat(20)]) {
      const out = toW3CTraceId(sample);
      expect(out).toHaveLength(32);
      expect(out).toMatch(/^[0-9a-f]{32}$/);
    }
  });
});

// ── generateHexRequestId ────────────────────────────────────────────────────

describe("generateHexRequestId", () => {
  it("returns a 16-character lowercase hex string", () => {
    const id = generateHexRequestId();
    expect(id).toHaveLength(16);
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces non-deterministic output (16 calls, expect mostly distinct)", () => {
    // 16 calls of a 64-bit-equivalent random space → collision prob
    // is astronomically low. We allow at most 1 duplicate to be
    // robust to flaky CI Math.random.
    const ids = new Set<string>();
    for (let i = 0; i < 16; i++) ids.add(generateHexRequestId());
    expect(ids.size).toBeGreaterThanOrEqual(15);
  });
});

// ── parseTraceparent ────────────────────────────────────────────────────────

describe("parseTraceparent — accept", () => {
  it("parses a canonical traceparent header", () => {
    const header = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
    const out = parseTraceparent(header);
    expect(out).toEqual({
      traceId: "0123456789abcdef0123456789abcdef",
      parentSpanId: "0123456789abcdef",
    });
  });

  it("trims surrounding whitespace before parsing", () => {
    const header = "  00-0123456789abcdef0123456789abcdef-0123456789abcdef-01  ";
    const out = parseTraceparent(header);
    expect(out).not.toBeNull();
    expect(out?.traceId).toBe("0123456789abcdef0123456789abcdef");
  });

  it("accepts other valid flag values (the parser only checks length=2, not specific bits)", () => {
    // 'ff' is a valid 2-char flags value the wire spec uses.
    const header = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-ff";
    const out = parseTraceparent(header);
    expect(out).not.toBeNull();
  });
});

describe("parseTraceparent — reject", () => {
  it("returns null for undefined / empty header", () => {
    expect(parseTraceparent(undefined)).toBeNull();
    expect(parseTraceparent("")).toBeNull();
  });

  it("returns null when version is not '00'", () => {
    const header = "01-0123456789abcdef0123456789abcdef-0123456789abcdef-01";
    expect(parseTraceparent(header)).toBeNull();
  });

  it("returns null when trace-id is not exactly 32 hex chars", () => {
    // Too short
    expect(parseTraceparent("00-abc-0123456789abcdef-01")).toBeNull();
    // Too long
    expect(parseTraceparent("00-" + "a".repeat(33) + "-0123456789abcdef-01")).toBeNull();
    // Non-hex char
    expect(parseTraceparent("00-zzzz" + "a".repeat(28) + "-0123456789abcdef-01")).toBeNull();
  });

  it("returns null when parent-span-id is not exactly 16 hex chars", () => {
    expect(parseTraceparent("00-" + "a".repeat(32) + "-abc-01")).toBeNull();
    expect(parseTraceparent("00-" + "a".repeat(32) + "-" + "a".repeat(17) + "-01")).toBeNull();
    expect(parseTraceparent("00-" + "a".repeat(32) + "-zzzzzzzzzzzzzzzz-01")).toBeNull();
  });

  it("returns null when flags are not exactly 2 chars", () => {
    expect(parseTraceparent("00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-1")).toBeNull();
    expect(parseTraceparent("00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-100")).toBeNull();
  });

  it("returns null when wrong number of dash-separated parts", () => {
    // 3 parts
    expect(parseTraceparent("00-aaaa-bbbb")).toBeNull();
    // 5 parts
    expect(parseTraceparent("00-" + "a".repeat(32) + "-" + "b".repeat(16) + "-01-extra")).toBeNull();
  });

  it("returns null for completely garbage input", () => {
    expect(parseTraceparent("not a traceparent")).toBeNull();
    expect(parseTraceparent("00")).toBeNull();
  });
});
