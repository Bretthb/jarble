import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

// ── Mock Auth0 ─────────────────────────────────────────────────────────────

const mockGetToken = vi.fn().mockResolvedValue("test-token");

vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    isAuthenticated: true,
    getAccessTokenSilently: mockGetToken,
  }),
}));

vi.mock("@/lib/trpc", () => ({
  API_URL: "http://localhost:3001",
}));

// ── EventSource mock ───────────────────────────────────────────────────────

type ESListener = (event: { data: string }) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];

  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  private errorListeners: Array<() => void> = [];
  readyState = 0; // CONNECTING

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
    // Simulate async open
    queueMicrotask(() => {
      this.readyState = 1; // OPEN
      this.onopen?.();
    });
  }

  addEventListener(type: string, listener: (...args: unknown[]) => void) {
    if (type === "error") this.errorListeners.push(listener as () => void);
  }

  removeEventListener() {}

  close() {
    this.readyState = 2; // CLOSED
  }

  // Test helpers
  simulateMessage(data: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }

  simulateError() {
    this.errorListeners.forEach((l) => l());
  }
}

vi.stubGlobal("EventSource", MockEventSource);

// ── Fetch mock ─────────────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Import under test (after mocks) ────────────────────────────────────────

import { useFlowExecution } from "../useFlowExecution";

// ── Setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  MockEventSource.instances = [];
  mockFetch.mockReset();
  mockGetToken.mockResolvedValue("test-token");
});

afterEach(() => {
  vi.useRealTimers();
});

// ── Tests ──────────────────────────────────────────────────────────────────

describe("useFlowExecution", () => {
  describe("initial state", () => {
    it("starts in idle status with no execution", () => {
      const { result } = renderHook(() => useFlowExecution());
      expect(result.current.state.status).toBe("idle");
      expect(result.current.state.executionId).toBeNull();
      expect(result.current.state.steps.size).toBe(0);
      expect(result.current.state.totalCredits).toBe(0);
      expect(result.current.isConnected).toBe(false);
    });
  });

  describe("startExecution", () => {
    it("POSTs to execute endpoint and connects to SSE", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ executionId: "exec-1" }),
      });

      const { result } = renderHook(() => useFlowExecution());

      await act(async () => {
        await result.current.startExecution("flow-abc");
      });

      // Should have POSTed to the execute endpoint
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:3001/api/flows/flow-abc/execute",
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: "Bearer test-token",
          }),
        }),
      );

      // State should be running with the execution ID
      expect(result.current.state.status).toBe("running");
      expect(result.current.state.executionId).toBe("exec-1");

      // An EventSource should have been created
      expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1);
    });

    it("sets failed status when POST returns non-ok", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => "Internal Server Error",
      });

      const { result } = renderHook(() => useFlowExecution());

      await act(async () => {
        await result.current.startExecution("flow-fail");
      });

      expect(result.current.state.status).toBe("failed");
      expect(result.current.state.error).toContain("500");
    });

    it("sets failed status when fetch throws", async () => {
      mockFetch.mockRejectedValue(new Error("Network failure"));

      const { result } = renderHook(() => useFlowExecution());

      await act(async () => {
        await result.current.startExecution("flow-err");
      });

      expect(result.current.state.status).toBe("failed");
      expect(result.current.state.error).toBe("Network failure");
    });
  });

  describe("SSE event handling", () => {
    async function startAndGetES() {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ executionId: "exec-1" }),
      });

      const hook = renderHook(() => useFlowExecution());

      await act(async () => {
        await hook.result.current.startExecution("flow-1");
      });

      // Get the last EventSource instance
      const es = MockEventSource.instances[MockEventSource.instances.length - 1];
      return { hook, es };
    }

    it("handles step.started events", async () => {
      const { hook, es } = await startAndGetES();

      act(() => {
        es.simulateMessage({
          type: "jarble.flow.step.started",
          nodeId: "node-1",
          label: "Fetch Data",
        });
      });

      const step = hook.result.current.state.steps.get("node-1");
      expect(step).toBeDefined();
      expect(step!.status).toBe("running");
      expect(step!.label).toBe("Fetch Data");
    });

    it("handles step.finished events and accumulates credits", async () => {
      const { hook, es } = await startAndGetES();

      act(() => {
        es.simulateMessage({
          type: "jarble.flow.step.started",
          nodeId: "node-1",
          label: "Step 1",
        });
        es.simulateMessage({
          type: "jarble.flow.step.finished",
          nodeId: "node-1",
          label: "Step 1",
          status: "completed",
          credits: 5,
          durationMs: 1200,
        });
      });

      const step = hook.result.current.state.steps.get("node-1");
      expect(step!.status).toBe("completed");
      expect(step!.credits).toBe(5);
      expect(step!.durationMs).toBe(1200);
      expect(hook.result.current.state.totalCredits).toBe(5);
    });

    it("handles text_delta events (streaming inner text)", async () => {
      const { hook, es } = await startAndGetES();

      act(() => {
        es.simulateMessage({
          type: "jarble.flow.step.started",
          nodeId: "node-1",
          label: "LLM",
        });
        es.simulateMessage({
          type: "jarble.flow.step.text_delta",
          nodeId: "node-1",
          delta: "Hello ",
        });
        es.simulateMessage({
          type: "jarble.flow.step.text_delta",
          nodeId: "node-1",
          delta: "world",
        });
      });

      const step = hook.result.current.state.steps.get("node-1");
      expect(step!.innerText).toBe("Hello world");
    });

    it("handles flow.state completed - closes stream", async () => {
      const { hook, es } = await startAndGetES();

      act(() => {
        es.simulateMessage({
          type: "jarble.flow.state",
          status: "completed",
          totalCredits: 10,
        });
      });

      expect(hook.result.current.state.status).toBe("completed");
      expect(hook.result.current.state.totalCredits).toBe(10);
      expect(es.readyState).toBe(2); // CLOSED
    });

    it("handles flow.state failed - closes stream", async () => {
      const { hook, es } = await startAndGetES();

      act(() => {
        es.simulateMessage({
          type: "jarble.flow.state",
          status: "failed",
          error: "Out of credits",
        });
      });

      expect(hook.result.current.state.status).toBe("failed");
      expect(hook.result.current.state.error).toBe("Out of credits");
    });

    it("handles flow.error events", async () => {
      const { hook, es } = await startAndGetES();

      act(() => {
        es.simulateMessage({
          type: "jarble.flow.error",
          error: "Timeout exceeded",
        });
      });

      expect(hook.result.current.state.status).toBe("failed");
      expect(hook.result.current.state.error).toBe("Timeout exceeded");
    });

    it("handles flow.paused events (human-in-the-loop)", async () => {
      const { hook, es } = await startAndGetES();

      act(() => {
        es.simulateMessage({
          type: "jarble.flow.step.started",
          nodeId: "node-review",
          label: "Review",
        });
        es.simulateMessage({
          type: "jarble.flow.paused",
          nodeId: "node-review",
          inputSchema: { type: "object", properties: { approved: { type: "boolean" } } },
        });
      });

      expect(hook.result.current.state.status).toBe("paused");
      expect(hook.result.current.state.pausedNodeId).toBe("node-review");
      expect(hook.result.current.state.inputSchema).toBeDefined();
    });

    it("handles snapshot events (reconnect)", async () => {
      const { hook, es } = await startAndGetES();

      act(() => {
        es.simulateMessage({
          type: "jarble.flow.snapshot",
          executionId: "exec-1",
          status: "running",
          totalCredits: 3,
          steps: [
            { nodeId: "n1", label: "Step 1", status: "completed" },
            { nodeId: "n2", label: "Step 2", status: "running" },
          ],
        });
      });

      expect(hook.result.current.state.steps.size).toBe(2);
      expect(hook.result.current.state.steps.get("n1")!.status).toBe("completed");
      expect(hook.result.current.state.steps.get("n2")!.status).toBe("running");
      expect(hook.result.current.state.totalCredits).toBe(3);
    });

    it("handles iteration events for cycle/loop nodes", async () => {
      const { hook, es } = await startAndGetES();

      act(() => {
        es.simulateMessage({
          type: "jarble.flow.step.started",
          nodeId: "loop-1",
          label: "Loop",
        });
        es.simulateMessage({
          type: "jarble.flow.step.iteration",
          nodeId: "loop-1",
          iteration: 2,
          maxIterations: 5,
        });
      });

      const step = hook.result.current.state.steps.get("loop-1");
      expect(step!.iteration).toBe(2);
      expect(step!.maxIterations).toBe(5);
    });

    it("handles substep events for nested flows", async () => {
      const { hook, es } = await startAndGetES();

      act(() => {
        es.simulateMessage({
          type: "jarble.flow.step.started",
          nodeId: "parent-1",
          label: "Sub-flow",
        });
        es.simulateMessage({
          type: "jarble.flow.substep.started",
          parentNodeId: "parent-1",
          nodeId: "child-1",
          label: "Child Step",
        });
      });

      const parent = hook.result.current.state.steps.get("parent-1");
      expect(parent!.substeps).toHaveLength(1);
      expect(parent!.substeps![0].nodeId).toBe("child-1");
      expect(parent!.substeps![0].status).toBe("running");

      act(() => {
        es.simulateMessage({
          type: "jarble.flow.substep.finished",
          parentNodeId: "parent-1",
          nodeId: "child-1",
          status: "completed",
          durationMs: 500,
          credits: 2,
        });
      });

      const updated = hook.result.current.state.steps.get("parent-1");
      expect(updated!.substeps![0].status).toBe("completed");
      expect(updated!.substeps![0].durationMs).toBe(500);
    });

    it("ignores malformed JSON messages gracefully", async () => {
      const { hook, es } = await startAndGetES();

      act(() => {
        // Directly call onmessage with invalid JSON
        es.onmessage?.({ data: "not-json{" });
      });

      // Should not crash - state stays as-is
      expect(hook.result.current.state.status).toBe("running");
    });
  });

  describe("cancel", () => {
    it("sets failed status with cancellation message", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ executionId: "exec-1" }),
      });

      const { result } = renderHook(() => useFlowExecution());

      await act(async () => {
        await result.current.startExecution("flow-1");
      });

      act(() => {
        result.current.cancel();
      });

      expect(result.current.state.status).toBe("failed");
      expect(result.current.state.error).toBe("Execution cancelled");
    });

    it("does not change status for already completed executions", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ executionId: "exec-1" }),
      });

      const { result } = renderHook(() => useFlowExecution());

      await act(async () => {
        await result.current.startExecution("flow-1");
      });

      const es = MockEventSource.instances[MockEventSource.instances.length - 1];

      act(() => {
        es.simulateMessage({ type: "jarble.flow.state", status: "completed" });
      });

      act(() => {
        result.current.cancel();
      });

      // Status should remain completed, not change to failed
      expect(result.current.state.status).toBe("completed");
    });
  });

  describe("reconnect", () => {
    it("creates a new EventSource for existing execution", async () => {
      const { result } = renderHook(() => useFlowExecution());

      const countBefore = MockEventSource.instances.length;

      await act(async () => {
        result.current.reconnect("exec-existing");
        // connectToStream is async - flush the microtask queue
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(result.current.state.executionId).toBe("exec-existing");
      expect(result.current.state.status).toBe("running");
      expect(MockEventSource.instances.length).toBeGreaterThan(countBefore);
    });
  });
});
