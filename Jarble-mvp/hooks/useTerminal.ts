"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";

interface UseTerminalOptions {
  deploymentId: string;
  onOutput: (data: string) => void;
  onConnected?: (podName: string) => void;
  onDisconnected?: () => void;
  onError?: (message: string) => void;
}

interface UseTerminalReturn {
  connect: () => Promise<void>;
  disconnect: () => void;
  sendInput: (data: string) => void;
  isConnected: boolean;
  isConnecting: boolean;
  error: string | null;
}

export function useTerminal({
  deploymentId,
  onOutput,
  onConnected,
  onDisconnected,
  onError,
}: UseTerminalOptions): UseTerminalReturn {
  const { getAccessTokenSilently } = useAuth0();
  const wsRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Keep callbacks in refs to avoid reconnects on callback changes
  const onOutputRef = useRef(onOutput);
  onOutputRef.current = onOutput;
  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setIsConnecting(false);
  }, []);

  const connect = useCallback(async () => {
    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    setIsConnecting(true);
    setError(null);

    try {
      const token = await getAccessTokenSilently();
      const wsUrl = API_URL.replace(/^http/, "ws");
      const url = `${wsUrl}/ws/terminal?token=${encodeURIComponent(token)}&deploymentId=${encodeURIComponent(deploymentId)}`;

      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        // Wait for "connected" message from server before marking as connected
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          switch (msg.type) {
            case "connected":
              setIsConnected(true);
              setIsConnecting(false);
              setError(null);
              onConnectedRef.current?.(msg.podName);
              break;
            case "output":
              if (msg.data) onOutputRef.current(msg.data);
              break;
            case "error":
              setError(msg.message);
              onErrorRef.current?.(msg.message);
              break;
            case "exit":
              setIsConnected(false);
              setIsConnecting(false);
              onDisconnectedRef.current?.();
              break;
            case "pong":
              break;
          }
        } catch {
          // Ignore malformed messages
        }
      };

      ws.onerror = () => {
        setError("Connection failed");
        setIsConnected(false);
        setIsConnecting(false);
      };

      ws.onclose = () => {
        setIsConnected(false);
        setIsConnecting(false);
        wsRef.current = null;
        onDisconnectedRef.current?.();
      };
    } catch {
      setError("Failed to get auth token");
      setIsConnecting(false);
    }
  }, [deploymentId, getAccessTokenSilently]);

  const sendInput = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: "input", data }));
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, []);

  return { connect, disconnect, sendInput, isConnected, isConnecting, error };
}
