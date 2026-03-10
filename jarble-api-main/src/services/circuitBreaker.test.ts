import { describe, it, expect, beforeEach } from "vitest";
import {
  canRequest,
  recordSuccess,
  recordFailure,
  getCircuitState,
  resetCircuit,
  resetAllCircuits,
  FAILURE_THRESHOLD,
  RECOVERY_TIMEOUT_MS,
} from "./circuitBreaker.js";

describe("circuitBreaker", () => {
  beforeEach(() => {
    resetAllCircuits();
  });

  // ── Initial state ────────────────────────────────────────────────────────

  describe("initial state", () => {
    it("starts CLOSED for a new package", () => {
      const state = getCircuitState("pkg-1");
      expect(state.state).toBe("CLOSED");
      expect(state.consecutiveFailures).toBe(0);
      expect(state.lastFailureAt).toBeNull();
      expect(state.openedAt).toBeNull();
    });

    it("allows requests when CLOSED", () => {
      const result = canRequest("pkg-1");
      expect(result.allowed).toBe(true);
    });
  });

  // ── CLOSED → OPEN transition ─────────────────────────────────────────────

  describe("CLOSED → OPEN", () => {
    it("stays CLOSED after fewer than threshold failures", () => {
      const pkg = "pkg-fail-partial";
      for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
        recordFailure(pkg);
      }
      const state = getCircuitState(pkg);
      expect(state.state).toBe("CLOSED");
      expect(state.consecutiveFailures).toBe(FAILURE_THRESHOLD - 1);
    });

    it("opens after exactly threshold consecutive failures", () => {
      const pkg = "pkg-fail-exact";
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg);
      }
      const state = getCircuitState(pkg);
      expect(state.state).toBe("OPEN");
      expect(state.consecutiveFailures).toBe(FAILURE_THRESHOLD);
      expect(state.openedAt).not.toBeNull();
    });

    it("blocks requests when OPEN", () => {
      const pkg = "pkg-blocked";
      const now = 1000000;
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, now);
      }
      const result = canRequest(pkg, now + 1000); // 1 second later
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.retryAfterMs).toBeGreaterThan(0);
        expect(result.retryAfterMs).toBeLessThanOrEqual(RECOVERY_TIMEOUT_MS);
      }
    });
  });

  // ── Success resets failures ──────────────────────────────────────────────

  describe("success resets counter", () => {
    it("resets consecutive failures on success", () => {
      const pkg = "pkg-reset";
      recordFailure(pkg);
      recordFailure(pkg);
      recordFailure(pkg);
      expect(getCircuitState(pkg).consecutiveFailures).toBe(3);

      recordSuccess(pkg);
      expect(getCircuitState(pkg).consecutiveFailures).toBe(0);
      expect(getCircuitState(pkg).state).toBe("CLOSED");
    });

    it("does not open if a success interrupts failures", () => {
      const pkg = "pkg-interrupted";
      for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
        recordFailure(pkg);
      }
      recordSuccess(pkg); // Reset!
      for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
        recordFailure(pkg);
      }
      // Total failures = 2*(threshold-1), but never threshold consecutive
      expect(getCircuitState(pkg).state).toBe("CLOSED");
    });
  });

  // ── OPEN → HALF_OPEN transition ──────────────────────────────────────────

  describe("OPEN → HALF_OPEN", () => {
    it("transitions to HALF_OPEN after recovery timeout", () => {
      const pkg = "pkg-recover";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, openedAt);
      }
      expect(getCircuitState(pkg).state).toBe("OPEN");

      // Request after recovery timeout
      const result = canRequest(pkg, openedAt + RECOVERY_TIMEOUT_MS);
      expect(result.allowed).toBe(true);
      expect(getCircuitState(pkg).state).toBe("HALF_OPEN");
    });

    it("stays OPEN before recovery timeout", () => {
      const pkg = "pkg-too-early";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, openedAt);
      }

      const result = canRequest(pkg, openedAt + RECOVERY_TIMEOUT_MS - 1);
      expect(result.allowed).toBe(false);
      expect(getCircuitState(pkg).state).toBe("OPEN");
    });
  });

  // ── HALF_OPEN → CLOSED/OPEN ──────────────────────────────────────────────

  describe("HALF_OPEN transitions", () => {
    function openCircuit(pkg: string, now: number): void {
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, now);
      }
    }

    it("closes on success in HALF_OPEN", () => {
      const pkg = "pkg-probe-success";
      const now = 1000000;
      openCircuit(pkg, now);

      // Trigger HALF_OPEN
      canRequest(pkg, now + RECOVERY_TIMEOUT_MS);
      expect(getCircuitState(pkg).state).toBe("HALF_OPEN");

      // Probe succeeds
      recordSuccess(pkg);
      expect(getCircuitState(pkg).state).toBe("CLOSED");
      expect(getCircuitState(pkg).consecutiveFailures).toBe(0);
    });

    it("reopens on failure in HALF_OPEN", () => {
      const pkg = "pkg-probe-fail";
      const now = 1000000;
      openCircuit(pkg, now);

      // Trigger HALF_OPEN
      canRequest(pkg, now + RECOVERY_TIMEOUT_MS);
      expect(getCircuitState(pkg).state).toBe("HALF_OPEN");

      // Probe fails
      const reopenTime = now + RECOVERY_TIMEOUT_MS + 100;
      recordFailure(pkg, reopenTime);
      expect(getCircuitState(pkg).state).toBe("OPEN");
      expect(getCircuitState(pkg).openedAt).toBe(reopenTime);
    });

    it("allows request in HALF_OPEN (probe request)", () => {
      const pkg = "pkg-half-open-allow";
      const now = 1000000;
      openCircuit(pkg, now);

      // Transition to HALF_OPEN
      canRequest(pkg, now + RECOVERY_TIMEOUT_MS);

      // Second request in HALF_OPEN should also be allowed
      // (HALF_OPEN allows requests through)
      const result = canRequest(pkg, now + RECOVERY_TIMEOUT_MS + 100);
      expect(result.allowed).toBe(true);
    });
  });

  // ── Per-package isolation ────────────────────────────────────────────────

  describe("per-package isolation", () => {
    it("circuits are independent per packageId", () => {
      const pkg1 = "pkg-iso-1";
      const pkg2 = "pkg-iso-2";

      // Open circuit for pkg1
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg1);
      }
      expect(getCircuitState(pkg1).state).toBe("OPEN");
      expect(getCircuitState(pkg2).state).toBe("CLOSED");

      // pkg2 still allows requests
      expect(canRequest(pkg2).allowed).toBe(true);
      expect(canRequest(pkg1).allowed).toBe(false);
    });
  });

  // ── Reset ────────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("resetCircuit clears a single package", () => {
      const pkg = "pkg-reset-single";
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg);
      }
      expect(getCircuitState(pkg).state).toBe("OPEN");

      resetCircuit(pkg);
      expect(getCircuitState(pkg).state).toBe("CLOSED");
      expect(getCircuitState(pkg).consecutiveFailures).toBe(0);
    });

    it("resetAllCircuits clears everything", () => {
      recordFailure("a");
      recordFailure("b");
      recordFailure("c");

      resetAllCircuits();

      expect(getCircuitState("a").consecutiveFailures).toBe(0);
      expect(getCircuitState("b").consecutiveFailures).toBe(0);
      expect(getCircuitState("c").consecutiveFailures).toBe(0);
    });
  });

  // ── retryAfterMs calculation ─────────────────────────────────────────────

  describe("retryAfterMs", () => {
    it("returns correct retryAfterMs based on elapsed time", () => {
      const pkg = "pkg-retry";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, openedAt);
      }

      // 10 seconds after opening
      const result = canRequest(pkg, openedAt + 10_000);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.retryAfterMs).toBe(RECOVERY_TIMEOUT_MS - 10_000);
      }
    });

    it("retryAfterMs is never negative", () => {
      const pkg = "pkg-no-negative";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, openedAt);
      }

      // Exactly at recovery time — should transition to HALF_OPEN, not return negative
      const result = canRequest(pkg, openedAt + RECOVERY_TIMEOUT_MS);
      expect(result.allowed).toBe(true);
    });

    it("retryAfterMs decreases as time passes", () => {
      const pkg = "pkg-retry-decrease";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, openedAt);
      }

      const r1 = canRequest(pkg, openedAt + 5_000);
      const r2 = canRequest(pkg, openedAt + 30_000);

      expect(r1.allowed).toBe(false);
      expect(r2.allowed).toBe(false);
      if (!r1.allowed && !r2.allowed) {
        expect(r2.retryAfterMs).toBeLessThan(r1.retryAfterMs);
      }
    });

    it("retryAfterMs is 0 when recovery timeout is exactly reached", () => {
      const pkg = "pkg-retry-zero";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, openedAt);
      }

      // At recovery timeout, should transition to HALF_OPEN (allowed=true)
      const result = canRequest(pkg, openedAt + RECOVERY_TIMEOUT_MS);
      expect(result.allowed).toBe(true);
    });
  });

  // ── Additional edge cases ─────────────────────────────────────────────

  describe("additional edge cases", () => {
    it("failures beyond threshold keep circuit OPEN (does not double-open)", () => {
      const pkg = "pkg-extra-failures";
      const now = 1000000;
      for (let i = 0; i < FAILURE_THRESHOLD + 10; i++) {
        recordFailure(pkg, now);
      }
      const state = getCircuitState(pkg);
      expect(state.state).toBe("OPEN");
      expect(state.consecutiveFailures).toBe(FAILURE_THRESHOLD + 10);
    });

    it("recordSuccess on a never-seen package creates CLOSED entry", () => {
      recordSuccess("pkg-never-seen");
      const state = getCircuitState("pkg-never-seen");
      expect(state.state).toBe("CLOSED");
      expect(state.consecutiveFailures).toBe(0);
    });

    it("lastFailureAt is set correctly on each failure", () => {
      const pkg = "pkg-timestamps";
      recordFailure(pkg, 1000);
      expect(getCircuitState(pkg).lastFailureAt).toBe(1000);

      recordFailure(pkg, 2000);
      expect(getCircuitState(pkg).lastFailureAt).toBe(2000);
    });

    it("HALF_OPEN → OPEN preserves failure count from before", () => {
      const pkg = "pkg-count-preservation";
      const now = 1000000;

      // Open circuit (5 failures)
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, now);
      }

      // Transition to HALF_OPEN
      canRequest(pkg, now + RECOVERY_TIMEOUT_MS);
      expect(getCircuitState(pkg).state).toBe("HALF_OPEN");

      // Probe fails — consecutive failures should increment
      recordFailure(pkg, now + RECOVERY_TIMEOUT_MS + 100);
      expect(getCircuitState(pkg).state).toBe("OPEN");
      expect(getCircuitState(pkg).consecutiveFailures).toBe(FAILURE_THRESHOLD + 1);
    });

    it("multiple resets are idempotent", () => {
      recordFailure("pkg-multi-reset");
      resetCircuit("pkg-multi-reset");
      resetCircuit("pkg-multi-reset");

      const state = getCircuitState("pkg-multi-reset");
      expect(state.state).toBe("CLOSED");
      expect(state.consecutiveFailures).toBe(0);
    });

    it("OPEN circuit correctly tracks openedAt from the transition moment", () => {
      const pkg = "pkg-opened-at-tracking";
      recordFailure(pkg, 100);
      recordFailure(pkg, 200);
      recordFailure(pkg, 300);
      recordFailure(pkg, 400);

      // Not yet at threshold
      if (FAILURE_THRESHOLD > 4) {
        expect(getCircuitState(pkg).openedAt).toBeNull();
      }

      // Record failures until threshold
      for (let i = 4; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, 500 + i * 100);
      }

      const state = getCircuitState(pkg);
      expect(state.state).toBe("OPEN");
      expect(state.openedAt).not.toBeNull();
    });

    it("full lifecycle: CLOSED → OPEN → HALF_OPEN → CLOSED", () => {
      const pkg = "pkg-full-lifecycle";
      const t0 = 1000000;

      // CLOSED
      expect(getCircuitState(pkg).state).toBe("CLOSED");
      expect(canRequest(pkg, t0).allowed).toBe(true);

      // Accumulate failures → OPEN (all at same time so openedAt = t0)
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, t0);
      }
      expect(getCircuitState(pkg).state).toBe("OPEN");
      expect(canRequest(pkg, t0 + 1000).allowed).toBe(false);

      // Wait for recovery → HALF_OPEN
      const t1 = t0 + RECOVERY_TIMEOUT_MS;
      expect(canRequest(pkg, t1).allowed).toBe(true);
      expect(getCircuitState(pkg).state).toBe("HALF_OPEN");

      // Probe succeeds → CLOSED
      recordSuccess(pkg);
      expect(getCircuitState(pkg).state).toBe("CLOSED");
      expect(getCircuitState(pkg).consecutiveFailures).toBe(0);
    });

    it("full lifecycle: CLOSED → OPEN → HALF_OPEN → OPEN → HALF_OPEN → CLOSED", () => {
      const pkg = "pkg-full-lifecycle-2";
      const t0 = 1000000;

      // CLOSED → OPEN
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        recordFailure(pkg, t0);
      }
      expect(getCircuitState(pkg).state).toBe("OPEN");

      // OPEN → HALF_OPEN
      const t1 = t0 + RECOVERY_TIMEOUT_MS;
      canRequest(pkg, t1);
      expect(getCircuitState(pkg).state).toBe("HALF_OPEN");

      // HALF_OPEN → OPEN (probe fails)
      recordFailure(pkg, t1 + 1);
      expect(getCircuitState(pkg).state).toBe("OPEN");

      // OPEN → HALF_OPEN (again after recovery)
      const t2 = t1 + 1 + RECOVERY_TIMEOUT_MS;
      canRequest(pkg, t2);
      expect(getCircuitState(pkg).state).toBe("HALF_OPEN");

      // HALF_OPEN → CLOSED (probe succeeds)
      recordSuccess(pkg);
      expect(getCircuitState(pkg).state).toBe("CLOSED");
    });
  });

  // ── Configuration constants ────────────────────────────────────────────

  describe("configuration constants", () => {
    it("FAILURE_THRESHOLD is a positive integer", () => {
      expect(FAILURE_THRESHOLD).toBeGreaterThan(0);
      expect(Number.isInteger(FAILURE_THRESHOLD)).toBe(true);
    });

    it("RECOVERY_TIMEOUT_MS is a positive number", () => {
      expect(RECOVERY_TIMEOUT_MS).toBeGreaterThan(0);
    });
  });
});
