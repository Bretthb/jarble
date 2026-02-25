"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useCanvasAction } from "../CanvasActionContext";

export interface CanvasSandboxProps {
  html: string;
  css?: string;
  js?: string;
  props?: Record<string, unknown>;
  height?: number;
  title?: string;
  /** CDN libraries to load (e.g. ["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"]) */
  libraries?: string[];
}

/** Escape a string for safe use inside an HTML attribute (double-quoted). */
function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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

  // Extract <script src="..."> tags → libraries
  cleanHtml = cleanHtml.replace(/<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi, (_match, url) => {
    console.log("[Jarble:Sandbox] Extracted <script src> from html →", url);
    if (!extractedLibs.includes(url)) extractedLibs.push(url);
    return "";
  });

  // Extract inline <script>...</script> → js
  cleanHtml = cleanHtml.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, (_match, code) => {
    const trimmed = (code as string).trim();
    if (trimmed) {
      console.log("[Jarble:Sandbox] Extracted inline <script> from html →", trimmed.length, "chars");
      extractedJs.push(trimmed);
    }
    return "";
  });

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

  if (extractedJs.length > 0 || extractedLibs.length > (existingLibs?.length || 0)) {
    console.log("[Jarble:Sandbox] Sanitized html prop — extracted", extractedJs.length, "script blocks,", extractedLibs.length - (existingLibs?.length || 0), "library URLs");
  }

  return { html: cleanHtml, js: allJs, libraries: extractedLibs };
}

/**
 * Build the full HTML document for the sandbox iframe.
 *
 * Rendered via srcdoc — without allow-same-origin the iframe gets a unique
 * opaque origin and CANNOT access the parent page's DOM, cookies, or storage.
 */
function buildDocument(
  html: string,
  css: string | undefined,
  js: string | undefined,
  libraries: string[] | undefined,
): string {
  // Sanitize and JSON-encode library URLs for dynamic loading
  const safeLibs = (libraries || [])
    .filter((url) => /^https?:\/\//.test(url));
  const libsJson = JSON.stringify(safeLibs);

  const csp = "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src 'none'";

  const themeCSS = `
    :root { color-scheme: light dark; font-family: system-ui, -apple-system, sans-serif; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
    canvas { display: block; width: 100% !important; height: 100% !important; }
  `;

  // User JS is executed AFTER all libraries are dynamically loaded
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
// Error overlay — show errors visually AND report to parent
window.onerror = function(msg, src, line, col, err) {
  console.error("[Jarble:Sandbox] Error:", msg, src, line, col);
  var d = document.createElement("div");
  d.style.cssText = "position:fixed;top:0;left:0;right:0;padding:8px 12px;background:#fee;color:#c00;font:12px monospace;z-index:99999;white-space:pre-wrap;border-bottom:2px solid #c00";
  d.textContent = "Error: " + msg + "\\n" + (src||"") + ":" + line + ":" + col;
  document.body.prepend(d);
  // Report error to parent for bot feedback
  parent.postMessage({
    type: "jarble:error",
    error: {
      message: String(msg),
      source: src || "",
      line: line || 0,
      column: col || 0,
      stack: err && err.stack ? err.stack : ""
    }
  }, "*");
};
// Also catch unhandled promise rejections
window.onunhandledrejection = function(e) {
  var msg = e.reason ? (e.reason.message || String(e.reason)) : "Unhandled promise rejection";
  console.error("[Jarble:Sandbox] Unhandled rejection:", msg);
  var d = document.createElement("div");
  d.style.cssText = "position:fixed;top:0;left:0;right:0;padding:8px 12px;background:#fee;color:#c00;font:12px monospace;z-index:99999;white-space:pre-wrap;border-bottom:2px solid #c00";
  d.textContent = "Error: " + msg;
  document.body.prepend(d);
  parent.postMessage({
    type: "jarble:error",
    error: {
      message: msg,
      source: "",
      line: 0,
      column: 0,
      stack: e.reason && e.reason.stack ? e.reason.stack : ""
    }
  }, "*");
};
console.log("[Jarble:Sandbox] iframe document loaded");
// Bridge: receive props from parent
window.__JARBLE_PROPS__ = {};
window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "jarble:props") {
    console.log("[Jarble:Sandbox] Received props:", Object.keys(e.data.props || {}));
    window.__JARBLE_PROPS__ = e.data.props || {};
    window.dispatchEvent(new CustomEvent("jarble:props", { detail: e.data.props }));
  }
});
// Bridge: send callbacks to parent
window.jarble = {
  send: function(action, payload) {
    console.log("[Jarble:Sandbox] Sending action:", action, payload);
    parent.postMessage({ type: "jarble:action", action: action, payload: payload }, "*");
  }
};
// Auto-resize: when the iframe resizes, update ALL canvas drawing buffers
// and try common Three.js/WebGL globals so content scales with the card.
window.__JARBLE_SIZE__ = { width: window.innerWidth, height: window.innerHeight };
function __jarbleAutoResize() {
  var w = window.innerWidth, h = window.innerHeight;
  var dpr = window.devicePixelRatio || 1;
  window.__JARBLE_SIZE__ = { width: w, height: h };
  // Resize all canvas drawing buffers to match their display size
  document.querySelectorAll("canvas").forEach(function(c) {
    var cw = c.clientWidth, ch = c.clientHeight;
    if (cw > 0 && ch > 0) {
      c.width = Math.round(cw * dpr);
      c.height = Math.round(ch * dpr);
    }
  });
  // Try common Three.js global names
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
    // Small delay so layout settles before we resize canvases
    requestAnimationFrame(__jarbleAutoResize);
  }
}).observe(document.documentElement);
// Dynamic library loader — guarantees scripts are fully loaded before user JS runs
(function() {
  var libs = ${libsJson};
  var loaded = 0;
  console.log("[Jarble:Sandbox] Loading " + libs.length + " libraries:", libs);
  function onReady() {
    console.log("[Jarble:Sandbox] All libraries loaded, executing user JS (" + ${JSON.stringify(escapedJs.length)} + " chars)");
    parent.postMessage({ type: "jarble:ready" }, "*");
    try { ${escapedJs} } catch(e) { console.error("[Jarble:Sandbox] User JS error:", e); window.onerror(e.message, "", 0, 0, e); }
  }
  if (libs.length === 0) { console.log("[Jarble:Sandbox] No libraries, running immediately"); return onReady(); }
  libs.forEach(function(url) {
    var s = document.createElement("script");
    s.src = url;
    s.onload = function() { console.log("[Jarble:Sandbox] Loaded:", url); if (++loaded >= libs.length) onReady(); };
    s.onerror = function() { console.error("[Jarble:Sandbox] FAILED to load:", url); if (++loaded >= libs.length) onReady(); };
    document.head.appendChild(s);
  });
})();
<\/script>
</body>
</html>`;
}

export default function CanvasSandbox({
  html,
  css,
  js,
  props,
  title,
  libraries,
}: CanvasSandboxProps) {
  // Note: height prop is ignored - sandbox fills its parent container
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readyRef = useRef(false);
  const [stopped, setStopped] = useState(false);
  const { dispatch } = useCanvasAction();

  // Sanitize: extract any <script>/<style>/structural tags from html prop
  const sanitized = sanitizeHtmlProp(html, js, libraries);

  // Build srcdoc string — changes when content changes
  const srcdoc = buildDocument(sanitized.html, css, sanitized.js, sanitized.libraries);

  console.log("[Jarble:Sandbox] Render — html:", html?.length, "chars, css:", css?.length || 0, "chars, js:", js?.length || 0, "chars, libraries:", libraries);

  // Reset ready state when content changes (iframe will reload)
  useEffect(() => {
    console.log("[Jarble:Sandbox] Content changed, resetting ready state");
    readyRef.current = false;
  }, [html, css, js, libraries]);

  // Listen for ready signal, actions, and errors from iframe
  const handleMessage = useCallback(
    (e: MessageEvent) => {
      if (e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "jarble:ready") {
        console.log("[Jarble:Sandbox] iframe ready, sending initial props");
        readyRef.current = true;
        if (props) {
          iframeRef.current?.contentWindow?.postMessage(
            { type: "jarble:props", props },
            "*",
          );
        }
      }
      if (e.data?.type === "jarble:action") {
        console.log("[Jarble:Sandbox] Action received:", e.data.action, e.data.payload);
        dispatch({
          action: String(e.data.action || "sandbox_action"),
          payload: (e.data.payload && typeof e.data.payload === "object") ? e.data.payload : {},
        });
      }
      if (e.data?.type === "jarble:error") {
        console.error("[Jarble:Sandbox] Error from iframe:", e.data.error);
        // Dispatch error as a special action so it can be forwarded to the bot
        dispatch({
          action: "sandbox_error",
          payload: {
            error: e.data.error,
            component: "sandbox",
            title: title || "Sandbox",
          },
        });
      }
    },
    [props, dispatch, title],
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
  }, [props]);

  const handleStop = useCallback(() => {
    if (stopped) {
      // Restart — un-stop so the iframe re-renders with srcdoc
      setStopped(false);
      console.log("[Jarble:Sandbox] Restarted");
    } else {
      // Stop — remove the iframe srcdoc to kill all JS execution
      setStopped(true);
      readyRef.current = false;
      console.log("[Jarble:Sandbox] Stopped — iframe destroyed");
    }
  }, [stopped]);

  // Fill the parent container - card already provides border/padding
  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%", minHeight: 0 }}>
      {/* Minimal control bar - just the stop/restart button */}
      <div style={{ display: "flex", justifyContent: "flex-end", flexShrink: 0, marginBottom: 4 }}>
        <button
          onClick={handleStop}
          className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md transition-colors text-muted-foreground hover:text-foreground hover:bg-muted/50"
        >
          {stopped ? (
            <>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3 2L10 6L3 10V2Z" fill="currentColor"/>
              </svg>
              Restart
            </>
          ) : (
            <>
              <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="2" y="2" width="8" height="8" rx="1" fill="currentColor"/>
              </svg>
              Stop
            </>
          )}
        </button>
      </div>
      {stopped ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 0 }} className="rounded-lg bg-muted/30 text-muted-foreground text-sm">
          Sandbox stopped — click Restart to resume
        </div>
      ) : (
        <iframe
          ref={iframeRef}
          srcDoc={srcdoc}
          sandbox="allow-scripts allow-popups"
          style={{ flex: 1, width: "100%", minHeight: 0, border: "none", borderRadius: 8, background: "transparent" }}
        />
      )}
    </div>
  );
}
