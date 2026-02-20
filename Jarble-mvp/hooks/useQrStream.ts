"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";

interface UseQrStreamOptions {
  deploymentId: string;
  enabled: boolean;
}

interface UseQrStreamReturn {
  qrData: string | null;
  connected: boolean;
  timedOut: boolean;
  isConnecting: boolean;
  error: string | null;
  debugLines: string[];
  start: () => void;
  reset: () => void;
}

export function useQrStream({
  deploymentId,
  enabled,
}: UseQrStreamOptions): UseQrStreamReturn {
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();
  const [qrData, setQrData] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugLines, setDebugLines] = useState<string[]>([]);

  const esRef = useRef<EventSource | null>(null);
  const mountedRef = useRef(true);

  const closeStream = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
  }, []);

  const start = useCallback(async () => {
    closeStream();
    setQrData(null);
    setConnected(false);
    setTimedOut(false);
    setError(null);
    setIsConnecting(true);
    setDebugLines([]);

    if (!isAuthenticated || !deploymentId) return;

    try {
      const token = await getAccessTokenSilently();
      const url = `${API_URL}/api/deployments/${deploymentId}/whatsapp/qr`
        + `?token=${encodeURIComponent(token)}`;

      const es = new EventSource(url);
      esRef.current = es;

      es.addEventListener("qr", (e) => {
        try {
          const data = JSON.parse(e.data);
          // Replace with complete QR block (server buffers lines and sends as one event)
          setQrData(data.qr);
          setIsConnecting(false);
        } catch {}
      });

      es.addEventListener("connected", () => {
        setConnected(true);
        setQrData(null);
        setIsConnecting(false);
        closeStream();
      });

      es.addEventListener("timeout", () => {
        setTimedOut(true);
        setIsConnecting(false);
        closeStream();
      });

      es.addEventListener("error", (e) => {
        // SSE spec fires "error" on disconnect too
        if (esRef.current?.readyState === EventSource.CLOSED) {
          return;
        }
        try {
          const data = JSON.parse((e as MessageEvent).data);
          setError(data.message || "Connection error");
        } catch {
          setError("Connection lost");
        }
        setIsConnecting(false);
        closeStream();
      });

      es.addEventListener("log", (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.line) {
            setDebugLines((prev) => [...prev.slice(-50), data.line]);
          }
        } catch {}
      });

      // Generic error handler (connection failures)
      es.onerror = () => {
        if (!esRef.current || esRef.current.readyState === EventSource.CLOSED) {
          return;
        }
        // EventSource will auto-reconnect, but for our use case we just stop
        setError("Connection to server lost");
        setIsConnecting(false);
        closeStream();
      };
    } catch {
      // Only update state if still mounted (prevents React warnings)
      if (mountedRef.current) {
        setError("Failed to authenticate");
        setIsConnecting(false);
      }
    }
  }, [deploymentId, isAuthenticated, getAccessTokenSilently, closeStream]);

  const reset = useCallback(() => {
    closeStream();
    setQrData(null);
    setConnected(false);
    setTimedOut(false);
    setError(null);
    setIsConnecting(false);
    setDebugLines([]);
  }, [closeStream]);

  // Clean up on unmount
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeStream();
    };
  }, [closeStream]);

  return {
    qrData,
    connected,
    timedOut,
    isConnecting,
    error,
    debugLines,
    start,
    reset,
  };
}
