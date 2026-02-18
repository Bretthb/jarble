"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";

export interface DeploymentStatus {
  deploymentId: string;
  status: string;
  restarts?: number;
  error?: string;
}

interface UseStatusStreamOptions {
  enabled: boolean;
}

interface UseStatusStreamReturn {
  statuses: Map<string, DeploymentStatus>;
  getStatus: (id: string) => DeploymentStatus | undefined;
  isConnected: boolean;
  error: string | null;
}

const MAX_RECONNECT_DELAY = 30_000;

export function useStatusStream({
  enabled,
}: UseStatusStreamOptions): UseStatusStreamReturn {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();
  const [statuses, setStatuses] = useState<Map<string, DeploymentStatus>>(
    new Map()
  );
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!enabled || !isAuthenticated) return;

    let cancelled = false;

    async function connect() {
      if (cancelled) return;

      try {
        const token = await getAccessTokenSilently();
        const url = `${API_URL}/api/deployments/status/stream?token=${encodeURIComponent(token)}`;

        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onopen = () => {
          if (!cancelled) {
            setIsConnected(true);
            setError(null);
            retryCountRef.current = 0; // Reset on successful connection
          }
        };

        // Handle initial snapshot
        es.addEventListener("snapshot", (event) => {
          if (cancelled) return;
          try {
            const data: DeploymentStatus[] = JSON.parse(event.data);
            setStatuses(
              new Map(data.map((s) => [s.deploymentId, s]))
            );
          } catch {
            // Ignore parse errors
          }
        });

        // Handle individual status updates (deltas)
        es.onmessage = (event) => {
          if (cancelled) return;
          try {
            const data: DeploymentStatus = JSON.parse(event.data);
            setStatuses((prev) => {
              const next = new Map(prev);
              if (data.status === "not_found") {
                next.delete(data.deploymentId);
              } else {
                next.set(data.deploymentId, data);
              }
              return next;
            });
          } catch {
            // Ignore parse errors
          }
        };

        es.addEventListener("error", () => {
          if (!cancelled) {
            setIsConnected(false);
            es.close();
            eventSourceRef.current = null;
            // Reconnect with exponential backoff
            const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), MAX_RECONNECT_DELAY);
            retryCountRef.current++;
            reconnectTimerRef.current = setTimeout(() => {
              if (!cancelled) connect();
            }, delay);
          }
        });
      } catch {
        if (!cancelled) {
          setError("Failed to connect to status stream");
          setIsConnected(false);
          // Retry after delay
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current), MAX_RECONNECT_DELAY);
          retryCountRef.current++;
          reconnectTimerRef.current = setTimeout(() => {
            if (!cancelled) connect();
          }, delay);
        }
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      setIsConnected(false);
    };
  }, [enabled, isAuthenticated, getAccessTokenSilently]);

  const getStatus = useCallback(
    (id: string) => statuses.get(id),
    [statuses]
  );

  return {
    statuses,
    getStatus,
    isConnected,
    error,
  };
}
