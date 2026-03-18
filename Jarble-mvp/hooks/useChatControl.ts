"use client";

/**
 * useChatControl — WebSocket control channel for chat operations.
 *
 * Connects to the backend's /ws/chat endpoint for:
 * - Stop generation (abort active SSE stream server-side)
 * - Typing indicators
 * - Keep-alive ping/pong
 *
 * Falls back gracefully if WS is unavailable (backend feature-gated).
 * Reconnects with exponential backoff (1s, 2s, 4s, max 30s).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { API_URL } from "@/lib/trpc";

const isDev = process.env.NODE_ENV === "development";

/** Convert HTTP API URL to WebSocket URL */
function getWsUrl(): string {
  const base = API_URL.replace(/^http/, "ws");
  return `${base}/ws/chat`;
}

const MIN_RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;

export function useChatControl(
  deploymentId: string,
  getToken: () => Promise<string>,
) {
  const [isConnected, setIsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectDelayRef = useRef(MIN_RECONNECT_MS);
  const mountedRef = useRef(true);
  const deploymentIdRef = useRef(deploymentId);
  deploymentIdRef.current = deploymentId;

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
      if (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING) {
        wsRef.current.close();
      }
      wsRef.current = null;
    }
    setIsConnected(false);
  }, []);

  const connect = useCallback(async () => {
    if (!mountedRef.current) return;
    cleanup();

    let token: string;
    try {
      token = await getToken();
    } catch {
      isDev && console.log("[Jarble:ChatControl] Failed to get token, will retry");
      scheduleReconnect();
      return;
    }

    const wsUrl = `${getWsUrl()}?token=${encodeURIComponent(token)}&deploymentId=${encodeURIComponent(deploymentIdRef.current)}`;
    isDev && console.log("[Jarble:ChatControl] Connecting to", getWsUrl());

    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      isDev && console.log("[Jarble:ChatControl] Connected");
      setIsConnected(true);
      reconnectDelayRef.current = MIN_RECONNECT_MS; // Reset backoff on success
    };

    ws.onclose = (event) => {
      isDev && console.log(`[Jarble:ChatControl] Disconnected (code=${event.code})`);
      setIsConnected(false);
      wsRef.current = null;
      // Don't reconnect if this was a clean close (1000) or auth failure (4001)
      if (event.code !== 1000 && event.code !== 4001 && mountedRef.current) {
        scheduleReconnect();
      }
    };

    ws.onerror = () => {
      // Error is followed by close, so reconnect will happen in onclose
      isDev && console.log("[Jarble:ChatControl] WS error");
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === "pong") {
          isDev && console.log("[Jarble:ChatControl] Pong received");
        } else if (msg.type === "stopped") {
          isDev && console.log("[Jarble:ChatControl] Generation stopped:", msg.message);
        }
        // Other messages are informational — no action needed
      } catch {
        // Ignore malformed messages
      }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    function scheduleReconnect() {
      if (!mountedRef.current) return;
      const delay = reconnectDelayRef.current;
      isDev && console.log(`[Jarble:ChatControl] Reconnecting in ${delay}ms`);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectDelayRef.current = Math.min(delay * 2, MAX_RECONNECT_MS);
        connect();
      }, delay);
    }
  }, [getToken, cleanup]);

  // Connect on mount
  useEffect(() => {
    mountedRef.current = true;
    connect();
    return () => {
      mountedRef.current = false;
      cleanup();
    };
  }, [connect, cleanup]);

  // Reconnect if deploymentId changes
  useEffect(() => {
    if (mountedRef.current && wsRef.current) {
      connect();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deploymentId]);

  const stopGeneration = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "stop" }));
      return true;
    }
    return false; // Caller should fall back to AbortController
  }, []);

  const sendTyping = useCallback((isTyping: boolean) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "typing", isTyping }));
    }
  }, []);

  return { stopGeneration, sendTyping, isConnected };
}
