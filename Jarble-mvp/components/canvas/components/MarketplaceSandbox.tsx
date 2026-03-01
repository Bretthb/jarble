"use client";

import { memo, useEffect, useRef, useCallback, useState } from "react";
import { useCanvasAction } from "../CanvasActionContext";
import { sanitizeHtml } from "@/lib/sanitize";

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
  /** Marketplace component ID — triggers double-iframe mode */
  marketplaceId?: string;
}

/** Escape a string for safe use inside an HTML attribute (double-quoted). */
function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Sanitize the html prop: extract inline <script> content into JS,
 * extract <script src> URLs into libraries, strip structural tags.
 * LLMs often dump full HTML documents into the html prop — this normalizes them.
 */
function sanitizeHtmlProp(
  html: string,
  existingJs: string | undefined,
  existingLibs: string[] | undefined,
): { html: string; js: string; libraries: string[] } {
  let cleanHtml = html;
  const extractedJs: string[] = [];
  const extractedLibs: string[] = [...(existingLibs || [])];

  // Extract <script src="..."> tags -> libraries
  cleanHtml = cleanHtml.replace(
    /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (_match, url) => {
      isDev &&
        console.log(
          "[Jarble:MarketplaceSandbox] Extracted <script src> from html ->",
          url,
        );
      if (!extractedLibs.includes(url)) extractedLibs.push(url);
      return "";
    },
  );

  // Extract inline <script>...</script> -> js
  cleanHtml = cleanHtml.replace(
    /<script[^>]*>([\s\S]*?)<\/script>/gi,
    (_match, code) => {
      const trimmed = (code as string).trim();
      if (trimmed) {
        isDev &&
          console.log(
            "[Jarble:MarketplaceSandbox] Extracted inline <script> from html ->",
            trimmed.length,
            "chars",
          );
        extractedJs.push(trimmed);
      }
      return "";
    },
  );

  // Extract <style>...</style> (handled by css prop but sometimes in html)
  cleanHtml = cleanHtml.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, "");

  // Strip structural tags
  cleanHtml = cleanHtml
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<\/?head[^>]*>/gi, "")
    .replace(/<\/?body[^>]*>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .trim();

  // Combine JS: existing js prop takes priority, extracted JS appended
  const allJs = [existingJs, ...extractedJs].filter(Boolean).join("\n");

  if (
    extractedJs.length > 0 ||
    extractedLibs.length > (existingLibs?.length || 0)
  ) {
    isDev &&
      console.log(
        "[Jarble:MarketplaceSandbox] Sanitized html prop — extracted",
        extractedJs.length,
        "script blocks,",
        extractedLibs.length - (existingLibs?.length || 0),
        "library URLs",
      );
  }

  // Additional XSS sanitization via DOMPurify
  cleanHtml = sanitizeHtml(cleanHtml);

  return { html: cleanHtml, js: allJs, libraries: extractedLibs };
}

/**
 * Build the inner iframe's HTML document.
 *
 * This is the same format as CanvasSandbox's buildDocument() — it has
 * the error handler, props bridge, library loader, user JS execution.
 * The inner iframe runs inside the outer iframe's sandbox, giving it
 * an opaque origin with NO access to the parent page.
 */
function buildInnerDocument(
  html: string,
  css: string | undefined,
  js: string | undefined,
  libraries: string[] | undefined,
): string {
  // Sanitize and JSON-encode library URLs for dynamic loading
  const safeLibs = (libraries || []).filter((url) => /^https?:\/\//.test(url));
  const libsJson = JSON.stringify(safeLibs);

  const TRUSTED_CDN_ORIGINS = [
    "https://cdn.jsdelivr.net",
    "https://cdnjs.cloudflare.com",
    "https://unpkg.com",
    "https://cdn.tailwindcss.com",
    "https://esm.sh",
    "https://threejs.org",
    "https://d3js.org",
    "https://cdn.plot.ly",
    "https://fonts.googleapis.com",
    "https://fonts.gstatic.com",
  ];
  const cdnOrigins = TRUSTED_CDN_ORIGINS.join(" ");
  const csp = [
    `default-src 'none'`,
    `script-src 'unsafe-inline' 'unsafe-eval' ${cdnOrigins}`,
    `style-src 'unsafe-inline' ${cdnOrigins}`,
    `img-src ${cdnOrigins} data: blob:`,
    `font-src ${cdnOrigins} data:`,
    `media-src ${cdnOrigins} data: blob:`,
    `connect-src ${cdnOrigins}`,
    `worker-src blob:`,
    `frame-src 'none'`,
  ].join("; ");

  const themeCSS = `
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
    canvas { display: block; width: 100% !important; height: 100% !important; }
  `;

  const escapedJs = js || "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">
<style>${themeCSS}\n${css || ""}</style>
</head>
<body>
${html}
<script>
// Error overlay — show errors visually AND report to parent (outer iframe bridge)
window.onerror = function(msg, src, line, col, err) {
  console.error("[Jarble:MarketplaceSandbox:Inner] Error:", msg, src, line, col);
  var d = document.createElement("div");
  d.style.cssText = "position:fixed;top:0;left:0;right:0;padding:8px 12px;background:#fee;color:#c00;font:12px monospace;z-index:99999;white-space:pre-wrap;border-bottom:2px solid #c00";
  d.textContent = "Error: " + msg + "\\n" + (src||"") + ":" + line + ":" + col;
  document.body.prepend(d);
  // Report error to parent (outer iframe bridge will relay to main app)
  parent.postMessage({
    type: "jarble:error",
    error: {
      message: String(msg || "Unknown error"),
      source: String(src || ""),
      line: Number(line) || 0,
      column: Number(col) || 0,
      stack: (err && err.stack) ? String(err.stack) : ""
    }
  }, "*");
};
// Also catch unhandled promise rejections
window.onunhandledrejection = function(e) {
  var reason = e.reason;
  var msg = "Unhandled promise rejection";
  try { msg = reason ? (reason.message || reason.name || String(reason)) : msg; } catch(_) {}
  console.error("[Jarble:MarketplaceSandbox:Inner] Unhandled rejection:", msg);
  var d = document.createElement("div");
  d.style.cssText = "position:fixed;top:0;left:0;right:0;padding:8px 12px;background:#fee;color:#c00;font:12px monospace;z-index:99999;white-space:pre-wrap;border-bottom:2px solid #c00";
  d.textContent = "Error: " + msg;
  document.body.prepend(d);
  var stack = "";
  try { stack = (reason && reason.stack) ? String(reason.stack) : ""; } catch(_) {}
  parent.postMessage({
    type: "jarble:error",
    error: {
      message: String(msg),
      source: "",
      line: 0,
      column: 0,
      stack: stack
    }
  }, "*");
};
console.log("[Jarble:MarketplaceSandbox:Inner] iframe document loaded");
// Bridge: receive props from outer iframe bridge
window.__JARBLE_PROPS__ = {};
window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "jarble:props") {
    console.log("[Jarble:MarketplaceSandbox:Inner] Received props:", Object.keys(e.data.props || {}));
    window.__JARBLE_PROPS__ = e.data.props || {};
    window.dispatchEvent(new CustomEvent("jarble:props", { detail: e.data.props }));
  }
});
// Bridge: send callbacks to parent (outer iframe bridge will relay to main app)
window.jarble = {
  send: function(action, payload) {
    console.log("[Jarble:MarketplaceSandbox:Inner] Sending action:", action, payload);
    parent.postMessage({ type: "jarble:action", action: action, payload: payload }, "*");
  }
};
// Auto-resize: when the iframe resizes, update ALL canvas drawing buffers
window.__JARBLE_SIZE__ = { width: window.innerWidth, height: window.innerHeight };
function __jarbleAutoResize() {
  var w = window.innerWidth, h = window.innerHeight;
  var dpr = window.devicePixelRatio || 1;
  window.__JARBLE_SIZE__ = { width: w, height: h };
  document.querySelectorAll("canvas").forEach(function(c) {
    var cw = c.clientWidth, ch = c.clientHeight;
    if (cw > 0 && ch > 0) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
  });
  try {
    if (typeof renderer !== "undefined" && renderer && renderer.setSize) {
      renderer.setSize(w, h);
    }
    if (typeof camera !== "undefined" && camera && camera.aspect !== undefined) {
      camera.aspect = w / h;
      if (camera.updateProjectionMatrix) camera.updateProjectionMatrix();
    }
  } catch(e) {}
}
new ResizeObserver(function(entries) {
  if (entries[0]) {
    window.dispatchEvent(new Event("resize"));
    requestAnimationFrame(__jarbleAutoResize);
  }
}).observe(document.documentElement);
// Watchdog: report if sandbox runs longer than 30s without completing
setTimeout(function() {
  if (document.hidden) return;
  parent.postMessage({
    type: "jarble:error",
    error: { message: "Sandbox execution timeout (30s)", source: "", line: 0, column: 0, stack: "" }
  }, "*");
}, 30000);
// Dynamic library loader — guarantees scripts are fully loaded before user JS runs
(function() {
  var libs = ${libsJson};
  var loaded = 0;
  console.log("[Jarble:MarketplaceSandbox:Inner] Loading " + libs.length + " libraries:", libs);
  function onReady() {
    console.log("[Jarble:MarketplaceSandbox:Inner] All libraries loaded, executing user JS (" + ${JSON.stringify(escapedJs.length)} + " chars)");
    parent.postMessage({ type: "jarble:ready" }, "*");
    try { ${escapedJs} } catch(e) { console.error("[Jarble:MarketplaceSandbox:Inner] User JS error:", e); window.onerror(e.message, "", 0, 0, e); }
  }
  if (libs.length === 0) { console.log("[Jarble:MarketplaceSandbox:Inner] No libraries, running immediately"); return onReady(); }
  libs.forEach(function(url) {
    var s = document.createElement("script");
    s.src = url;
    s.onload = function() { console.log("[Jarble:MarketplaceSandbox:Inner] Loaded:", url); if (++loaded >= libs.length) onReady(); };
    s.onerror = function() { console.error("[Jarble:MarketplaceSandbox:Inner] FAILED to load:", url); if (++loaded >= libs.length) onReady(); };
    document.head.appendChild(s);
  });
})();
<\/script>
</body>
</html>`;
}

/**
 * Build the outer iframe's HTML document.
 *
 * The outer iframe contains:
 * 1. A strict CSP (no connect-src, no img-src — only the inner iframe needs those)
 * 2. The inner iframe element with sandbox="allow-scripts"
 * 3. A postMessage bridge that relays messages between inner iframe and main app
 *
 * The outer iframe itself runs at about:blank with sandbox="allow-scripts" —
 * it has NO same-origin access to the main app.
 */
function buildOuterDocument(): string {
  const outerCsp = [
    `default-src 'none'`,
    `script-src 'unsafe-inline'`,
    `style-src 'unsafe-inline'`,
    `frame-src blob: data:`,
  ].join("; ");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(outerCsp)}">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; overflow: hidden; background: transparent; }
  #inner { border: none; width: 100%; height: 100%; }
</style>
</head>
<body>
<iframe id="inner" sandbox="allow-scripts"></iframe>
<script>
// Bridge: relay messages between inner iframe and parent (main app)
var inner = document.getElementById("inner");
var innerReady = false;
var pendingMessages = [];

window.addEventListener("message", function(e) {
  // Message from main app -> handle or forward to inner
  if (e.source === parent) {
    if (e.data && e.data.type === "jarble:init") {
      // Set inner iframe content via srcdoc
      console.log("[Jarble:MarketplaceSandbox:Bridge] Received init, setting inner srcdoc (" + e.data.srcdoc.length + " chars)");
      inner.srcdoc = e.data.srcdoc;
      innerReady = false;
      return;
    }
    // Forward other messages (props, etc.) to inner iframe
    if (innerReady && inner.contentWindow) {
      inner.contentWindow.postMessage(e.data, "*");
    } else {
      // Queue messages until inner iframe is ready
      pendingMessages.push(e.data);
    }
    return;
  }

  // Message from inner iframe -> validate and forward to main app
  if (e.source === inner.contentWindow) {
    // Only forward known message types (whitelist)
    if (e.data && typeof e.data === "object") {
      var msgType = e.data.type;
      if (msgType === "jarble:ready" ||
          msgType === "jarble:action" ||
          msgType === "jarble:error") {
        console.log("[Jarble:MarketplaceSandbox:Bridge] Relaying", msgType, "to main app");

        if (msgType === "jarble:ready") {
          innerReady = true;
          // Flush pending messages
          for (var i = 0; i < pendingMessages.length; i++) {
            inner.contentWindow.postMessage(pendingMessages[i], "*");
          }
          pendingMessages = [];
        }

        parent.postMessage(e.data, "*");
      }
    }
    return;
  }
});

console.log("[Jarble:MarketplaceSandbox:Bridge] Outer iframe bridge initialized");
// Signal to main app that the bridge is ready
parent.postMessage({ type: "jarble:bridge-ready" }, "*");
<\/script>
</body>
</html>`;
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

  // Sanitize: extract any <script>/<style>/structural tags from html prop
  const sanitized = sanitizeHtmlProp(html, js, libraries);

  // Build the inner document (component content)
  const innerSrcdoc = buildInnerDocument(
    sanitized.html,
    css,
    sanitized.js,
    sanitized.libraries,
  );

  // Build the outer document (bridge)
  const outerSrcdoc = buildOuterDocument();

  isDev &&
    console.log(
      "[Jarble:MarketplaceSandbox] Render — html:",
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
        // Normalize error — sometimes structured clone produces empty objects
        const errorInfo =
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
        // Dispatch error as a special action so it can be forwarded to the bot
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
    // NO allow-same-origin — outer iframe gets opaque origin
    // NO allow-popups — marketplace components should not open popups
    outerIframe.style.cssText =
      "flex:1;width:100%;min-height:0;border:none;border-radius:8px;background:transparent";
    outerIframe.allow = "autoplay; fullscreen";
    outerIframe.title = title || "Marketplace Sandbox";

    // Append to DOM first, then write content
    container.appendChild(outerIframe);
    outerIframeRef.current = outerIframe;

    // Use srcdoc to set the outer iframe content
    // This is safer than document.write and works with sandbox attribute
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
      // Restart — un-stop so the outer iframe re-creates
      setStopped(false);
      isDev && console.log("[Jarble:MarketplaceSandbox] Restarted");
    } else {
      // Stop — destroy the outer iframe to kill all JS execution
      setStopped(true);
      readyRef.current = false;
      bridgeReadyRef.current = false;
      isDev &&
        console.log(
          "[Jarble:MarketplaceSandbox] Stopped — outer iframe destroyed",
        );
    }
  }, [stopped]);

  const displayName = title || marketplaceId || "Marketplace";

  // Fill the parent container - card already provides border/padding
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        minHeight: 0,
        position: "relative",
      }}
    >
      {/* Minimal control bar - stop/restart button */}
      <div
        style={{
          display: "flex",
          justifyContent: "flex-end",
          flexShrink: 0,
          marginBottom: 4,
        }}
      >
        <button
          onClick={handleStop}
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50"
        >
          {stopped ? (
            <>
              <svg
                width="10"
                height="10"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M3 2L10 6L3 10V2Z" fill="currentColor" />
              </svg>
              Restart
            </>
          ) : (
            <>
              <svg
                width="10"
                height="10"
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <rect
                  x="2"
                  y="2"
                  width="8"
                  height="8"
                  rx="1"
                  fill="currentColor"
                />
              </svg>
              Stop
            </>
          )}
        </button>
      </div>

      {stopped ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            minHeight: 0,
          }}
          className="rounded-lg bg-muted/30 text-muted-foreground text-sm"
        >
          Sandbox stopped — click Restart to resume
        </div>
      ) : (
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
                ×
              </button>
            </div>
          )}
          {/* Outer iframe is created programmatically in useEffect */}
        </div>
      )}
    </div>
  );
}

export default memo(MarketplaceSandboxInner);
