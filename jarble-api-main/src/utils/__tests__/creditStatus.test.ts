/**
 * Tests for managed-credit status classification.
 *
 * Locks down the thresholds so UI copy ("Credits low at 80%", "Credits
 * exhausted at 100%") and the chat preflight gate stay in sync with what
 * the helper returns.
 */
import { describe, it, expect } from "vitest";
import { classifyCreditUsage, type KeyUsageSnapshot } from "../creditStatus.js";
import { classifyError } from "../chatErrors.js";

function mkUsage(overrides: Partial<KeyUsageSnapshot> = {}): KeyUsageSnapshot {
  return {
    disabled: false,
    limit: 10,
    limitRemaining: 5,
    usage: 5,
    ...overrides,
  };
}

describe("classifyCreditUsage", () => {
  it("returns null when usage is null", () => {
    expect(classifyCreditUsage(null)).toBeNull();
  });

  it("classifies 50% usage as ok", () => {
    const status = classifyCreditUsage(mkUsage({ usage: 5, limit: 10, limitRemaining: 5 }));
    expect(status?.level).toBe("ok");
    expect(status?.percentUsed).toBe(50);
    expect(status?.remaining).toBe(5);
  });

  it("classifies 80% usage as warning", () => {
    const status = classifyCreditUsage(mkUsage({ usage: 8, limit: 10, limitRemaining: 2 }));
    expect(status?.level).toBe("warning");
    expect(status?.percentUsed).toBe(80);
  });

  it("classifies 99% usage as warning", () => {
    const status = classifyCreditUsage(mkUsage({ usage: 9.9, limit: 10, limitRemaining: 0.1 }));
    expect(status?.level).toBe("warning");
  });

  it("classifies 100% usage as exhausted", () => {
    const status = classifyCreditUsage(mkUsage({ usage: 10, limit: 10, limitRemaining: 0 }));
    expect(status?.level).toBe("exhausted");
    expect(status?.remaining).toBe(0);
  });

  it("classifies over-limit usage as exhausted (not >100%)", () => {
    const status = classifyCreditUsage(mkUsage({ usage: 12, limit: 10, limitRemaining: -2 }));
    expect(status?.level).toBe("exhausted");
    expect(status?.percentUsed).toBe(100);
  });

  it("honors disabled flag as exhausted even at low usage", () => {
    const status = classifyCreditUsage(mkUsage({ usage: 1, limit: 10, limitRemaining: 9, disabled: true }));
    expect(status?.level).toBe("exhausted");
  });

  it("classifies null limit as ok (unlimited)", () => {
    const status = classifyCreditUsage(mkUsage({ usage: 999, limit: null, limitRemaining: null }));
    expect(status?.level).toBe("ok");
    expect(status?.limit).toBeNull();
    expect(status?.percentUsed).toBeNull();
  });

  it("classifies zero limit as ok (no cap configured)", () => {
    const status = classifyCreditUsage(mkUsage({ usage: 5, limit: 0, limitRemaining: null }));
    expect(status?.level).toBe("ok");
    expect(status?.limit).toBeNull();
  });

  it("classifies limitRemaining=0 as exhausted even if usage<limit due to rounding", () => {
    const status = classifyCreditUsage(mkUsage({ usage: 9.99, limit: 10, limitRemaining: 0 }));
    expect(status?.level).toBe("exhausted");
  });
});

describe("classifyError - CREDITS_EXHAUSTED", () => {
  const patterns = [
    "Request failed with status 402",
    "OpenRouter returned 402 Payment Required",
    "insufficient credits",
    "Insufficient Credit balance",
    "out of credits",
    "credits exhausted",
    "quota exceeded",
  ];

  it.each(patterns)("matches %s", (msg) => {
    const classified = classifyError(msg);
    expect(classified.code).toBe("CREDITS_EXHAUSTED");
    expect(classified.canTopUp).toBe(true);
    expect(classified.canRetry).toBe(false);
    expect(classified.canStart).toBe(false);
    expect(classified.canDiagnose).toBe(false);
  });

  it("does not classify unrelated errors as CREDITS_EXHAUSTED", () => {
    expect(classifyError("Gateway timeout").code).not.toBe("CREDITS_EXHAUSTED");
    expect(classifyError("CrashLoopBackOff").code).not.toBe("CREDITS_EXHAUSTED");
  });
});
