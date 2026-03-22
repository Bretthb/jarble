"use client";

/**
 * React hook for sandbox iframe communication.
 *
 * Manages:
 * - postMessage listener setup/teardown
 * - Message handling (ready, action, error, CSP violation, bridge-ready)
 * - Heartbeat-based watchdog (kills sandbox after HEARTBEAT_TIMEOUT_MS of silence)
 * - Storage proxy (scoped localStorage per card, 1MB quota)
 * - Inter-sandbox event relay (pub/sub channels)
 * - Canvas resize/title control from sandbox
 * - Props forwarding to iframe
 * - Lifecycle state (ready, stopped)
 */

import { useEffect, useRef, useCallback, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import type { SandboxErrorInfo, StorageRequest } from "./types";
import { HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS, SANDBOX_STORAGE_QUOTA } from "./types";
import type { CanvasAction as CanvasReducerAction } from "@/components/workspace/types";

const isDev = process.env.NODE_ENV === "development";

/** Scoped localStorage key prefix for sandbox storage. */
const STORAGE_KEY_PREFIX = "jarble:sandbox:";

/** Module-level event subscriber map: channel -> Set of iframe windows. */
const eventSubscribers = new Map<string, Set<Window>>();

interface SandboxBridgeConfig {
  /** The iframe element (or null if stopped/unmounted). */
  iframeRef: React.RefObject<HTMLIFrameElement | null>;
  /** Props to send to the sandbox. */
  props: Record<string, unknown> | undefined;
  /** Title for error reporting. */
  title: string | undefined;
  /** Component name for error payloads (e.g. "sandbox" or "marketplace_sandbox"). */
  componentName: string;
  /** Dispatch action to parent. */
  dispatch: (action: { action: string; payload: Record<string, unknown> }) => void;
  /** Extra payload fields for error actions. */
  errorPayloadExtra?: Record<string, unknown>;
  /** Log prefix for dev messages. */
  logPrefix?: string;
  /** Card ID for scoped storage and event relay. */
  cardId?: string;
  /** Canvas dispatch for resize/title updates from sandbox. */
  canvasDispatch?: React.Dispatch<CanvasReducerAction>;
  /** Deployment ID for bridge data fetch (jarble.fetch()). */
  deploymentId?: string;
  /** Auth token for bridge data fetch. */
  authToken?: string;
}

interface SandboxBridgeState {
  /** Whether the sandbox iframe is stopped. */
  stopped: boolean;
  /** Toggle stop/restart. */
  handleStop: () => void;
  /** Reset ready state (e.g. when content changes). */
  resetReady: () => void;
  /** Whether the iframe has signaled ready. */
  isReady: boolean;
}

export function useSandboxBridge(config: SandboxBridgeConfig): SandboxBridgeState {
  const {
    iframeRef,
    props,
    title,
    componentName,
    dispatch,
    errorPayloadExtra,
    logPrefix = "[Jarble:Sandbox]",
    cardId,
    canvasDispatch,
    deploymentId,
    authToken,
  } = config;

  const readyRef = useRef(false);
  const [stopped, setStopped] = useState(false);
  const lastHeartbeatRef = useRef<number>(Date.now());
  const activeStreamSources = useRef<Record<string, EventSource>>({});

  // ── Storage proxy ─────────────────────────────────────────────────────────

  const handleStorageRequest = useCallback(
    (request: StorageRequest, source: MessageEventSource | null) => {
      if (!cardId || !source) return;

      const scopedKey = `${STORAGE_KEY_PREFIX}${cardId}:${request.key}`;

      try {
        if (request.op === "get") {
          const value = localStorage.getItem(scopedKey);
          (source as Window).postMessage(
            { type: "jarble:storage-response", response: { id: request.id, ok: true, value } },
            "*",
          );
        } else if (request.op === "set") {
          const prefix = `${STORAGE_KEY_PREFIX}${cardId}:`;
          let totalSize = 0;
          for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) {
              totalSize += (localStorage.getItem(k) || "").length;
            }
          }
          const newValueSize = (request.value || "").length;
          const existingSize = (localStorage.getItem(scopedKey) || "").length;
          if (totalSize - existingSize + newValueSize > SANDBOX_STORAGE_QUOTA) {
            (source as Window).postMessage(
              { type: "jarble:storage-response", response: { id: request.id, ok: false, error: "Storage quota exceeded (1MB)" } },
              "*",
            );
            return;
          }
          localStorage.setItem(scopedKey, request.value || "");
          (source as Window).postMessage(
            { type: "jarble:storage-response", response: { id: request.id, ok: true } },
            "*",
          );
        } else if (request.op === "delete") {
          localStorage.removeItem(scopedKey);
          (source as Window).postMessage(
            { type: "jarble:storage-response", response: { id: request.id, ok: true } },
            "*",
          );
        }
      } catch (err) {
        (source as Window).postMessage(
          { type: "jarble:storage-response", response: { id: request.id, ok: false, error: String(err) } },
          "*",
        );
      }
    },
    [cardId],
  );

  const handleMessage = useCallback(
    (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;

      if (e.data?.type === "jarble:ready") {
        isDev && console.log(`${logPrefix} iframe ready, sending initial props`);
        readyRef.current = true;
        lastHeartbeatRef.current = Date.now();
        if (props) {
          iframeRef.current?.contentWindow?.postMessage({ type: "jarble:props", props }, "*");
        }
      }

      if (e.data?.type === "jarble:heartbeat") {
        lastHeartbeatRef.current = Date.now();
      }

      if (e.data?.type === "jarble:progress") {
        lastHeartbeatRef.current = Date.now();
        isDev && console.log(`${logPrefix} Progress:`, e.data.percent, "%");
      }

      if (e.data?.type === "jarble:action") {
        isDev && console.log(`${logPrefix} Action received:`, e.data.action, e.data.payload);
        dispatch({
          action: String(e.data.action || "sandbox_action"),
          payload: (e.data.payload && typeof e.data.payload === "object") ? e.data.payload : {},
        });
      }

      if (e.data?.type === "jarble:error") {
        const rawError = e.data.error;
        const errorInfo: SandboxErrorInfo = (rawError && typeof rawError === "object" && rawError.message)
          ? rawError
          : { message: rawError ? String(rawError) : "Unknown sandbox error", source: "", line: 0, column: 0, stack: "" };
        console.error(`${logPrefix} Error from iframe:`, errorInfo.message);
        dispatch({
          action: "sandbox_error",
          payload: { error: errorInfo, component: componentName, title: title || "Sandbox", ...errorPayloadExtra },
        });
      }

      if (e.data?.type === "jarble:csp-violation") {
        const detail = e.data.detail;
        console.warn(`${logPrefix} CSP violation: ${detail.violatedDirective} blocked ${detail.blockedURI}`, detail);
        Sentry.addBreadcrumb({ category: "csp-violation", message: `${detail.violatedDirective} blocked ${detail.blockedURI}`, level: "warning", data: detail });
        // Track on the card so debug tools can access it
        if (canvasDispatch && cardId) {
          canvasDispatch({
            type: "RECORD_CSP_VIOLATION",
            id: cardId,
            violation: { blockedURI: detail.blockedURI || "", violatedDirective: detail.violatedDirective || "" },
          });
        }
      }

      if (e.data?.type === "jarble:storage-request") {
        handleStorageRequest(e.data.request, e.source);
      }

      // ── Bot ask relay ─────────────────────────────────────────────────────
      if (e.data?.type === "jarble:ask" && e.data.request) {
        const askReq = e.data.request;
        const askSource = e.source as Window | null;
        if (!askSource || !deploymentId) {
          askSource?.postMessage(
            { type: "jarble:ask-response", response: { id: askReq.id, ok: false, error: "Bridge not configured" } },
            "*",
          );
          return;
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
        fetch(`${apiUrl}/api/deployments/${deploymentId}/bridge/ask`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ question: askReq.question, cardId }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.error) {
              askSource.postMessage(
                { type: "jarble:ask-response", response: { id: askReq.id, ok: false, error: data.error } },
                "*",
              );
            } else {
              askSource.postMessage(
                { type: "jarble:ask-response", response: { id: askReq.id, ok: true, answer: data.answer } },
                "*",
              );
            }
          })
          .catch((err) => {
            askSource.postMessage(
              { type: "jarble:ask-response", response: { id: askReq.id, ok: false, error: String(err) } },
              "*",
            );
          });
      }

      // ── Bridge data fetch relay ──────────────────────────────────────────
      if (e.data?.type === "jarble:fetch" && e.data.request) {
        const fetchReq = e.data.request;
        const source = e.source as Window | null;
        if (!source || !deploymentId) {
          source?.postMessage(
            { type: "jarble:fetch-response", response: { id: fetchReq.id, ok: false, error: "Bridge not configured" } },
            "*",
          );
          return;
        }

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
        fetch(`${apiUrl}/api/deployments/${deploymentId}/bridge/fetch`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
          },
          body: JSON.stringify({ tool: fetchReq.tool, payload: fetchReq.payload }),
        })
          .then((res) => res.json())
          .then((data) => {
            if (data.error) {
              source.postMessage(
                { type: "jarble:fetch-response", response: { id: fetchReq.id, ok: false, error: data.error } },
                "*",
              );
            } else {
              source.postMessage(
                { type: "jarble:fetch-response", response: { id: fetchReq.id, ok: true, data: data.result } },
                "*",
              );
            }
          })
          .catch((err) => {
            source.postMessage(
              { type: "jarble:fetch-response", response: { id: fetchReq.id, ok: false, error: String(err) } },
              "*",
            );
          });
      }

      // ── Stream subscription relay ─────────────────────────────────────
      if (e.data?.type === "jarble:stream-subscribe" && e.data.request) {
        const streamReq = e.data.request;
        const streamSource = e.source as Window | null;
        if (!streamSource || !deploymentId) return;

        const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";
        const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : "";
        const sseUrl = `${apiUrl}/api/services/stream/${streamReq.channel}?deploymentId=${deploymentId}${tokenParam}`;

        try {
          const eventSource = new EventSource(sseUrl);

          // Store for cleanup
          if (!activeStreamSources.current[streamReq.id]) {
            activeStreamSources.current[streamReq.id] = eventSource;
          }

          eventSource.addEventListener("mutation", (event) => {
            try {
              const data = JSON.parse(event.data);
              streamSource.postMessage(
                { type: "jarble:stream-event", streamId: streamReq.id, data },
                "*",
              );
            } catch { /* malformed event data */ }
          });

          eventSource.addEventListener("connected", (event) => {
            try {
              const data = JSON.parse(event.data);
              streamSource.postMessage(
                { type: "jarble:stream-event", streamId: streamReq.id, data: { type: "connected", ...data } },
                "*",
              );
            } catch { /* malformed event data */ }
          });

          eventSource.onerror = () => {
            streamSource.postMessage(
              { type: "jarble:stream-error", streamId: streamReq.id, error: "Stream connection error" },
              "*",
            );
          };
        } catch (err) {
          streamSource.postMessage(
            { type: "jarble:stream-error", streamId: streamReq.id, error: String(err) },
            "*",
          );
        }
      }

      if (e.data?.type === "jarble:stream-unsubscribe" && e.data.request) {
        const streamId = e.data.request.id;
        const es = activeStreamSources.current[streamId];
        if (es) {
          es.close();
          delete activeStreamSources.current[streamId];
        }
      }

      if (e.data?.type === "jarble:event-emit") {
        const channel = e.data.channel;
        const data = e.data.data;
        const subs = eventSubscribers.get(channel);
        if (subs) {
          for (const win of subs) {
            if (win !== e.source) {
              try { win.postMessage({ type: "jarble:event", channel, data }, "*"); }
              catch { subs.delete(win); }
            }
          }
        }
      }

      if (e.data?.type === "jarble:resize-request" && cardId) {
        const { width, height } = e.data;
        if (typeof width === "number" || typeof height === "number") {
          const clampedW = typeof width === "number" ? Math.max(200, Math.min(1200, width)) : 0;
          const clampedH = typeof height === "number" ? Math.max(100, Math.min(800, height)) : 0;

          if (canvasDispatch && (clampedW > 0 || clampedH > 0)) {
            canvasDispatch({
              type: "RESIZE_CARD",
              id: cardId,
              size: { width: clampedW || 320, height: clampedH || 220 },
            });
          }
        }
      }

      if (e.data?.type === "jarble:set-title" && cardId) {
        const newTitle = String(e.data.title || "").slice(0, 100);
        if (newTitle && canvasDispatch) {
          isDev && console.log(`${logPrefix} Title update:`, newTitle);
          canvasDispatch({ type: "RENAME_CARD", id: cardId, title: newTitle });
        }
      }
    },
    [props, dispatch, title, componentName, errorPayloadExtra, logPrefix, iframeRef, handleStorageRequest, cardId, canvasDispatch, deploymentId, authToken],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  useEffect(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win || !cardId) return;
    const channelName = `__sandbox_${cardId}`;
    if (!eventSubscribers.has(channelName)) eventSubscribers.set(channelName, new Set());
    eventSubscribers.get(channelName)!.add(win);
    return () => {
      const subs = eventSubscribers.get(channelName);
      if (subs) { subs.delete(win); if (subs.size === 0) eventSubscribers.delete(channelName); }
    };
  }, [iframeRef, cardId, stopped]);

  // ── Heartbeat watchdog ──────────────────────────────────────────────────────

  useEffect(() => {
    if (stopped) return;
    // Use a longer timeout during loading (before ready) since libraries like
    // Three.js can take 30-60s to download and parse. The iframe sends heartbeats
    // during this phase, but if it crashes before ready, we still need to catch it.
    const LOADING_TIMEOUT_MS = 90_000; // 90s for library loading phase
    const checkInterval = setInterval(() => {
      const elapsed = Date.now() - lastHeartbeatRef.current;
      const timeout = readyRef.current ? HEARTBEAT_TIMEOUT_MS : LOADING_TIMEOUT_MS;
      if (elapsed > timeout) {
        const phase = readyRef.current ? "running" : "loading";
        isDev && console.warn(`${logPrefix} Heartbeat timeout (${elapsed}ms silence during ${phase}), killing sandbox`);
        dispatch({
          action: "sandbox_error",
          payload: {
            error: { message: `Sandbox ${phase} timeout (${Math.round(timeout / 1000)}s without heartbeat)`, source: "", line: 0, column: 0, stack: "" },
            component: componentName,
            title: title || "Sandbox",
            ...errorPayloadExtra,
          },
        });
        setStopped(true);
        readyRef.current = false;
      }
    }, HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(checkInterval);
  }, [stopped, dispatch, componentName, title, errorPayloadExtra, logPrefix]);

  useEffect(() => {
    if (readyRef.current && iframeRef.current?.contentWindow && props) {
      iframeRef.current.contentWindow.postMessage({ type: "jarble:props", props }, "*");
    }
  }, [props, iframeRef]);

  const handleStop = useCallback(() => {
    if (stopped) {
      setStopped(false);
      lastHeartbeatRef.current = Date.now();
      isDev && console.log(`${logPrefix} Restarted`);
    } else {
      setStopped(true);
      readyRef.current = false;
      // Close all active stream subscriptions
      for (const es of Object.values(activeStreamSources.current)) {
        try { es.close(); } catch { /* ignore */ }
      }
      activeStreamSources.current = {};
      isDev && console.log(`${logPrefix} Stopped — iframe destroyed`);
    }
  }, [stopped, logPrefix]);

  const resetReady = useCallback(() => {
    isDev && console.log(`${logPrefix} Content changed, resetting ready state`);
    readyRef.current = false;
    lastHeartbeatRef.current = Date.now();
  }, [logPrefix]);

  return { stopped, handleStop, resetReady, isReady: readyRef.current };
}
