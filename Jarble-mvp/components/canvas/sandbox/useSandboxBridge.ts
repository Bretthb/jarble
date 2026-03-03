"use client";

/**
 * React hook for sandbox iframe communication.
 *
 * Manages:
 * - postMessage listener setup/teardown
 * - Message handling (ready, action, error, CSP violation, bridge-ready)
 * - Props forwarding to iframe
 * - Lifecycle state (ready, stopped)
 */

import { useEffect, useRef, useCallback, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import type { SandboxErrorInfo } from "./types";

const isDev = process.env.NODE_ENV === "development";

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

/**
 * Hook that manages postMessage communication with a sandbox iframe.
 *
 * Listens for jarble:ready, jarble:action, jarble:error, and jarble:csp-violation
 * messages from the iframe. Sends jarble:props messages when props change.
 */
export function useSandboxBridge(config: SandboxBridgeConfig): SandboxBridgeState {
  const {
    iframeRef,
    props,
    title,
    componentName,
    dispatch,
    errorPayloadExtra,
    logPrefix = "[Jarble:Sandbox]",
  } = config;

  const readyRef = useRef(false);
  const [stopped, setStopped] = useState(false);

  // Listen for messages from iframe
  const handleMessage = useCallback(
    (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;

      if (e.data?.type === "jarble:ready") {
        isDev && console.log(`${logPrefix} iframe ready, sending initial props`);
        readyRef.current = true;
        if (props) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: "jarble:props", props },
            "*",
          );
        }
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
        // Normalize error — sometimes structured clone produces empty objects
        const errorInfo: SandboxErrorInfo = (rawError && typeof rawError === "object" && rawError.message)
          ? rawError
          : { message: rawError ? String(rawError) : "Unknown sandbox error", source: "", line: 0, column: 0, stack: "" };
        console.error(`${logPrefix} Error from iframe:`, errorInfo.message);
        dispatch({
          action: "sandbox_error",
          payload: {
            error: errorInfo,
            component: componentName,
            title: title || "Sandbox",
            ...errorPayloadExtra,
          },
        });
      }

      if (e.data?.type === "jarble:csp-violation") {
        const detail = e.data.detail;
        console.warn(
          `${logPrefix} CSP violation: ${detail.violatedDirective} blocked ${detail.blockedURI}`,
          detail,
        );
        Sentry.addBreadcrumb({
          category: "csp-violation",
          message: `${detail.violatedDirective} blocked ${detail.blockedURI}`,
          level: "warning",
          data: detail,
        });
      }
    },
    [props, dispatch, title, componentName, errorPayloadExtra, logPrefix, iframeRef],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Send updated props when they change
  useEffect(() => {
    if (readyRef.current && iframeRef.current?.contentWindow && props) {
      iframeRef.current.contentWindow.postMessage(
        { type: "jarble:props", props },
        "*",
      );
    }
  }, [props, iframeRef]);

  const handleStop = useCallback(() => {
    if (stopped) {
      setStopped(false);
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
  }, [logPrefix]);

  return {
    stopped,
    handleStop,
    resetReady,
    isReady: readyRef.current,
  };
}
