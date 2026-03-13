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

/**
 * Default ESM import map — pre-configured for common libraries.
 * Merged with user-supplied importMap in buildDocument().
 * Unused entries have zero runtime cost (browsers ignore them).
 */
export const DEFAULT_SANDBOX_IMPORTS: Record<string, string> = {
  "three": "https://esm.sh/three@0.169.0",
  "three/addons/controls/OrbitControls": "https://esm.sh/three@0.169.0/addons/controls/OrbitControls.js",
  "d3": "https://esm.sh/d3@7.9.0",
  "chart.js": "https://esm.sh/chart.js@4.4.1",
  "chart.js/auto": "https://esm.sh/chart.js@4.4.1/auto",
  "leaflet": "https://esm.sh/leaflet@1.9.4",
  "react": "https://esm.sh/react@18.3.1",
  "react-dom": "https://esm.sh/react-dom@18.3.1",
  "react-dom/client": "https://esm.sh/react-dom@18.3.1/client",
  "gsap": "https://esm.sh/gsap@3.12.5",
  "p5": "https://esm.sh/p5@1.9.0",
  "tone": "https://esm.sh/tone@14.7.77",
};

/** Check if a URL origin is in the trusted CDN allowlist. */
function isUrlTrustedCdn(url: string): boolean {
  if (!url.startsWith("https://")) return false;
  try {
    const parsed = new URL(url);
    return TRUSTED_CDN_ORIGINS.includes(parsed.origin);
  } catch {
    return false;
  }
}

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
): { html: string; js: string; css: string; libraries: string[]; moduleJs: string } {
  let cleanHtml = html;
  const extractedJs: string[] = [];
  const extractedModuleJs: string[] = [];
  const extractedCss: string[] = [];
  const extractedLibs: string[] = [...(existingLibs || [])];

  // Extract <script type="module" src="..."> tags -> libraries (only from trusted CDNs)
  cleanHtml = cleanHtml.replace(
    /<script\s+[^>]*type=["']module["'][^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (_match, url) => {
      if (isUrlTrustedCdn(url)) {
        isDev && console.log(`${logPrefix} Extracted <script type="module" src> from html ->`, url);
        if (!extractedLibs.includes(url)) extractedLibs.push(url);
      } else {
        isDev && console.warn(`${logPrefix} Rejected untrusted module script URL:`, url);
      }
      return "";
    },
  );

  // Extract inline <script type="module">...</script> -> moduleJs
  // Must run BEFORE generic <script> extraction so module scripts go to moduleJs, not js
  cleanHtml = cleanHtml.replace(
    /<script\s+[^>]*type=["']module["'][^>]*>([\s\S]*?)<\/script>/gi,
    (_match, code) => {
      const trimmed = (code as string).trim();
      if (trimmed) {
        isDev && console.log(`${logPrefix} Extracted inline <script type="module"> from html ->`, trimmed.length, "chars");
        extractedModuleJs.push(trimmed);
      }
      return "";
    },
  );

  // Extract <script src="..."> tags -> libraries (only from trusted CDNs)
  cleanHtml = cleanHtml.replace(
    /<script\s+[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi,
    (_match, url) => {
      if (isUrlTrustedCdn(url)) {
        isDev && console.log(`${logPrefix} Extracted <script src> from html ->`, url);
        if (!extractedLibs.includes(url)) extractedLibs.push(url);
      } else {
        isDev && console.warn(`${logPrefix} Rejected untrusted script URL:`, url);
      }
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
  // Only allow stylesheets from trusted CDN origins (defense-in-depth)
  cleanHtml = cleanHtml.replace(
    /<link\s+[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*\/?>/gi,
    (_match, url) => {
      if (isUrlTrustedCdn(url)) {
        isDev && console.log(`${logPrefix} Extracted <link stylesheet> from html ->`, url);
        extractedCss.push(`@import url("${url}");`);
      } else {
        isDev && console.warn(`${logPrefix} Rejected untrusted stylesheet URL:`, url);
      }
      return "";
    },
  );
  // Also match href-first order: <link href="..." rel="stylesheet">
  cleanHtml = cleanHtml.replace(
    /<link\s+[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["'][^>]*\/?>/gi,
    (_match, url) => {
      if (isUrlTrustedCdn(url)) {
        isDev && console.log(`${logPrefix} Extracted <link stylesheet> from html ->`, url);
        extractedCss.push(`@import url("${url}");`);
      } else {
        isDev && console.warn(`${logPrefix} Rejected untrusted stylesheet URL:`, url);
      }
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

  // Combine module JS from extracted inline module scripts
  const allModuleJs = extractedModuleJs.join("\n");

  // Combine CSS: extracted CSS first (so existing css prop can override)
  const allCss = [...extractedCss, existingCss].filter(Boolean).join("\n");

  if (extractedJs.length > 0 || extractedModuleJs.length > 0 || extractedLibs.length > (existingLibs?.length || 0) || extractedCss.length > 0) {
    isDev && console.log(
      `${logPrefix} Sanitized html prop — extracted`,
      extractedJs.length, "script blocks,",
      extractedModuleJs.length, "module script blocks,",
      extractedCss.length, "style blocks,",
      extractedLibs.length - (existingLibs?.length || 0), "library URLs",
    );
  }

  // Additional XSS sanitization via DOMPurify
  cleanHtml = sanitizeHtml(cleanHtml);

  return { html: cleanHtml, js: allJs, css: allCss, libraries: extractedLibs, moduleJs: allModuleJs };
}

/**
 * Build skin-specific default styles for sandbox content.
 * These provide sensible defaults when a skin is active so AI-generated
 * content automatically looks consistent with the parent chat UI.
 */
function buildSkinCSS(skinName: string): string {
  switch (skinName) {
    case "terminal":
      return `    body { font-family: var(--font-mono, 'JetBrains Mono', 'Fira Code', monospace); color: var(--foreground, #00ff00); }`;
    case "retro":
      return `    body { font-family: var(--font-pixel, 'Press Start 2P', monospace); image-rendering: pixelated; color: var(--foreground, #212529); }`;
    case "glass":
      return `    body { backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px); color: var(--foreground, inherit); }`;
    case "handdrawn":
      return `    body { font-family: var(--font-handdrawn, 'Caveat', 'Comic Sans MS', cursive); color: var(--foreground, inherit); }`;
    case "neobrutalist":
      return `    body { color: var(--foreground, inherit); }\n    body > * { border: 3px solid currentColor; box-shadow: 4px 4px 0 currentColor; }`;
    case "win98":
      return `    body { font-family: 'MS Sans Serif', 'Segoe UI', Tahoma, sans-serif; color: var(--foreground, #000000); }`;
    default:
      return "";
  }
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
  moduleJs?: string,
  importMap?: Record<string, string>,
  themeVars?: Record<string, string>,
): string {
  const { logPrefix } = config;

  // Sanitize and JSON-encode library URLs for dynamic loading
  // Defense-in-depth: validate against CDN allowlist on the client side too
  // (server-side validation in uiBlockParser.ts is the primary gate)
  const safeLibs = (libraries || []).filter((url) => {
    if (!/^https:\/\//.test(url)) return false;
    try {
      const parsed = new URL(url);
      return TRUSTED_CDN_ORIGINS.includes(parsed.origin);
    } catch {
      return false;
    }
  });
  const libsJson = JSON.stringify(safeLibs);

  // Merge default imports with user-supplied importMap (user takes precedence)
  const mergedMap = { ...DEFAULT_SANDBOX_IMPORTS, ...(importMap ?? {}) };

  // Sanitize import map: only allow trusted CDN URLs as values
  const safeImportMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(mergedMap)) {
    if (typeof value === "string" && isUrlTrustedCdn(value)) {
      safeImportMap[key] = value;
    } else if (isDev) {
      console.warn(`${config.logPrefix} Rejected untrusted import map URL for "${key}":`, value);
    }
  }
  const hasImportMap = Object.keys(safeImportMap).length > 0;
  const hasModuleJs = typeof moduleJs === "string" && moduleJs.length > 0;

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

  // Build theme CSS variable declarations from parent page's resolved theme
  const themeVarDeclarations = themeVars && Object.keys(themeVars).length > 0
    ? Object.entries(themeVars)
        .map(([key, value]) => `      ${key}: ${value};`)
        .join("\n")
    : "";

  // Detect skin name for skin-specific default styles
  const skinName = themeVars?.["--jarble-skin"] || "";
  const skinCSS = buildSkinCSS(skinName);

  const themeCSS = `
    :root {
      color-scheme: light dark;
      font-family: system-ui, -apple-system, sans-serif;
${themeVarDeclarations}
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; width: 100%; height: 100%; background: transparent; overflow: hidden; }
    canvas { display: block; width: 100% !important; height: 100% !important; }
${skinCSS}
  `;

  // User JS is executed AFTER all libraries are dynamically loaded
  const escapedJs = js || "";
  const escapedModuleJs = moduleJs || "";

  // Import map must appear before any module scripts in <head>
  const importMapTag = hasImportMap
    ? `\n<script type="importmap">\n${JSON.stringify({ imports: safeImportMap }, null, 2)}\n<\/script>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeAttr(csp)}">
<style>${themeCSS}\n${css || ""}</style>${importMapTag}
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
  if (e.data && e.data.type === "jarble:fetch-response") {
    var fresp = e.data.response;
    var fcb = window.jarble._pendingFetch[fresp.id];
    if (fcb) { delete window.jarble._pendingFetch[fresp.id]; fcb(fresp); }
  }
  if (e.data && e.data.type === "jarble:ask-response") {
    var aresp = e.data.response;
    var acb = window.jarble._pendingAsk[aresp.id];
    if (acb) { delete window.jarble._pendingAsk[aresp.id]; acb(aresp); }
  }
  if (e.data && e.data.type === "jarble:stream-event") {
    var se = e.data;
    var sh = window.jarble._activeStreams[se.streamId];
    if (sh && sh.onmessage) { try { sh.onmessage(se.data); } catch(err) { console.error("${logPrefix} Stream handler error:", err); } }
  }
  if (e.data && e.data.type === "jarble:stream-error") {
    var see = e.data;
    var seh = window.jarble._activeStreams[see.streamId];
    if (seh && seh.onerror) { try { seh.onerror(new Error(see.error)); } catch(err) { console.error("${logPrefix} Stream error handler error:", err); } }
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
  },
  // Data channel — fetch data through the platform (MCP tools, services, etc.)
  // Bypasses CSP restrictions by routing through the host bridge -> API
  _pendingFetch: {},
  _fetchIdCounter: 0,
  fetch: function(tool, payload) {
    return new Promise(function(resolve, reject) {
      var id = "f" + (++window.jarble._fetchIdCounter);
      var timer = setTimeout(function() {
        delete window.jarble._pendingFetch[id];
        reject(new Error("jarble.fetch timeout (30s)"));
      }, 30000);
      window.jarble._pendingFetch[id] = function(resp) {
        clearTimeout(timer);
        if (resp.ok) resolve(resp.data);
        else reject(new Error(resp.error || "Fetch failed"));
      };
      parent.postMessage({ type: "jarble:fetch", request: { id: id, tool: tool, payload: payload } }, "*");
    });
  },
  // Syntactic sugar: call an installed service directly (routes through service proxy)
  service: function(name, endpoint, body) {
    return window.jarble.fetch("service_call", { service: name, endpoint: endpoint, body: body || {} });
  },
  // Ask the bot a contextual question (isolated session, no UI blocks)
  _pendingAsk: {},
  _askIdCounter: 0,
  _askRateWindow: [],
  ask: function(question) {
    return new Promise(function(resolve, reject) {
      // Client-side rate limit: max 10 asks per minute
      var now = Date.now();
      window.jarble._askRateWindow = window.jarble._askRateWindow.filter(function(t) { return now - t < 60000; });
      if (window.jarble._askRateWindow.length >= 10) {
        reject(new Error("jarble.ask rate limit exceeded (10/min)"));
        return;
      }
      window.jarble._askRateWindow.push(now);

      var id = "a" + (++window.jarble._askIdCounter);
      var timer = setTimeout(function() {
        delete window.jarble._pendingAsk[id];
        reject(new Error("jarble.ask timeout (60s)"));
      }, 60000);
      window.jarble._pendingAsk[id] = function(resp) {
        clearTimeout(timer);
        if (resp.ok) resolve(resp.answer);
        else reject(new Error(resp.error || "Ask failed"));
      };
      parent.postMessage({ type: "jarble:ask", request: { id: id, question: question } }, "*");
    });
  },
  // Real-time stream subscription from services
  _activeStreams: {},
  _streamIdCounter: 0,
  stream: function(channel, params) {
    var streamId = "st" + (++window.jarble._streamIdCounter);
    var handlers = { onmessage: null, onerror: null };
    window.jarble._activeStreams[streamId] = handlers;

    parent.postMessage({ type: "jarble:stream-subscribe", request: { id: streamId, channel: channel, params: params || {} } }, "*");

    return {
      onmessage: function(fn) { handlers.onmessage = fn; return this; },
      onerror: function(fn) { handlers.onerror = fn; return this; },
      close: function() {
        delete window.jarble._activeStreams[streamId];
        parent.postMessage({ type: "jarble:stream-unsubscribe", request: { id: streamId } }, "*");
      }
    };
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
    // Execute ES module JS (if provided) — runs as <script type="module">
    // enabling import statements from esm.sh/esm.run CDNs.
    if (${JSON.stringify(escapedModuleJs.length)} > 0) {
      var m = document.createElement("script");
      m.type = "module";
      m.textContent = ${JSON.stringify(escapedModuleJs)};
      document.body.appendChild(m);
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
          msgType === "jarble:fetch" ||
          msgType === "jarble:ask" ||
          msgType === "jarble:stream-subscribe" ||
          msgType === "jarble:stream-unsubscribe" ||
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
