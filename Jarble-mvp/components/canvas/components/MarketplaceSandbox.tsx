"use client";

import { memo, useEffect, useRef, useCallback, useState } from "react";
import { useCanvasAction } from "../CanvasActionContext";
import { sanitizeHtmlProp, buildDocument, buildOuterDocument } from "../sandbox/sandboxCore";
import { SandboxShell } from "../sandbox/SandboxControls";
import type { SandboxErrorInfo } from "../sandbox/types";
import { useSandboxTheme } from "../SandboxThemeContext";

const isDev = process.env.NODE_ENV === "development";

export interface MarketplaceSandboxProps {
  html: string;
  css?: string;
  js?: string;
  props?: Record<string, unknown>;
  height?: number;
  title?: string;
  /** CDN libraries to load (e.g. ["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"]) */
  libraries?: string[];
  /** Marketplace component ID - triggers double-iframe mode */
  marketplaceId?: string;
}

function MarketplaceSandboxInner({
  html,
  css,
  js,
  props,
  title,
  libraries,
  marketplaceId,
}: MarketplaceSandboxProps) {
  // Note: height prop is ignored - sandbox fills its parent container
  const containerRef = useRef<HTMLDivElement>(null);
  const outerIframeRef = useRef<HTMLIFrameElement | null>(null);
  const bridgeReadyRef = useRef(false);
  const readyRef = useRef(false);
  const [stopped, setStopped] = useState(false);
  const [badgeDismissed, setBadgeDismissed] = useState(false);
  const { dispatch } = useCanvasAction();
  const { themeVars } = useSandboxTheme();

  // Sanitize: extract <script>/<style>/<link> tags from html prop into proper fields
  const sanitized = sanitizeHtmlProp(html, js, libraries, "[Jarble:MarketplaceSandbox]", css);

  // Build the inner document (component content) - inject parent theme vars
  const innerSrcdoc = buildDocument(
    sanitized.html,
    sanitized.css,
    sanitized.js,
    sanitized.libraries,
    { logPrefix: "[Jarble:MarketplaceSandbox:Inner]" },
    undefined,
    undefined,
    themeVars,
  );

  // Build the outer document (bridge)
  const outerSrcdoc = buildOuterDocument();

  isDev &&
    console.log(
      "[Jarble:MarketplaceSandbox] Render - html:",
      html?.length,
      "chars, css:",
      css?.length || 0,
      "chars, js:",
      js?.length || 0,
      "chars, libraries:",
      libraries,
      "marketplaceId:",
      marketplaceId,
    );

  // Listen for messages from the outer iframe (bridge)
  const handleMessage = useCallback(
    (e: MessageEvent) => {
      // Only accept messages from our outer iframe
      if (!outerIframeRef.current || e.source !== outerIframeRef.current.contentWindow) return;

      if (e.data?.type === "jarble:bridge-ready") {
        isDev &&
          console.log(
            "[Jarble:MarketplaceSandbox] Bridge ready, sending init with inner srcdoc",
          );
        bridgeReadyRef.current = true;
        // Send the inner document to the bridge
        outerIframeRef.current?.contentWindow?.postMessage(
          { type: "jarble:init", srcdoc: innerSrcdoc },
          "*",
        );
      }

      if (e.data?.type === "jarble:ready") {
        isDev &&
          console.log(
            "[Jarble:MarketplaceSandbox] Inner iframe ready (via bridge), sending initial props",
          );
        readyRef.current = true;
        if (props) {
          outerIframeRef.current?.contentWindow?.postMessage(
            { type: "jarble:props", props },
            "*",
          );
        }
      }

      if (e.data?.type === "jarble:action") {
        isDev &&
          console.log(
            "[Jarble:MarketplaceSandbox] Action received (via bridge):",
            e.data.action,
            e.data.payload,
          );
        dispatch({
          action: String(e.data.action || "sandbox_action"),
          payload:
            e.data.payload && typeof e.data.payload === "object"
              ? e.data.payload
              : {},
        });
      }

      if (e.data?.type === "jarble:error") {
        const rawError = e.data.error;
        const errorInfo: SandboxErrorInfo =
          rawError && typeof rawError === "object" && rawError.message
            ? rawError
            : {
                message: rawError
                  ? String(rawError)
                  : "Unknown sandbox error",
                source: "",
                line: 0,
                column: 0,
                stack: "",
              };
        console.error(
          "[Jarble:MarketplaceSandbox] Error from inner iframe (via bridge):",
          errorInfo.message,
        );
        dispatch({
          action: "sandbox_error",
          payload: {
            error: errorInfo,
            component: "marketplace_sandbox",
            title: title || "Marketplace Sandbox",
            marketplaceId: marketplaceId || undefined,
          },
        });
      }
    },
    [props, dispatch, title, marketplaceId, innerSrcdoc],
  );

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  // Create the outer iframe programmatically when not stopped
  useEffect(() => {
    if (stopped) return;

    const container = containerRef.current;
    if (!container) return;

    isDev &&
      console.log(
        "[Jarble:MarketplaceSandbox] Creating outer iframe (about:blank + sandbox)",
      );

    // Reset state
    bridgeReadyRef.current = false;
    readyRef.current = false;

    // Create outer iframe programmatically
    const outerIframe = document.createElement("iframe");
    outerIframe.sandbox.add("allow-scripts");
    outerIframe.style.cssText =
      "flex:1;width:100%;min-height:0;border:none;border-radius:8px;background:transparent";
    outerIframe.allow = "autoplay; fullscreen";
    outerIframe.title = title || "Marketplace Sandbox";

    // Append to DOM first, then write content
    container.appendChild(outerIframe);
    outerIframeRef.current = outerIframe;

    // Use srcdoc to set the outer iframe content
    outerIframe.srcdoc = outerSrcdoc;

    return () => {
      isDev &&
        console.log("[Jarble:MarketplaceSandbox] Destroying outer iframe");
      outerIframeRef.current = null;
      bridgeReadyRef.current = false;
      readyRef.current = false;
      if (container.contains(outerIframe)) {
        container.removeChild(outerIframe);
      }
    };
  }, [stopped, outerSrcdoc, title]);

  // When innerSrcdoc changes (content changes), re-send init to bridge
  useEffect(() => {
    if (stopped || !bridgeReadyRef.current || !outerIframeRef.current) return;

    isDev &&
      console.log(
        "[Jarble:MarketplaceSandbox] Content changed, re-sending init to bridge",
      );
    readyRef.current = false;
    outerIframeRef.current.contentWindow?.postMessage(
      { type: "jarble:init", srcdoc: innerSrcdoc },
      "*",
    );
  }, [innerSrcdoc, stopped]);

  // Send updated props when they change
  useEffect(() => {
    if (readyRef.current && outerIframeRef.current?.contentWindow && props) {
      outerIframeRef.current.contentWindow.postMessage(
        { type: "jarble:props", props },
        "*",
      );
    }
  }, [props]);

  const handleStop = useCallback(() => {
    if (stopped) {
      setStopped(false);
      isDev && console.log("[Jarble:MarketplaceSandbox] Restarted");
    } else {
      setStopped(true);
      readyRef.current = false;
      bridgeReadyRef.current = false;
      isDev &&
        console.log(
          "[Jarble:MarketplaceSandbox] Stopped - outer iframe destroyed",
        );
    }
  }, [stopped]);

  const displayName = title || marketplaceId || "Marketplace";

  return (
    <SandboxShell stopped={stopped} onToggle={handleStop}>
      <div
        ref={containerRef}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          position: "relative",
        }}
      >
        {/* Marketplace badge overlay */}
        {!badgeDismissed && (
          <div
            style={{
              position: "absolute",
              top: 6,
              right: 6,
              zIndex: 10,
              display: "flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 10,
              fontWeight: 500,
              lineHeight: "16px",
              letterSpacing: "0.02em",
              backgroundColor: "rgba(0, 0, 0, 0.55)",
              color: "rgba(255, 255, 255, 0.9)",
              backdropFilter: "blur(4px)",
              pointerEvents: "auto",
              userSelect: "none",
            }}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              style={{ flexShrink: 0 }}
            >
              <path
                d="M8 1L10 5.5L15 6.2L11.5 9.5L12.4 14.5L8 12.2L3.6 14.5L4.5 9.5L1 6.2L6 5.5L8 1Z"
                fill="currentColor"
                opacity="0.8"
              />
            </svg>
            <span>{displayName}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setBadgeDismissed(true);
              }}
              style={{
                background: "none",
                border: "none",
                color: "rgba(255, 255, 255, 0.6)",
                cursor: "pointer",
                padding: "0 0 0 2px",
                fontSize: 12,
                lineHeight: 1,
                display: "flex",
                alignItems: "center",
              }}
              aria-label="Dismiss marketplace badge"
            >
              x
            </button>
          </div>
        )}
        {/* Outer iframe is created programmatically in useEffect */}
      </div>
    </SandboxShell>
  );
}

export default memo(MarketplaceSandboxInner);
