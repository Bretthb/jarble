/**
 * Unit tests for classifyCreditUsage.
 *
 * The helper is the single point of truth for "is this managed key
 * over budget?" — used by both the chat preflight (block message at
 * exhausted) and the billing tRPC overview (warn user at 80%). A
 * regression that misclassified `disabled: true` as ok, or that let a
 * key over limit slip past the warning threshold, would either let
 * users burn their cap or cut them off prematurely.
 *
 * Covers:
 *  1. null input → null (preflight no-op when usage fetch failed)
 *  2. No-limit keys are always "ok" with null limit/remaining/percent
 *  3. Exhausted: disabled flag, pct >= 100%, remaining <= 0
 *  4. Warning: pct in [80%, 100%)
 *  5. OK: pct < 80%
 *  6. percentUsed is clamped to 100 when usage > limit
 *  7. remaining falls back to `max(0, limit - usage)` when API didn't supply it
 */

import { describe, it, expect } from "vitest";
import {
  classifyCreditUsage,
  CREDIT_WARNING_THRESHOLD,
  CREDIT_EXHAUSTED_THRESHOLD,
  type KeyUsageSnapshot,
} from "../../utils/creditStatus.js";

const base = (overrides: Partial<KeyUsageSnapshot> = {}): KeyUsageSnapshot => ({
  disabled: false,
  limit: 10,
  limitRemaining: 7,
  usage: 3,
  ...overrides,
});

describe("classifyCreditUsage", () => {
  it("returns null when input is null (usage-fetch failed)", () => {
    expect(classifyCreditUsage(null)).toBeNull();
  });

  it("treats a key with limit=null as unlimited and ok", () => {
    const r = classifyCreditUsage(base({ limit: null, limitRemaining: null, usage: 999 }));
    expect(r).toEqual({
      level: "ok",
      usage: 999,
      limit: null,
      remaining: null,
      percentUsed: null,
      disabled: false,
    });
  });

  it("treats a key with limit=0 as unlimited (defensive against bad input)", () => {
    const r = classifyCreditUsage(base({ limit: 0, limitRemaining: null, usage: 1 }))!;
    expect(r.level).toBe("ok");
    expect(r.limit).toBeNull();
    expect(r.percentUsed).toBeNull();
  });

  it("classifies low usage as ok", () => {
    // 30% used → ok
    const r = classifyCreditUsage(base({ usage: 3, limit: 10 }))!;
    expect(r.level).toBe("ok");
    expect(r.percentUsed).toBe(30);
    expect(r.remaining).toBe(7);
  });

  it("classifies usage at the 80% warning threshold as warning", () => {
    const r = classifyCreditUsage(base({ usage: 8, limit: 10, limitRemaining: 2 }))!;
    expect(r.level).toBe("warning");
    expect(r.percentUsed).toBe(80);
  });

  it("classifies usage above 80% but below 100% as warning", () => {
    const r = classifyCreditUsage(base({ usage: 9, limit: 10, limitRemaining: 1 }))!;
    expect(r.level).toBe("warning");
    expect(r.percentUsed).toBe(90);
  });

  it("classifies usage at exactly 100% as exhausted", () => {
    const r = classifyCreditUsage(base({ usage: 10, limit: 10, limitRemaining: 0 }))!;
    expect(r.level).toBe("exhausted");
    expect(r.percentUsed).toBe(100);
  });

  it("classifies usage over 100% as exhausted with percentUsed clamped to 100", () => {
    const r = classifyCreditUsage(base({ usage: 15, limit: 10, limitRemaining: 0 }))!;
    expect(r.level).toBe("exhausted");
    expect(r.percentUsed).toBe(100);
  });

  it("respects the disabled flag — exhausted regardless of usage", () => {
    const r = classifyCreditUsage(base({ disabled: true, usage: 0, limit: 10 }))!;
    expect(r.level).toBe("exhausted");
    expect(r.disabled).toBe(true);
  });

  it("classifies remaining=0 as exhausted even when pct < 100% (rounding-safe)", () => {
    // E.g. OpenRouter sometimes reports a usage that arithmetic rounds
    // below limit but ships limitRemaining=0 to be authoritative.
    const r = classifyCreditUsage(base({ usage: 9, limit: 10, limitRemaining: 0 }))!;
    expect(r.level).toBe("exhausted");
  });

  it("falls back to max(0, limit - usage) when limitRemaining is null", () => {
    const r = classifyCreditUsage(base({ usage: 3, limit: 10, limitRemaining: null }))!;
    expect(r.remaining).toBe(7);
  });

  it("clamps fallback remaining to 0 when usage exceeds limit", () => {
    const r = classifyCreditUsage(base({ usage: 15, limit: 10, limitRemaining: null }))!;
    expect(r.remaining).toBe(0);
  });

  it("treats missing usage as 0", () => {
    // The KeyUsageSnapshot type requires usage, but the helper guards
    // against `usage ?? 0` so a stray undefined doesn't crash.
    const r = classifyCreditUsage({
      disabled: false,
      limit: 10,
      limitRemaining: 10,
      usage: undefined as any,
    })!;
    expect(r.usage).toBe(0);
    expect(r.level).toBe("ok");
  });

  it("exposes stable threshold constants", () => {
    expect(CREDIT_WARNING_THRESHOLD).toBe(0.8);
    expect(CREDIT_EXHAUSTED_THRESHOLD).toBe(1.0);
  });
});
