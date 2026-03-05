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
  });
});
