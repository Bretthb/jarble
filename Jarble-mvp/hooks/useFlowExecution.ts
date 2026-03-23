"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";

// ─── Types ───────────────────────────────────────────────────────────

export interface FlowStepStatus {
  nodeId: string;
  label: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: unknown;
  error?: string;
  durationMs?: number;
  credits?: number;
}

export interface FlowExecutionState {
  executionId: string | null;
  status: "idle" | "running" | "completed" | "failed";
  steps: Map<string, FlowStepStatus>;
  totalCredits: number;
  error?: string;
}

interface UseFlowExecutionReturn {
  state: FlowExecutionState;
  startExecution: (flowId: string) => Promise<void>;
  cancel: () => void;
  reconnect: (executionId: string) => void;
  isConnected: boolean;
}

const INITIAL_STATE: FlowExecutionState = {
  executionId: null,
  status: "idle",
  steps: new Map(),
  totalCredits: 0,
};

const MAX_RECONNECT_DELAY = 30_000;

export function useFlowExecution(): UseFlowExecutionReturn {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();
  const [state, setState] = useState<FlowExecutionState>(INITIAL_STATE);
  const [isConnected, setIsConnected] = useState(false);

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);
  const activeFlowIdRef = useRef<string | null>(null);

  // ─── Cleanup helper ──────────────────────────────────────────────

  const cleanup = useCallback(() => {
    cancelledRef.current = true;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // ─── Connect to SSE stream ──────────────────────────────────────

  const connectToStream = useCallback(
    async (executionId: string) => {
      if (!isAuthenticated) return;

      cancelledRef.current = false;

      try {
        const token = await getAccessTokenSilently();
        const url = `${API_URL}/api/flows/executions/${encodeURIComponent(executionId)}/stream?token=${encodeURIComponent(token)}`;

        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onopen = () => {
          if (!cancelledRef.current) {
            setIsConnected(true);
            retryCountRef.current = 0;
          }
        };

        // ── Snapshot: initial state of all steps ──
        es.addEventListener("snapshot", (event) => {
          if (cancelledRef.current) return;
          try {
            const data = JSON.parse(event.data) as {
              executionId: string;
              status: FlowExecutionState["status"];
              steps: FlowStepStatus[];
              totalCredits: number;
            };
            setState({
              executionId: data.executionId,
              status: data.status,
              steps: new Map(data.steps.map((s) => [s.nodeId, s])),
              totalCredits: data.totalCredits,
            });
          } catch {
            // Ignore parse errors
          }
        });

        // ── Step update: single step changed ──
        es.addEventListener("step_update", (event) => {
          if (cancelledRef.current) return;
          try {
            const step = JSON.parse(event.data) as FlowStepStatus;
            setState((prev) => {
              const next = new Map(prev.steps);
              next.set(step.nodeId, step);
              const totalCredits = Array.from(next.values()).reduce(
                (sum, s) => sum + (s.credits ?? 0),
                0
              );
              return { ...prev, steps: next, totalCredits };
            });
          } catch {
            // Ignore parse errors
          }
        });

        // ── Flow-level status change (running -> completed/failed) ──
        es.addEventListener("flow_status", (event) => {
          if (cancelledRef.current) return;
          try {
            const data = JSON.parse(event.data) as {
              status: FlowExecutionState["status"];
              error?: string;
              totalCredits?: number;
            };
            setState((prev) => ({
              ...prev,
              status: data.status,
              error: data.error,
              totalCredits: data.totalCredits ?? prev.totalCredits,
            }));
            // If the flow is done, close the stream cleanly
            if (data.status === "completed" || data.status === "failed") {
              es.close();
              eventSourceRef.current = null;
              setIsConnected(false);
            }
          } catch {
            // Ignore parse errors
          }
        });

        // ── Default message handler (fallback) ──
        es.onmessage = (event) => {
          if (cancelledRef.current) return;
          try {
            const data = JSON.parse(event.data);
            // Handle heartbeat / keepalive
            if (data.type === "heartbeat") return;
          } catch {
            // Ignore
          }
        };

        // ── Error / reconnect ──
        es.addEventListener("error", () => {
          if (!cancelledRef.current) {
            setIsConnected(false);
            es.close();
            eventSourceRef.current = null;

            const delay = Math.min(
              1000 * Math.pow(2, retryCountRef.current),
              MAX_RECONNECT_DELAY
            );
            retryCountRef.current++;
            reconnectTimerRef.current = setTimeout(() => {
              if (!cancelledRef.current) {
                connectToStream(executionId);
              }
            }, delay);
          }
        });
      } catch {
        if (!cancelledRef.current) {
          setState((prev) => ({
            ...prev,
            error: "Failed to connect to execution stream",
          }));
          setIsConnected(false);

          const delay = Math.min(
            1000 * Math.pow(2, retryCountRef.current),
            MAX_RECONNECT_DELAY
          );
          retryCountRef.current++;
          reconnectTimerRef.current = setTimeout(() => {
            if (!cancelledRef.current) {
              connectToStream(executionId);
            }
          }, delay);
        }
      }
    },
    [isAuthenticated, getAccessTokenSilently]
  );

  // ─── Start execution (POST to create, then stream) ─────────────

  const startExecution = useCallback(
    async (flowId: string) => {
      if (!isAuthenticated) return;

      // Clean up any existing stream
      cleanup();
      cancelledRef.current = false;
      activeFlowIdRef.current = flowId;
      retryCountRef.current = 0;

      // Reset state to running
      setState({
        executionId: null,
        status: "running",
        steps: new Map(),
        totalCredits: 0,
      });

      try {
        const token = await getAccessTokenSilently();

        // POST to kick off execution; response gives us executionId
        const res = await fetch(
          `${API_URL}/api/flows/${encodeURIComponent(flowId)}/execute`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (!res.ok) {
          const body = await res.text();
          setState((prev) => ({
            ...prev,
            status: "failed",
            error: `Execution failed to start: ${res.status} ${body}`,
          }));
          return;
        }

        const { executionId } = (await res.json()) as {
          executionId: string;
        };

        setState((prev) => ({ ...prev, executionId }));

        // Now connect to SSE for live updates
        await connectToStream(executionId);
      } catch (err) {
        setState((prev) => ({
          ...prev,
          status: "failed",
          error:
            err instanceof Error
              ? err.message
              : "Failed to start flow execution",
        }));
      }
    },
    [isAuthenticated, getAccessTokenSilently, cleanup, connectToStream]
  );

  // ─── Cancel running execution ──────────────────────────────────

  const cancel = useCallback(() => {
    cleanup();
    setState((prev) => ({
      ...prev,
      status: prev.status === "running" ? "failed" : prev.status,
      error: prev.status === "running" ? "Execution cancelled" : prev.error,
    }));
  }, [cleanup]);

  // ─── Reconnect to existing execution (e.g. after page reload) ──

  const reconnect = useCallback(
    (executionId: string) => {
      cleanup();
      cancelledRef.current = false;
      retryCountRef.current = 0;
      setState((prev) => ({ ...prev, executionId, status: "running" }));
      connectToStream(executionId);
    },
    [cleanup, connectToStream]
  );

  // ─── Cleanup on unmount ────────────────────────────────────────

  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  return {
    state,
    startExecution,
    cancel,
    reconnect,
    isConnected,
  };
}
