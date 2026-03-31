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
import { MemoryStateStore } from "./memoryStateStore.js";

describe("circuitBreaker", () => {
  let store: MemoryStateStore;

  beforeEach(async () => {
    store = new MemoryStateStore();
    await resetAllCircuits(store);
  });

  // ── Initial state ────────────────────────────────────────────────────────

  describe("initial state", () => {
    it("starts CLOSED for a new package", async () => {
      const state = await getCircuitState("pkg-1", store);
      expect(state.state).toBe("CLOSED");
      expect(state.consecutiveFailures).toBe(0);
      expect(state.lastFailureAt).toBeNull();
      expect(state.openedAt).toBeNull();
    });

    it("allows requests when CLOSED", async () => {
      const result = await canRequest("pkg-1", undefined, store);
      expect(result.allowed).toBe(true);
    });
  });

  // ── CLOSED → OPEN transition ─────────────────────────────────────────────

  describe("CLOSED → OPEN", () => {
    it("stays CLOSED after fewer than threshold failures", async () => {
      const pkg = "pkg-fail-partial";
      for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
        await recordFailure(pkg, undefined, store);
      }
      const state = await getCircuitState(pkg, store);
      expect(state.state).toBe("CLOSED");
      expect(state.consecutiveFailures).toBe(FAILURE_THRESHOLD - 1);
    });

    it("opens after exactly threshold consecutive failures", async () => {
      const pkg = "pkg-fail-exact";
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, undefined, store);
      }
      const state = await getCircuitState(pkg, store);
      expect(state.state).toBe("OPEN");
      expect(state.consecutiveFailures).toBe(FAILURE_THRESHOLD);
      expect(state.openedAt).not.toBeNull();
    });

    it("blocks requests when OPEN", async () => {
      const pkg = "pkg-blocked";
      const now = 1000000;
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, now, store);
      }
      const result = await canRequest(pkg, now + 1000, store); // 1 second later
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.retryAfterMs).toBeGreaterThan(0);
        expect(result.retryAfterMs).toBeLessThanOrEqual(RECOVERY_TIMEOUT_MS);
      }
    });
  });

  // ── Success resets failures ──────────────────────────────────────────────

  describe("success resets counter", () => {
    it("resets consecutive failures on success", async () => {
      const pkg = "pkg-reset";
      await recordFailure(pkg, undefined, store);
      await recordFailure(pkg, undefined, store);
      await recordFailure(pkg, undefined, store);
      expect((await getCircuitState(pkg, store)).consecutiveFailures).toBe(3);

      await recordSuccess(pkg, store);
      expect((await getCircuitState(pkg, store)).consecutiveFailures).toBe(0);
      expect((await getCircuitState(pkg, store)).state).toBe("CLOSED");
    });

    it("does not open if a success interrupts failures", async () => {
      const pkg = "pkg-interrupted";
      for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
        await recordFailure(pkg, undefined, store);
      }
      await recordSuccess(pkg, store); // Reset!
      for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
        await recordFailure(pkg, undefined, store);
      }
      // Total failures = 2*(threshold-1), but never threshold consecutive
      expect((await getCircuitState(pkg, store)).state).toBe("CLOSED");
    });
  });

  // ── OPEN → HALF_OPEN transition ──────────────────────────────────────────

  describe("OPEN → HALF_OPEN", () => {
    it("transitions to HALF_OPEN after recovery timeout", async () => {
      const pkg = "pkg-recover";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, openedAt, store);
      }
      expect((await getCircuitState(pkg, store)).state).toBe("OPEN");

      // Request after recovery timeout
      const result = await canRequest(pkg, openedAt + RECOVERY_TIMEOUT_MS, store);
      expect(result.allowed).toBe(true);
      expect((await getCircuitState(pkg, store)).state).toBe("HALF_OPEN");
    });

    it("stays OPEN before recovery timeout", async () => {
      const pkg = "pkg-too-early";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, openedAt, store);
      }

      const result = await canRequest(pkg, openedAt + RECOVERY_TIMEOUT_MS - 1, store);
      expect(result.allowed).toBe(false);
      expect((await getCircuitState(pkg, store)).state).toBe("OPEN");
    });
  });

  // ── HALF_OPEN → CLOSED/OPEN ──────────────────────────────────────────────

  describe("HALF_OPEN transitions", () => {
    async function openCircuit(pkg: string, now: number): Promise<void> {
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, now, store);
      }
    }

    it("closes on success in HALF_OPEN", async () => {
      const pkg = "pkg-probe-success";
      const now = 1000000;
      await openCircuit(pkg, now);

      // Trigger HALF_OPEN
      await canRequest(pkg, now + RECOVERY_TIMEOUT_MS, store);
      expect((await getCircuitState(pkg, store)).state).toBe("HALF_OPEN");

      // Probe succeeds
      await recordSuccess(pkg, store);
      expect((await getCircuitState(pkg, store)).state).toBe("CLOSED");
      expect((await getCircuitState(pkg, store)).consecutiveFailures).toBe(0);
    });

    it("reopens on failure in HALF_OPEN", async () => {
      const pkg = "pkg-probe-fail";
      const now = 1000000;
      await openCircuit(pkg, now);

      // Trigger HALF_OPEN
      await canRequest(pkg, now + RECOVERY_TIMEOUT_MS, store);
      expect((await getCircuitState(pkg, store)).state).toBe("HALF_OPEN");

      // Probe fails
      const reopenTime = now + RECOVERY_TIMEOUT_MS + 100;
      await recordFailure(pkg, reopenTime, store);
      expect((await getCircuitState(pkg, store)).state).toBe("OPEN");
      expect((await getCircuitState(pkg, store)).openedAt).toBe(reopenTime);
    });

    it("allows request in HALF_OPEN (probe request)", async () => {
      const pkg = "pkg-half-open-allow";
      const now = 1000000;
      await openCircuit(pkg, now);

      // Transition to HALF_OPEN
      await canRequest(pkg, now + RECOVERY_TIMEOUT_MS, store);

      // Second request in HALF_OPEN should also be allowed
      const result = await canRequest(pkg, now + RECOVERY_TIMEOUT_MS + 100, store);
      expect(result.allowed).toBe(true);
    });
  });

  // ── Per-package isolation ────────────────────────────────────────────────

  describe("per-package isolation", () => {
    it("circuits are independent per packageId", async () => {
      const pkg1 = "pkg-iso-1";
      const pkg2 = "pkg-iso-2";

      // Open circuit for pkg1
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg1, undefined, store);
      }
      expect((await getCircuitState(pkg1, store)).state).toBe("OPEN");
      expect((await getCircuitState(pkg2, store)).state).toBe("CLOSED");

      // pkg2 still allows requests
      expect((await canRequest(pkg2, undefined, store)).allowed).toBe(true);
      expect((await canRequest(pkg1, undefined, store)).allowed).toBe(false);
    });
  });

  // ── Reset ────────────────────────────────────────────────────────────────

  describe("reset", () => {
    it("resetCircuit clears a single package", async () => {
      const pkg = "pkg-reset-single";
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, undefined, store);
      }
      expect((await getCircuitState(pkg, store)).state).toBe("OPEN");

      await resetCircuit(pkg, store);
      expect((await getCircuitState(pkg, store)).state).toBe("CLOSED");
      expect((await getCircuitState(pkg, store)).consecutiveFailures).toBe(0);
    });

    it("resetAllCircuits clears everything", async () => {
      await recordFailure("a", undefined, store);
      await recordFailure("b", undefined, store);
      await recordFailure("c", undefined, store);

      await resetAllCircuits(store);

      expect((await getCircuitState("a", store)).consecutiveFailures).toBe(0);
      expect((await getCircuitState("b", store)).consecutiveFailures).toBe(0);
      expect((await getCircuitState("c", store)).consecutiveFailures).toBe(0);
    });
  });

  // ── retryAfterMs calculation ─────────────────────────────────────────────

  describe("retryAfterMs", () => {
    it("returns correct retryAfterMs based on elapsed time", async () => {
      const pkg = "pkg-retry";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, openedAt, store);
      }

      // 10 seconds after opening
      const result = await canRequest(pkg, openedAt + 10_000, store);
      expect(result.allowed).toBe(false);
      if (!result.allowed) {
        expect(result.retryAfterMs).toBe(RECOVERY_TIMEOUT_MS - 10_000);
      }
    });

    it("retryAfterMs is never negative", async () => {
      const pkg = "pkg-no-negative";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, openedAt, store);
      }

      // Exactly at recovery time - should transition to HALF_OPEN, not return negative
      const result = await canRequest(pkg, openedAt + RECOVERY_TIMEOUT_MS, store);
      expect(result.allowed).toBe(true);
    });

    it("retryAfterMs decreases as time passes", async () => {
      const pkg = "pkg-retry-decrease";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, openedAt, store);
      }

      const r1 = await canRequest(pkg, openedAt + 5_000, store);
      const r2 = await canRequest(pkg, openedAt + 30_000, store);

      expect(r1.allowed).toBe(false);
      expect(r2.allowed).toBe(false);
      if (!r1.allowed && !r2.allowed) {
        expect(r2.retryAfterMs).toBeLessThan(r1.retryAfterMs);
      }
    });

    it("retryAfterMs is 0 when recovery timeout is exactly reached", async () => {
      const pkg = "pkg-retry-zero";
      const openedAt = 1000000;

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, openedAt, store);
      }

      // At recovery timeout, should transition to HALF_OPEN (allowed=true)
      const result = await canRequest(pkg, openedAt + RECOVERY_TIMEOUT_MS, store);
      expect(result.allowed).toBe(true);
    });
  });

  // ── Additional edge cases ─────────────────────────────────────────────

  describe("additional edge cases", () => {
    it("failures beyond threshold keep circuit OPEN (does not double-open)", async () => {
      const pkg = "pkg-extra-failures";
      const now = 1000000;
      for (let i = 0; i < FAILURE_THRESHOLD + 10; i++) {
        await recordFailure(pkg, now, store);
      }
      const state = await getCircuitState(pkg, store);
      expect(state.state).toBe("OPEN");
      expect(state.consecutiveFailures).toBe(FAILURE_THRESHOLD + 10);
    });

    it("recordSuccess on a never-seen package creates CLOSED entry", async () => {
      await recordSuccess("pkg-never-seen", store);
      const state = await getCircuitState("pkg-never-seen", store);
      expect(state.state).toBe("CLOSED");
      expect(state.consecutiveFailures).toBe(0);
    });

    it("lastFailureAt is set correctly on each failure", async () => {
      const pkg = "pkg-timestamps";
      await recordFailure(pkg, 1000, store);
      expect((await getCircuitState(pkg, store)).lastFailureAt).toBe(1000);

      await recordFailure(pkg, 2000, store);
      expect((await getCircuitState(pkg, store)).lastFailureAt).toBe(2000);
    });

    it("HALF_OPEN → OPEN preserves failure count from before", async () => {
      const pkg = "pkg-count-preservation";
      const now = 1000000;

      // Open circuit (5 failures)
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, now, store);
      }

      // Transition to HALF_OPEN
      await canRequest(pkg, now + RECOVERY_TIMEOUT_MS, store);
      expect((await getCircuitState(pkg, store)).state).toBe("HALF_OPEN");

      // Probe fails - consecutive failures should increment
      await recordFailure(pkg, now + RECOVERY_TIMEOUT_MS + 100, store);
      expect((await getCircuitState(pkg, store)).state).toBe("OPEN");
      expect((await getCircuitState(pkg, store)).consecutiveFailures).toBe(FAILURE_THRESHOLD + 1);
    });

    it("multiple resets are idempotent", async () => {
      await recordFailure("pkg-multi-reset", undefined, store);
      await resetCircuit("pkg-multi-reset", store);
      await resetCircuit("pkg-multi-reset", store);

      const state = await getCircuitState("pkg-multi-reset", store);
      expect(state.state).toBe("CLOSED");
      expect(state.consecutiveFailures).toBe(0);
    });

    it("full lifecycle: CLOSED → OPEN → HALF_OPEN → CLOSED", async () => {
      const pkg = "pkg-full-lifecycle";
      const t0 = 1000000;

      // CLOSED
      expect((await getCircuitState(pkg, store)).state).toBe("CLOSED");
      expect((await canRequest(pkg, t0, store)).allowed).toBe(true);

      // Accumulate failures → OPEN
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, t0, store);
      }
      expect((await getCircuitState(pkg, store)).state).toBe("OPEN");
      expect((await canRequest(pkg, t0 + 1000, store)).allowed).toBe(false);

      // Wait for recovery → HALF_OPEN
      const t1 = t0 + RECOVERY_TIMEOUT_MS;
      expect((await canRequest(pkg, t1, store)).allowed).toBe(true);
      expect((await getCircuitState(pkg, store)).state).toBe("HALF_OPEN");

      // Probe succeeds → CLOSED
      await recordSuccess(pkg, store);
      expect((await getCircuitState(pkg, store)).state).toBe("CLOSED");
      expect((await getCircuitState(pkg, store)).consecutiveFailures).toBe(0);
    });

    it("full lifecycle: CLOSED → OPEN → HALF_OPEN → OPEN → HALF_OPEN → CLOSED", async () => {
      const pkg = "pkg-full-lifecycle-2";
      const t0 = 1000000;

      // CLOSED → OPEN
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure(pkg, t0, store);
      }
      expect((await getCircuitState(pkg, store)).state).toBe("OPEN");

      // OPEN → HALF_OPEN
      const t1 = t0 + RECOVERY_TIMEOUT_MS;
      await canRequest(pkg, t1, store);
      expect((await getCircuitState(pkg, store)).state).toBe("HALF_OPEN");

      // HALF_OPEN → OPEN (probe fails)
      await recordFailure(pkg, t1 + 1, store);
      expect((await getCircuitState(pkg, store)).state).toBe("OPEN");

      // OPEN → HALF_OPEN (again after recovery)
      const t2 = t1 + 1 + RECOVERY_TIMEOUT_MS;
      await canRequest(pkg, t2, store);
      expect((await getCircuitState(pkg, store)).state).toBe("HALF_OPEN");

      // HALF_OPEN → CLOSED (probe succeeds)
      await recordSuccess(pkg, store);
      expect((await getCircuitState(pkg, store)).state).toBe("CLOSED");
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

  // ── StateStore abstraction ─────────────────────────────────────────────

  describe("StateStore abstraction", () => {
    it("works with explicitly provided MemoryStateStore", async () => {
      const customStore = new MemoryStateStore();
      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure("pkg-custom", undefined, customStore);
      }
      expect((await getCircuitState("pkg-custom", customStore)).state).toBe("OPEN");
    });

    it("different stores have independent state", async () => {
      const store1 = new MemoryStateStore();
      const store2 = new MemoryStateStore();

      for (let i = 0; i < FAILURE_THRESHOLD; i++) {
        await recordFailure("pkg-x", undefined, store1);
      }
      expect((await getCircuitState("pkg-x", store1)).state).toBe("OPEN");
      expect((await getCircuitState("pkg-x", store2)).state).toBe("CLOSED");
    });
  });
});
