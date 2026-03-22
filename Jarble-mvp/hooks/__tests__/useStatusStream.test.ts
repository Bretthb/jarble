import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { DeploymentStatus } from "../useStatusStream";

// ── Mocks ───────────────────────────────────────────────────────────────────

// Mock EventSource
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, ((event: MessageEvent) => void)[]>();
  readyState = 0;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (event: MessageEvent) => void) {
    const list = this.listeners.get(type) || [];
    list.push(cb);
    this.listeners.set(type, list);
  }

  removeEventListener(type: string, cb: (event: MessageEvent) => void) {
    const list = this.listeners.get(type) || [];
    this.listeners.set(
      type,
      list.filter((fn) => fn !== cb),
    );
  }

  close() {
    this.closed = true;
    this.readyState = 2;
  }

  // Test helpers
  _emit(type: string, data: unknown) {
    const event = { data: JSON.stringify(data) } as MessageEvent;
    if (type === "message" && this.onmessage) {
      this.onmessage(event);
    }
    const list = this.listeners.get(type) || [];
    for (const cb of list) cb(event);
  }

  _triggerOpen() {
    this.readyState = 1;
    this.onopen?.();
  }

  _triggerError() {
    const list = this.listeners.get("error") || [];
    for (const cb of list) cb({} as MessageEvent);
  }
}

// Mock Auth0
const mockGetAccessTokenSilently = vi.fn().mockResolvedValue("test-token-123");
vi.mock("@auth0/auth0-react", () => ({
  useAuth0: () => ({
    getAccessTokenSilently: mockGetAccessTokenSilently,
    isAuthenticated: true,
  }),
}));

vi.mock("@/lib/trpc", () => ({
  API_URL: "http://localhost:3001",
}));

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useStatusStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    MockEventSource.instances = [];
    vi.stubGlobal("EventSource", MockEventSource);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // Dynamically import after mocks are set up
  async function importHook() {
    const mod = await import("../useStatusStream");
    return mod.useStatusStream;
  }

  it("creates EventSource with correct URL when enabled=true", async () => {
    const useStatusStream = await importHook();
    renderHook(() => useStatusStream({ enabled: true }));

    // Wait for async connect() to resolve
    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1);
    const es = MockEventSource.instances[0];
    expect(es.url).toBe(
      "http://localhost:3001/api/deployments/status/stream?token=test-token-123",
    );
  });

  it("does not create EventSource when enabled=false", async () => {
    const useStatusStream = await importHook();
    renderHook(() => useStatusStream({ enabled: false }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(MockEventSource.instances).toHaveLength(0);
  });

  it("sets isConnected to true on EventSource open", async () => {
    const useStatusStream = await importHook();
    const { result } = renderHook(() => useStatusStream({ enabled: true }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.isConnected).toBe(false);

    act(() => {
      MockEventSource.instances[0]._triggerOpen();
    });

    expect(result.current.isConnected).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it("parses snapshot event and populates statuses map", async () => {
    const useStatusStream = await importHook();
    const { result } = renderHook(() => useStatusStream({ enabled: true }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const snapshot: DeploymentStatus[] = [
      { deploymentId: "dep-1", status: "running" },
      { deploymentId: "dep-2", status: "stopped", restarts: 3 },
    ];

    act(() => {
      MockEventSource.instances[0]._triggerOpen();
      MockEventSource.instances[0]._emit("snapshot", snapshot);
    });

    expect(result.current.statuses.size).toBe(2);
    expect(result.current.getStatus("dep-1")).toEqual({
      deploymentId: "dep-1",
      status: "running",
    });
    expect(result.current.getStatus("dep-2")).toEqual({
      deploymentId: "dep-2",
      status: "stopped",
      restarts: 3,
    });
  });

  it("getStatus returns latest status per deployment ID from delta messages", async () => {
    const useStatusStream = await importHook();
    const { result } = renderHook(() => useStatusStream({ enabled: true }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    act(() => {
      MockEventSource.instances[0]._triggerOpen();
      MockEventSource.instances[0]._emit("message", {
        deploymentId: "dep-1",
        status: "creating",
      });
    });

    expect(result.current.getStatus("dep-1")?.status).toBe("creating");

    // Update the same deployment
    act(() => {
      MockEventSource.instances[0]._emit("message", {
        deploymentId: "dep-1",
        status: "running",
      });
    });

    expect(result.current.getStatus("dep-1")?.status).toBe("running");
  });

  it('removes deployment from map when status is "not_found"', async () => {
    const useStatusStream = await importHook();
    const { result } = renderHook(() => useStatusStream({ enabled: true }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    act(() => {
      MockEventSource.instances[0]._triggerOpen();
      MockEventSource.instances[0]._emit("message", {
        deploymentId: "dep-1",
        status: "running",
      });
    });

    expect(result.current.getStatus("dep-1")).toBeDefined();

    act(() => {
      MockEventSource.instances[0]._emit("message", {
        deploymentId: "dep-1",
        status: "not_found",
      });
    });

    expect(result.current.getStatus("dep-1")).toBeUndefined();
  });

  it("closes EventSource on unmount", async () => {
    const useStatusStream = await importHook();
    const { unmount } = renderHook(() => useStatusStream({ enabled: true }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const es = MockEventSource.instances[0];
    expect(es.closed).toBe(false);

    unmount();
    expect(es.closed).toBe(true);
  });

  it("reconnects with exponential backoff on error", async () => {
    const useStatusStream = await importHook();
    renderHook(() => useStatusStream({ enabled: true }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    const firstEs = MockEventSource.instances[0];

    // Trigger error — should schedule reconnect after 1s (1000 * 2^0)
    act(() => {
      firstEs._triggerError();
    });

    expect(firstEs.closed).toBe(true);
    const countBeforeTimer = MockEventSource.instances.length;

    // Advance past the 1s backoff delay
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    // A new EventSource should have been created
    expect(MockEventSource.instances.length).toBeGreaterThan(countBeforeTimer);
  });

  it("getStatus returns undefined for unknown deployment IDs", async () => {
    const useStatusStream = await importHook();
    const { result } = renderHook(() => useStatusStream({ enabled: true }));

    await act(async () => {
      await vi.runAllTimersAsync();
    });

    expect(result.current.getStatus("nonexistent")).toBeUndefined();
  });
});
