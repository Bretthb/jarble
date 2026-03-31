"use client";

/**
 * useOrchestration - WebSocket hook for real-time orchestration events.
 *
 * Connects to the backend's /ws/orchestration endpoint and receives events
 * when the bot delegates work to subagents, platform agents, or team members.
 * These events drive the OrchestrationSteps UI to show actual agent activity.
 *
 * Follows the same connection/reconnection pattern as useChatControl.ts.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";

const isDev = process.env.NODE_ENV === "development";

/** Convert HTTP API URL to WebSocket URL */
function getWsUrl(): string {
  const base = API_URL.replace(/^http/, "ws");
  return `${base}/ws/orchestration`;
}

const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

/** Time (ms) after all steps are complete/error before auto-clearing */
const AUTO_CLEAR_DELAY_MS = 5_000;

// ── Types ────────────────────────────────────────────────────────────────────

export interface OrchestrationStep {
  id: string;
  label: string;
  status: "pending" | "running" | "complete" | "error";
  agentType: "subagent" | "delegation" | "platform";
  toolName: string;
  detail?: string;
  duration?: number;
  targetDeploymentId?: string;
}

/** Server → Client: step started */
interface StepStartMessage {
  type: "step.start";
  stepId: string;
  agentType: "subagent" | "delegation" | "platform";
  agentName: string;
  toolName: string;
  task?: string;
  targetDeploymentId?: string;
}

/** Server → Client: step ended */
interface StepEndMessage {
  type: "step.end";
  stepId: string;
  agentType: "subagent" | "delegation" | "platform";
  agentName: string;
  toolName: string;
  success: boolean;
  durationMs: number;
  error?: string;
  resultPreview?: string;
}

type ServerMessage = StepStartMessage | StepEndMessage;

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useOrchestration(deploymentId: string | null): {
  steps: OrchestrationStep[];
  cancelStep: (stepId: string) => void;
  isConnected: boolean;
  clearSteps: () => void;
} {
  const { getAccessTokenSilently } = useAuth0();
  const [steps, setSteps] = useState<OrchestrationStep[]>([]);
  const [isConnected, setIsConnected] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(MIN_RECONNECT_MS);
  const mountedRef = useRef(true);
  const deploymentIdRef = useRef(deploymentId);
  deploymentIdRef.current = deploymentId;

  // Auto-clear timer: fires when all steps have been complete/error for AUTO_CLEAR_DELAY_MS
  const autoClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auto-clear logic ─────────────────────────────────────────────────────
  // Whenever steps change, check if all are terminal. If so, start a timer.
  useEffect(() => {
    if (autoClearTimerRef.current) {
      clearTimeout(autoClearTimerRef.current);
      autoClearTimerRef.current = null;
    }

    if (steps.length === 0) return;

    const allTerminal = steps.every(
      (s) => s.status === "complete" || s.status === "error",
    );

    if (allTerminal) {
      autoClearTimerRef.current = setTimeout(() => {
        setSteps([]);
        autoClearTimerRef.current = null;
      }, AUTO_CLEAR_DELAY_MS);
    }

    return () => {
      if (autoClearTimerRef.current) {
        clearTimeout(autoClearTimerRef.current);
        autoClearTimerRef.current = null;
      }
    };
  }, [steps]);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
      wsRef.current.onopen = null;
      if (
        wsRef.current.readyState === WebSocket.OPEN ||
        wsRef.current.readyState === WebSocket.CONNECTING
      ) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  // ── Connect ──────────────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    if (!mountedRef.current) return;
    if (!deploymentIdRef.current) return;
    cleanup();

    let token: string;
    try {
      token = await getAccessTokenSilently();
    } catch {
      isDev &&
        console.log(
          "[Jarble:Orchestration] Failed to get token, will retry",
        );
      scheduleReconnect();
      return;
    }

    const wsUrl = `${getWsUrl()}?token=${encodeURIComponent(token)}&deploymentId=${encodeURIComponent(deploymentIdRef.current)}`;
    isDev && console.log("[Jarble:Orchestration] Connecting to", getWsUrl());

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      isDev && console.log("[Jarble:Orchestration] Connected");
      setIsConnected(true);
      reconnectDelayRef.current = MIN_RECONNECT_MS; // Reset backoff on success
    };

    ws.onclose = (event) => {
      isDev &&
        console.log(
          `[Jarble:Orchestration] Disconnected (code=${event.code})`,
        );
      setIsConnected(false);
      wsRef.current = null;
      // Don't reconnect on clean close (1000) or auth failure (4001)
      if (event.code !== 1000 && event.code !== 4001 && mountedRef.current) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // Error is followed by close, so reconnect will happen in onclose
      isDev && console.log("[Jarble:Orchestration] WS error");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        handleMessage(msg);
      } catch {
        // Ignore malformed messages
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    function scheduleReconnect() {
      if (!mountedRef.current) return;
      const delay = reconnectDelayRef.current;
      isDev &&
        console.log(
          `[Jarble:Orchestration] Reconnecting in ${delay}ms`,
        );
      reconnectTimerRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_MS);
        connect();
      }, delay);
    }
  }, [getAccessTokenSilently, cleanup]);

  // ── Message handler ──────────────────────────────────────────────────────
  const handleMessage = useCallback((msg: ServerMessage) => {
    switch (msg.type) {
      case "step.start": {
        const newStep: OrchestrationStep = {
          id: msg.stepId,
          label: msg.agentName,
          status: "running",
          agentType: msg.agentType,
          toolName: msg.toolName,
          detail: msg.task,
          targetDeploymentId: msg.targetDeploymentId,
        };
        setSteps((prev) => {
          // Avoid duplicates if we receive the same stepId again
          if (prev.some((s) => s.id === msg.stepId)) {
            return prev.map((s) =>
              s.id === msg.stepId ? { ...s, status: "running" as const } : s,
            );
          }
          return [...prev, newStep];
        });
        break;
      }

      case "step.end": {
        setSteps((prev) =>
          prev.map((s) =>
            s.id === msg.stepId
              ? {
                  ...s,
                  status: msg.success
                    ? ("complete" as const)
                    : ("error" as const),
                  duration: msg.durationMs,
                  detail: msg.error
                    ? msg.error
                    : msg.resultPreview
                      ? msg.resultPreview
                      : s.detail,
                }
              : s,
          ),
        );
        break;
      }
    }
  }, []);

  // ── Connect on mount / when deploymentId changes ─────────────────────────
  useEffect(() => {
    mountedRef.current = true;

    if (deploymentId) {
      connect();
    } else {
      cleanup();
    }

    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [deploymentId, connect, cleanup]);

  // ── cancelStep: send cancel message over WS ──────────────────────────────
  const cancelStep = useCallback((stepId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "cancel", stepId }));
    }
  }, []);

  // ── clearSteps: manually reset ────────────────────────────────────────────
  const clearSteps = useCallback(() => {
    setSteps([]);
  }, []);

  return { steps, cancelStep, isConnected, clearSteps };
}
