/**
 * Shared sandbox document building logic.
 *
 * Extracted from CanvasSandbox.tsx and MarketplaceSandbox.tsx to eliminate
 * ~250 lines of duplicated HTML template, CSP construction, sanitization,
 * and library injection code.
 */

import { TRUSTED_CDN_ORIGINS } from "@jarble/component-manifest";
import { sanitizeHtml } from "@/lib/sanitize";
import type { SandboxDocumentConfig } from "./types";
import { HEARTBEAT_INTERVAL_MS } from "./types";

const isDev = process.env.NODE_ENV === "development";

/** Escape a string for safe use inside an HTML attribute (double-quoted). */
export function escapeAttr(s: string): string {
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
export function sanitizeHtmlProp(
  html: string,
  existingJs: string | undefined,
  existingLibs: string[] | undefined,
  logPrefix = "[Jarble:Sandbox]",
  existingCss?: string | undefined,
): { html: string; js: string; css: string; libraries: string[] } {
  let cleanHtml = html;
  const extractedJs: string[] = [];
  const extractedCss: string[] = [];
  const extractedLibs: string[] = [...(existingLibs || [])];

  // Extract <script src="..."> tags -> libraries
  cleanHtml = cleanHtml.replace(
    /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (_match, url) => {
      isDev && console.log(`${logPrefix} Extracted <script src> from html ->`, url);
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
        isDev && console.log(`${logPrefix} Extracted inline <script> from html ->`, trimmed.length, "chars");
        extractedJs.push(trimmed);
      }
      return "";
    },
  );

  // Extract <style>...</style> -> css (LLMs frequently put styles in html prop)
  cleanHtml = cleanHtml.replace(
    /<style[^>]*>([\s\S]*?)<\/style>/gi,
    (_match, cssContent) => {
      const trimmed = (cssContent as string).trim();
      if (trimmed) {
        isDev && console.log(`${logPrefix} Extracted <style> from html ->`, trimmed.length, "chars");
        extractedCss.push(trimmed);
      }
      return "";
    },
  );

  // Extract <link rel="stylesheet" href="..."> -> CSS @import rules
  cleanHtml = cleanHtml.replace(
    /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
    (_match, url) => {
      isDev && console.log(`${logPrefix} Extracted <link stylesheet> from html ->`, url);
      extractedCss.push(`@import url("${url}");`);
      return "";
    },
  );
  // Also match href-first order: <link href="..." rel="stylesheet">
  cleanHtml = cleanHtml.replace(
    /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi,
    (_match, url) => {
      isDev && console.log(`${logPrefix} Extracted <link stylesheet> from html ->`, url);
      extractedCss.push(`@import url("${url}");`);
      return "";
    },
  );

  // Strip structural tags
  cleanHtml = cleanHtml
    .replace(/<!DOCTYPE[^>]*>/gi, "")
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<\/?head[^>]*>/gi, "")
    .replace(/<\/?body[^>]*>/gi, "")
    .replace(/<meta[^>]*>/gi, "")
    .replace(/<link[^>]*>/gi, "") // Strip remaining <link> tags (non-stylesheet)
    .trim();

  // Combine JS: existing js prop takes priority, extracted JS appended
  const allJs = [existingJs, ...extractedJs].filter(Boolean).join("\n");

  // Combine CSS: extracted CSS first (so existing css prop can override)
  const allCss = [...extractedCss, existingCss].filter(Boolean).join("\n");

  if (extractedJs.length > 0 || extractedLibs.length > (existingLibs?.length || 0) || extractedCss.length > 0) {
    isDev && console.log(
      `${logPrefix} Sanitized html prop — extracted`,
      extractedJs.length, "script blocks,",
      extractedCss.length, "style blocks,",
      extractedLibs.length - (existingLibs?.length || 0), "library URLs",
    );
  }

  // Additional XSS sanitization via DOMPurify
  cleanHtml = sanitizeHtml(cleanHtml);

  return { html: cleanHtml, js: allJs, css: allCss, libraries: extractedLibs };
}

/**
 * Build the full HTML document for a sandbox iframe.
 *
 * Rendered via srcdoc — without allow-same-origin the iframe gets a unique
 * opaque origin and CANNOT access the parent page's DOM, cookies, or storage.
 *
 * @param config.logPrefix - Log prefix for console messages (e.g. "[Jarble:Sandbox]" or "[Jarble:MarketplaceSandbox:Inner]")
 */
export function buildDocument(
  html: string,
  css: string | undefined,
  js: string | undefined,
  libraries: string[] | undefined,
  config: SandboxDocumentConfig = { logPrefix: "[Jarble:Sandbox]" },
): string {
  const { logPrefix } = config;

  // Sanitize and JSON-encode library URLs for dynamic loading
  const safeLibs = (libraries || []).filter((url) => /^https?:\/\//.test(url));
  const libsJson = JSON.stringify(safeLibs);

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
  console.error("${logPrefix} Error:", msg, src, line, col);
  var d = document.createElement("div");
  d.style.cssText = "position:fixed;top:0;left:0;right:0;padding:8px 12px;background:#fee;color:#c00;font:12px monospace;z-index:99999;white-space:pre-wrap;border-bottom:2px solid #c00";
  d.textContent = "Error: " + msg + "\\n" + (src||"") + ":" + line + ":" + col;
  document.body.prepend(d);
  // Report error to parent — use only plain strings (structured clone can't handle Error objects)
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
  console.error("${logPrefix} Unhandled rejection:", msg);
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
// CSP violation monitoring — report blocked resources to parent
document.addEventListener("securitypolicyviolation", function(e) {
  parent.postMessage({
    type: "jarble:csp-violation",
    detail: {
      blockedURI: e.blockedURI || "",
      violatedDirective: e.violatedDirective || "",
      effectiveDirective: e.effectiveDirective || "",
      originalPolicy: e.originalPolicy ? e.originalPolicy.substring(0, 200) : "",
      sourceFile: e.sourceFile || "",
      lineNumber: e.lineNumber || 0
    }
  }, "*");
});
console.log("${logPrefix} iframe document loaded");
// Bridge: receive props from parent
window.__JARBLE_PROPS__ = {};
window.addEventListener("message", function(e) {
  if (e.data && e.data.type === "jarble:props") {
    console.log("${logPrefix} Received props:", Object.keys(e.data.props || {}));
    window.__JARBLE_PROPS__ = e.data.props || {};
    window.dispatchEvent(new CustomEvent("jarble:props", { detail: e.data.props }));
  }
  if (e.data && e.data.type === "jarble:storage-response") {
    var resp = e.data.response;
    var cb = window.jarble._pendingStorage[resp.id];
    if (cb) { delete window.jarble._pendingStorage[resp.id]; cb(resp); }
  }
  if (e.data && e.data.type === "jarble:event") {
    var handlers = window.jarble._eventHandlers[e.data.channel];
    if (handlers) { for (var i = 0; i < handlers.length; i++) { try { handlers[i](e.data.data); } catch(err) { console.error("${logPrefix} Event handler error:", err); } } }
  }
});
// Bridge: send callbacks to parent
window.jarble = {
  send: function(action, payload) {
    console.log("${logPrefix} Sending action:", action, payload);
    parent.postMessage({ type: "jarble:action", action: action, payload: payload }, "*");
  },
  heartbeat: function() {
    parent.postMessage({ type: "jarble:heartbeat" }, "*");
  },
  reportProgress: function(percent) {
    parent.postMessage({ type: "jarble:progress", percent: percent }, "*");
  },
  // Storage proxy — scoped localStorage via parent (since sandbox has opaque origin)
  _pendingStorage: {},
  _storageIdCounter: 0,
  storage: {
    get: function(key) {
      return new Promise(function(resolve, reject) {
        var id = "s" + (++window.jarble._storageIdCounter);
        var timer = setTimeout(function() { delete window.jarble._pendingStorage[id]; reject(new Error("Storage timeout")); }, 5000);
        window.jarble._pendingStorage[id] = function(resp) { clearTimeout(timer); if (resp.ok) resolve(resp.value); else reject(new Error(resp.error || "Storage error")); };
        parent.postMessage({ type: "jarble:storage-request", request: { id: id, op: "get", key: key } }, "*");
      });
    },
    set: function(key, value) {
      return new Promise(function(resolve, reject) {
        var id = "s" + (++window.jarble._storageIdCounter);
        var timer = setTimeout(function() { delete window.jarble._pendingStorage[id]; reject(new Error("Storage timeout")); }, 5000);
        window.jarble._pendingStorage[id] = function(resp) { clearTimeout(timer); if (resp.ok) resolve(); else reject(new Error(resp.error || "Storage error")); };
        parent.postMessage({ type: "jarble:storage-request", request: { id: id, op: "set", key: key, value: value } }, "*");
      });
    },
    delete: function(key) {
      return new Promise(function(resolve, reject) {
        var id = "s" + (++window.jarble._storageIdCounter);
        var timer = setTimeout(function() { delete window.jarble._pendingStorage[id]; reject(new Error("Storage timeout")); }, 5000);
        window.jarble._pendingStorage[id] = function(resp) { clearTimeout(timer); if (resp.ok) resolve(); else reject(new Error(resp.error || "Storage error")); };
        parent.postMessage({ type: "jarble:storage-request", request: { id: id, op: "delete", key: key } }, "*");
      });
    }
  },
  // Inter-sandbox event relay
  _eventHandlers: {},
  events: {
    on: function(channel, handler) {
      if (!window.jarble._eventHandlers[channel]) window.jarble._eventHandlers[channel] = [];
      window.jarble._eventHandlers[channel].push(handler);
    },
    emit: function(channel, data) {
      parent.postMessage({ type: "jarble:event-emit", channel: channel, data: data }, "*");
    }
  },
  // Canvas control from sandbox
  canvas: {
    resize: function(width, height) {
      parent.postMessage({ type: "jarble:resize-request", width: width, height: height }, "*");
    },
    setTitle: function(title) {
      parent.postMessage({ type: "jarble:set-title", title: title }, "*");
    }
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
// Heartbeat: ping parent every ${HEARTBEAT_INTERVAL_MS}ms so it knows we're alive
setInterval(function() {
  window.jarble.heartbeat();
}, ${HEARTBEAT_INTERVAL_MS});
// Dynamic library loader — loads scripts SEQUENTIALLY to preserve dependency order,
// then executes user JS at GLOBAL scope (not in a function) so const/let/var
// declarations are accessible to auto-resize and other global code.
(function() {
  var libs = ${libsJson};
  var idx = 0;
  console.log("${logPrefix} Loading " + libs.length + " libraries:", libs);
  function onReady() {
    console.log("${logPrefix} All libraries loaded, executing user JS (" + ${JSON.stringify(escapedJs.length)} + " chars)");
    parent.postMessage({ type: "jarble:ready" }, "*");
    // Execute user JS at global scope via script tag injection.
    // This ensures const/let/var declarations are globally accessible
    // (e.g. Three.js renderer/camera for auto-resize).
    // Errors are caught by window.onerror handler above.
    if (${JSON.stringify(escapedJs.length)} > 0) {
      var s = document.createElement("script");
      s.textContent = ${JSON.stringify(escapedJs)};
      document.body.appendChild(s);
    }
  }
  function loadNext() {
    if (idx >= libs.length) { return onReady(); }
    var url = libs[idx++];
    var s = document.createElement("script");
    s.src = url;
    s.onload = function() { console.log("${logPrefix} Loaded:", url); loadNext(); };
    s.onerror = function() { console.error("${logPrefix} FAILED to load:", url); loadNext(); };
    document.head.appendChild(s);
  }
  if (libs.length === 0) { console.log("${logPrefix} No libraries, running immediately"); return onReady(); }
  loadNext();
})();
<\/script>
</body>
</html>`;
}

/**
 * Build the outer iframe's HTML document for the double-iframe marketplace model.
 *
 * The outer iframe contains:
 * 1. A strict CSP (no connect-src, no img-src — only the inner iframe needs those)
 * 2. The inner iframe element with sandbox="allow-scripts"
 * 3. A postMessage bridge that relays messages between inner iframe and main app
 */
export function buildOuterDocument(): string {
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
          msgType === "jarble:error" ||
          msgType === "jarble:heartbeat" ||
          msgType === "jarble:progress" ||
          msgType === "jarble:storage-request" ||
          msgType === "jarble:event-emit" ||
          msgType === "jarble:resize-request" ||
          msgType === "jarble:set-title") {
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
