/**
 * Tests for chatSessionManager.ts - in-memory tracker for active chat runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger
vi.mock("../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── Import after mocks ────────────────────────────────────────────────────────

// Re-import module for each test to get a fresh singleton
let sessionManager: typeof import("./chatSessionManager.js")["sessionManager"];

async function reimportModule() {
  vi.resetModules();
  const mod = await import("./chatSessionManager.js");
  sessionManager = mod.sessionManager;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("chatSessionManager", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await reimportModule();
  });

  // ── registerRun ─────────────────────────────────────────────────────────

  describe("registerRun", () => {
    it("registers a new run for a deployment", () => {
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);

      const run = sessionManager.getActiveRun("dep-1");
      expect(run).toBeDefined();
      expect(run!.runId).toBe("run-1");
      expect(run!.deploymentId).toBe("dep-1");
      expect(run!.abortController).toBe(ac);
      expect(run!.startedAt).toBeGreaterThan(0);
    });

    it("aborts existing run when registering a new one for same deployment", () => {
      const ac1 = new AbortController();
      const ac2 = new AbortController();

      sessionManager.registerRun("dep-1", "run-1", ac1);
      sessionManager.registerRun("dep-1", "run-2", ac2);

      // First controller should have been aborted
      expect(ac1.signal.aborted).toBe(true);
      // Second should be active
      expect(ac2.signal.aborted).toBe(false);

      const run = sessionManager.getActiveRun("dep-1");
      expect(run!.runId).toBe("run-2");
    });

    it("handles registering runs for different deployments independently", () => {
      const ac1 = new AbortController();
      const ac2 = new AbortController();

      sessionManager.registerRun("dep-1", "run-1", ac1);
      sessionManager.registerRun("dep-2", "run-2", ac2);

      expect(sessionManager.getActiveRun("dep-1")!.runId).toBe("run-1");
      expect(sessionManager.getActiveRun("dep-2")!.runId).toBe("run-2");
      expect(ac1.signal.aborted).toBe(false);
      expect(ac2.signal.aborted).toBe(false);
    });

    it("sets startedAt to current time", () => {
      const before = Date.now();
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);
      const after = Date.now();

      const run = sessionManager.getActiveRun("dep-1");
      expect(run!.startedAt).toBeGreaterThanOrEqual(before);
      expect(run!.startedAt).toBeLessThanOrEqual(after);
    });
  });

  // ── unregisterRun ───────────────────────────────────────────────────────

  describe("unregisterRun", () => {
    it("removes an active run", () => {
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);

      sessionManager.unregisterRun("dep-1");

      expect(sessionManager.getActiveRun("dep-1")).toBeUndefined();
    });

    it("is a no-op for unknown deployment", () => {
      // Should not throw
      expect(() => sessionManager.unregisterRun("dep-unknown")).not.toThrow();
    });

    it("does not abort the controller on unregister", () => {
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);

      sessionManager.unregisterRun("dep-1");

      // unregisterRun just removes from map, does not abort
      expect(ac.signal.aborted).toBe(false);
    });
  });

  // ── getActiveRun ────────────────────────────────────────────────────────

  describe("getActiveRun", () => {
    it("returns undefined for unknown deployment", () => {
      expect(sessionManager.getActiveRun("dep-nonexistent")).toBeUndefined();
    });

    it("returns the registered run", () => {
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);

      const run = sessionManager.getActiveRun("dep-1");
      expect(run).toBeDefined();
      expect(run!.runId).toBe("run-1");
    });

    it("returns undefined after unregister", () => {
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);
      sessionManager.unregisterRun("dep-1");

      expect(sessionManager.getActiveRun("dep-1")).toBeUndefined();
    });
  });

  // ── abortRun ────────────────────────────────────────────────────────────

  describe("abortRun", () => {
    it("aborts the active run and returns true", () => {
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);

      const result = sessionManager.abortRun("dep-1");

      expect(result).toBe(true);
      expect(ac.signal.aborted).toBe(true);
      expect(sessionManager.getActiveRun("dep-1")).toBeUndefined();
    });

    it("returns false for unknown deployment", () => {
      const result = sessionManager.abortRun("dep-unknown");
      expect(result).toBe(false);
    });

    it("removes the run from the map after aborting", () => {
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);

      sessionManager.abortRun("dep-1");

      expect(sessionManager.getActiveRun("dep-1")).toBeUndefined();
    });

    it("handles abort controller that throws gracefully", () => {
      const ac = new AbortController();
      // Abort it first so calling abort again is still safe
      ac.abort();
      sessionManager.registerRun("dep-1", "run-1", ac);

      // Should not throw even if abort() is called on already-aborted controller
      expect(() => sessionManager.abortRun("dep-1")).not.toThrow();
    });
  });

  // ── setToolStatus ───────────────────────────────────────────────────────

  describe("setToolStatus", () => {
    it("sets tool status on active run", () => {
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);

      sessionManager.setToolStatus("dep-1", "Searching the web...");

      const run = sessionManager.getActiveRun("dep-1");
      expect(run!.toolStatus).toBe("Searching the web...");
    });

    it("clears tool status with undefined", () => {
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);

      sessionManager.setToolStatus("dep-1", "Processing...");
      sessionManager.setToolStatus("dep-1", undefined);

      const run = sessionManager.getActiveRun("dep-1");
      expect(run!.toolStatus).toBeUndefined();
    });

    it("is a no-op for unknown deployment", () => {
      // Should not throw
      expect(() => sessionManager.setToolStatus("dep-unknown", "status")).not.toThrow();
    });

    it("does not create a run entry for unknown deployment", () => {
      sessionManager.setToolStatus("dep-unknown", "status");
      expect(sessionManager.getActiveRun("dep-unknown")).toBeUndefined();
    });
  });

  // ── setTyping ───────────────────────────────────────────────────────────

  describe("setTyping", () => {
    it("sets typing flag to true", () => {
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);

      sessionManager.setTyping("dep-1", true);

      const run = sessionManager.getActiveRun("dep-1");
      expect(run!.typing).toBe(true);
    });

    it("sets typing flag to false", () => {
      const ac = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac);

      sessionManager.setTyping("dep-1", true);
      sessionManager.setTyping("dep-1", false);

      const run = sessionManager.getActiveRun("dep-1");
      expect(run!.typing).toBe(false);
    });

    it("is a no-op for unknown deployment", () => {
      expect(() => sessionManager.setTyping("dep-unknown", true)).not.toThrow();
    });
  });

  // ── Concurrent / multi-deployment scenarios ─────────────────────────────

  describe("concurrent operations", () => {
    it("manages multiple deployments simultaneously", () => {
      const controllers = Array.from({ length: 5 }, (_, i) => {
        const ac = new AbortController();
        sessionManager.registerRun(`dep-${i}`, `run-${i}`, ac);
        return ac;
      });

      // All should be active
      for (let i = 0; i < 5; i++) {
        expect(sessionManager.getActiveRun(`dep-${i}`)!.runId).toBe(`run-${i}`);
      }

      // Abort one
      sessionManager.abortRun("dep-2");
      expect(controllers[2].signal.aborted).toBe(true);
      expect(sessionManager.getActiveRun("dep-2")).toBeUndefined();

      // Others should still be active
      expect(sessionManager.getActiveRun("dep-0")).toBeDefined();
      expect(sessionManager.getActiveRun("dep-4")).toBeDefined();
    });

    it("rapid register/abort cycle does not leak state", () => {
      for (let i = 0; i < 100; i++) {
        const ac = new AbortController();
        sessionManager.registerRun("dep-1", `run-${i}`, ac);
        sessionManager.abortRun("dep-1");
      }

      expect(sessionManager.getActiveRun("dep-1")).toBeUndefined();
    });

    it("replacing a run preserves tool status and typing defaults", () => {
      const ac1 = new AbortController();
      sessionManager.registerRun("dep-1", "run-1", ac1);
      sessionManager.setToolStatus("dep-1", "Old status");
      sessionManager.setTyping("dep-1", true);

      // Replace the run
      const ac2 = new AbortController();
      sessionManager.registerRun("dep-1", "run-2", ac2);

      const run = sessionManager.getActiveRun("dep-1");
      expect(run!.runId).toBe("run-2");
      // New run should not have old tool status or typing
      expect(run!.toolStatus).toBeUndefined();
      expect(run!.typing).toBeUndefined();
    });
  });
});
