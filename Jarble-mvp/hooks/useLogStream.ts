"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";

export interface LogLine {
  id: number;
  timestamp?: string;
  text: string;
}

interface UseLogStreamOptions {
  deploymentId: string;
  enabled: boolean;
  tailLines?: number;
  maxLines?: number;
}

interface UseLogStreamReturn {
  lines: LogLine[];
  isConnected: boolean;
  isPaused: boolean;
  error: string | null;
  pause: () => void;
  resume: () => void;
  clear: () => void;
  downloadLogs: () => void;
}

const MAX_RECONNECT_DELAY = 30_000;

export function useLogStream({
  deploymentId,
  enabled,
  tailLines = 100,
  maxLines = 5000,
}: UseLogStreamOptions): UseLogStreamReturn {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();
  const [lines, setLines] = useState<LogLine[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eventSourceRef = useRef<EventSource | null>(null);
  const lineIdRef = useRef(0);
  const isPausedRef = useRef(false);
  const retryCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Parse a K8s log line with optional timestamp prefix
  const parseLogLine = useCallback((raw: string): LogLine => {
    const id = lineIdRef.current++;
    // K8s timestamps: "2024-01-15T10:30:00.123456789Z rest of line"
    const tsMatch = raw.match(
      /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z)\s(.*)$/
    );
    if (tsMatch) {
      return { id, timestamp: tsMatch[1], text: tsMatch[2] };
    }
    return { id, text: raw };
  }, []);

  // Connect to SSE endpoint
  useEffect(() => {
    if (!enabled || !isAuthenticated || !deploymentId) return;

    let cancelled = false;

    async function connect() {
      if (cancelled) return;

      try {
        const token = await getAccessTokenSilently();

        // EventSource doesn't support custom headers, pass token as query param
        const url = `${API_URL}/api/deployments/${deploymentId}/logs/stream`
          + `?token=${encodeURIComponent(token)}&tailLines=${tailLines}`;

        const es = new EventSource(url);
        eventSourceRef.current = es;

        es.onopen = () => {
          if (!cancelled) {
            setIsConnected(true);
            setError(null);
            retryCountRef.current = 0;
          }
        };

        es.onmessage = (event) => {
          if (cancelled || isPausedRef.current) return;
          try {
            const data = JSON.parse(event.data);
            if (data.line) {
              const parsed = parseLogLine(data.line);
              setLines((prev) => {
                const updated = [...prev, parsed];
                return updated.length > maxLines
                  ? updated.slice(updated.length - maxLines)
                  : updated;
              });
            }
          } catch {
            // Non-JSON data, treat as raw line
            if (event.data) {
              const parsed = parseLogLine(event.data);
              setLines((prev) => {
                const updated = [...prev, parsed];
                return updated.length > maxLines
                  ? updated.slice(updated.length - maxLines)
                  : updated;
              });
            }
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

        es.addEventListener("end", () => {
          if (!cancelled) {
            setIsConnected(false);
            es.close();
            eventSourceRef.current = null;
          }
        });
      } catch {
        if (!cancelled) {
          setError("Failed to connect to log stream");
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
  }, [deploymentId, enabled, isAuthenticated, tailLines, maxLines,
      getAccessTokenSilently, parseLogLine]);

  const pause = useCallback(() => {
    setIsPaused(true);
    isPausedRef.current = true;
  }, []);
  const resume = useCallback(() => {
    setIsPaused(false);
    isPausedRef.current = false;
  }, []);
  const clear = useCallback(() => setLines([]), []);

  const downloadLogs = useCallback(() => {
    const text = lines.map((l) => {
      return l.timestamp ? `${l.timestamp} ${l.text}` : l.text;
    }).join("\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${deploymentId}-${new Date().toISOString().slice(0, 19)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [lines, deploymentId]);

  return {
    lines,
    isConnected,
    isPaused,
    error,
    pause,
    resume,
    clear,
    downloadLogs,
  };
}
