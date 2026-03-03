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
  } = config;

  const readyRef = useRef(false);
  const [stopped, setStopped] = useState(false);
  const lastHeartbeatRef = useRef<number>(Date.now());

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
      }

      if (e.data?.type === "jarble:storage-request") {
        handleStorageRequest(e.data.request, e.source);
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

      if (e.data?.type === "jarble:resize-request" && cardId && canvasDispatch) {
        const { width, height } = e.data;
        if (typeof width === "number" || typeof height === "number") {
          canvasDispatch({
            type: "RESIZE_CARD",
            id: cardId,
            size: {
              width: typeof width === "number" ? Math.max(200, Math.min(1200, width)) : 0,
              height: typeof height === "number" ? Math.max(100, Math.min(800, height)) : 0,
            },
          });
        }
      }

      if (e.data?.type === "jarble:set-title" && cardId) {
        const newTitle = String(e.data.title || "").slice(0, 100);
        if (newTitle) {
          isDev && console.log(`${logPrefix} Title update requested:`, newTitle);
        }
      }
    },
    [props, dispatch, title, componentName, errorPayloadExtra, logPrefix, iframeRef, handleStorageRequest, cardId, canvasDispatch],
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
    const checkInterval = setInterval(() => {
      if (!readyRef.current) return;
      const elapsed = Date.now() - lastHeartbeatRef.current;
      if (elapsed > HEARTBEAT_TIMEOUT_MS) {
        isDev && console.warn(`${logPrefix} Heartbeat timeout (${elapsed}ms silence), killing sandbox`);
        dispatch({
          action: "sandbox_error",
          payload: {
            error: { message: `Sandbox execution timeout (${Math.round(HEARTBEAT_TIMEOUT_MS / 1000)}s without heartbeat)`, source: "", line: 0, column: 0, stack: "" },
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
