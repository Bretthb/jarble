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
  /** Streaming inner text from deployment steps (e.g. LLM output) */
  innerText?: string;
  /** Current iteration number for cycle/loop nodes */
  iteration?: number;
  /** Maximum iterations allowed for cycle/loop nodes */
  maxIterations?: number;
  /** Substeps for nested/subflow nodes */
  substeps?: FlowStepStatus[];
}

export interface FlowExecutionState {
  executionId: string | null;
  status: "idle" | "running" | "completed" | "failed" | "paused";
  steps: Map<string, FlowStepStatus>;
  totalCredits: number;
  error?: string;
  /** Node ID that is currently paused waiting for human input */
  pausedNodeId?: string;
  /** JSON Schema describing the expected input for the paused node */
  inputSchema?: Record<string, unknown>;
}

interface UseFlowExecutionReturn {
  state: FlowExecutionState;
  startExecution: (flowId: string, prompt?: string) => Promise<void>;
  resumeExecution: (nodeId: string, input: unknown) => Promise<void>;
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
        const flowId = activeFlowIdRef.current || "_";
        const url = `${API_URL}/api/flows/${encodeURIComponent(flowId)}/executions/${encodeURIComponent(executionId)}/stream?token=${encodeURIComponent(token)}`;

        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onopen = () => {
          if (!cancelledRef.current) {
            setIsConnected(true);
            retryCountRef.current = 0;
          }
        };

        // ── All events come as unnamed data: messages with a "type" field ──
        es.onmessage = (event) => {
          if (cancelledRef.current) return;
          try {
            const data = JSON.parse(event.data);
            const type = data.type as string;

            // Snapshot: initial state of all steps on reconnect
            if (type === "jarble.flow.snapshot") {
              // Backend sends stepResults as an object { nodeId: StepResult }
              const steps = new Map<string, FlowStepStatus>();
              const stepResults = data.stepResults || data.steps;
              if (stepResults && typeof stepResults === "object" && !Array.isArray(stepResults)) {
                for (const [nodeId, result] of Object.entries(stepResults)) {
                  steps.set(nodeId, { nodeId, ...(result as Record<string, unknown>) } as unknown as FlowStepStatus);
                }
              } else if (Array.isArray(stepResults)) {
                for (const s of stepResults as FlowStepStatus[]) {
                  steps.set(s.nodeId, s);
                }
              }
              setState({
                executionId: data.executionId || executionId,
                status: data.status || "running",
                steps,
                totalCredits: data.totalCredits ?? 0,
              });
            }

            // Step started
            if (type === "jarble.flow.step.started") {
              setState((prev) => {
                const next = new Map(prev.steps);
                next.set(data.nodeId, {
                  nodeId: data.nodeId,
                  label: data.label,
                  status: "running",
                });
                return { ...prev, steps: next };
              });
            }

            // Step finished
            if (type === "jarble.flow.step.finished") {
              setState((prev) => {
                const next = new Map(prev.steps);
                next.set(data.nodeId, {
                  nodeId: data.nodeId,
                  label: data.label,
                  status: data.status,
                  result: data.result,
                  error: data.error,
                  durationMs: data.durationMs,
                  credits: data.credits,
                });
                const totalCredits = Array.from(next.values()).reduce(
                  (sum, s) => sum + (s.credits ?? 0), 0
                );
                return { ...prev, steps: next, totalCredits };
              });
            }

            // Inner-step streaming text (e.g. LLM output from a deployment node)
            if (type === "jarble.flow.step.text_delta") {
              setState((prev) => {
                const next = new Map(prev.steps);
                const existing: FlowStepStatus = next.get(data.nodeId) || {
                  nodeId: data.nodeId,
                  label: "",
                  status: "running",
                  innerText: "",
                };
                next.set(data.nodeId, {
                  ...existing,
                  innerText: (existing.innerText || "") + (data.delta || ""),
                });
                return { ...prev, steps: next };
              });
            }

            // Flow paused for human-in-the-loop input
            if (type === "jarble.flow.paused") {
              setState((prev) => ({
                ...prev,
                status: "paused",
                pausedNodeId: data.nodeId,
                inputSchema: data.inputSchema,
              }));
              // Also update the specific step to show paused status
              setState((prev) => {
                const next = new Map(prev.steps);
                const existing = next.get(data.nodeId);
                if (existing) {
                  next.set(data.nodeId, { ...existing, status: "running" });
                }
                return { ...prev, steps: next };
              });
            }

            // Iteration event for cycle/loop nodes
            if (type === "jarble.flow.step.iteration") {
              setState((prev) => {
                const next = new Map(prev.steps);
                const existing = next.get(data.nodeId);
                if (existing) {
                  next.set(data.nodeId, {
                    ...existing,
                    iteration: data.iteration,
                    maxIterations: data.maxIterations,
                  });
                }
                return { ...prev, steps: next };
              });
            }

            // Substep started (nested/subflow execution)
            if (type === "jarble.flow.substep.started") {
              setState((prev) => {
                const next = new Map(prev.steps);
                const parent = next.get(data.parentNodeId);
                if (parent) {
                  const substeps = parent.substeps ? [...parent.substeps] : [];
                  substeps.push({
                    nodeId: data.nodeId,
                    label: data.label,
                    status: "running",
                  });
                  next.set(data.parentNodeId, { ...parent, substeps });
                }
                return { ...prev, steps: next };
              });
            }

            // Substep finished (nested/subflow execution)
            if (type === "jarble.flow.substep.finished") {
              setState((prev) => {
                const next = new Map(prev.steps);
                const parent = next.get(data.parentNodeId);
                if (parent && parent.substeps) {
                  const substeps = parent.substeps.map((s) =>
                    s.nodeId === data.nodeId
                      ? {
                          ...s,
                          status: data.status as FlowStepStatus["status"],
                          result: data.result,
                          error: data.error,
                          durationMs: data.durationMs,
                          credits: data.credits,
                        }
                      : s
                  );
                  next.set(data.parentNodeId, { ...parent, substeps });
                }
                return { ...prev, steps: next };
              });
            }

            // Flow-level state change
            if (type === "jarble.flow.state") {
              setState((prev) => ({
                ...prev,
                status: data.status,
                error: data.error,
                totalCredits: data.totalCredits ?? prev.totalCredits,
              }));
              // Terminal states - close stream cleanly
              if (data.status === "completed" || data.status === "failed" || data.status === "cancelled") {
                cancelledRef.current = true; // prevent reconnection
                es.close();
                eventSourceRef.current = null;
                setIsConnected(false);
              }
            }

            // Flow error
            if (type === "jarble.flow.error") {
              setState((prev) => ({
                ...prev,
                status: "failed",
                error: data.error || "Unknown error",
              }));
            }

            // Heartbeat - ignore
          } catch {
            // Ignore parse errors
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
    async (flowId: string, prompt?: string) => {
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
            body: JSON.stringify(prompt ? { prompt } : {}),
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
      status: prev.status === "running" || prev.status === "paused" ? "failed" : prev.status,
      error: prev.status === "running" || prev.status === "paused" ? "Execution cancelled" : prev.error,
      pausedNodeId: undefined,
      inputSchema: undefined,
    }));
  }, [cleanup]);

  // ─── Resume paused execution (human-in-the-loop) ───────────────

  const resumeExecution = useCallback(
    async (nodeId: string, input: unknown) => {
      if (!isAuthenticated) return;

      const flowId = activeFlowIdRef.current;
      const execId = state.executionId;
      if (!flowId || !execId) return;

      try {
        const token = await getAccessTokenSilently();
        const res = await fetch(
          `${API_URL}/api/flows/${encodeURIComponent(flowId)}/executions/${encodeURIComponent(execId)}/resume`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ nodeId, input }),
          }
        );

        if (!res.ok) {
          const body = await res.text();
          setState((prev) => ({
            ...prev,
            error: `Resume failed: ${res.status} ${body}`,
          }));
          return;
        }

        // Clear paused state and transition back to running
        setState((prev) => ({
          ...prev,
          status: "running",
          pausedNodeId: undefined,
          inputSchema: undefined,
        }));

        // Reconnect to SSE to get remaining events
        cleanup();
        cancelledRef.current = false;
        retryCountRef.current = 0;
        await connectToStream(execId);
      } catch (err) {
        setState((prev) => ({
          ...prev,
          error: err instanceof Error ? err.message : "Failed to resume execution",
        }));
      }
    },
    [isAuthenticated, state.executionId, getAccessTokenSilently, cleanup, connectToStream]
  );

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
    resumeExecution,
    cancel,
    reconnect,
    isConnected,
  };
}
