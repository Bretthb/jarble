import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DOMPurify (runs on server in tests - sanitizeHtml returns input as-is)
vi.mock("@/lib/sanitize", () => ({
  sanitizeHtml: (html: string) => html,
}));

import { sanitizeHtmlProp, buildDocument, escapeAttr } from "../sandbox/sandboxCore";

// ── escapeAttr ────────────────────────────────────────────────────────────────

describe("escapeAttr", () => {
  it("escapes ampersands", () => {
    expect(escapeAttr("a&b")).toBe("a&amp;b");
  });

  it("escapes double quotes", () => {
    expect(escapeAttr('a"b')).toBe("a&quot;b");
  });

  it("escapes angle brackets", () => {
    expect(escapeAttr("a<b>c")).toBe("a&lt;b&gt;c");
  });

  it("handles multiple special chars", () => {
    expect(escapeAttr('<script>"alert&1"</script>')).toBe(
      "&lt;script&gt;&quot;alert&amp;1&quot;&lt;/script&gt;",
    );
  });

  it("leaves safe strings unchanged", () => {
    expect(escapeAttr("hello world 123")).toBe("hello world 123");
  });
});

// ── sanitizeHtmlProp ──────────────────────────────────────────────────────────

describe("sanitizeHtmlProp", () => {
  // ── Script extraction ───────────────────────────────────────────────

  it("extracts <script src> into libraries", () => {
    const html = '<div>Hi</div><script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>';
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.libraries).toEqual(["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"]);
    expect(result.html).not.toContain("<script");
  });

  it("extracts inline <script> into js", () => {
    const html = '<div id="app"></div><script>const x = 1;</script>';
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.js).toBe("const x = 1;");
    expect(result.html).not.toContain("<script");
  });

  it("prepends existing js prop before extracted scripts", () => {
    const html = '<div></div><script>const y = 2;</script>';
    const result = sanitizeHtmlProp(html, "const x = 1;", undefined);
    expect(result.js).toBe("const x = 1;\nconst y = 2;");
  });

  it("deduplicates library URLs", () => {
    const html = '<script src="https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"></script>';
    const existing = ["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"];
    const result = sanitizeHtmlProp(html, undefined, existing);
    expect(result.libraries).toEqual(["https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js"]);
  });

  it("handles multiple script tags", () => {
    const html = `
      <script src="https://cdn.jsdelivr.net/npm/three@0.169/build/three.min.js"></script>
      <div id="canvas"></div>
      <script>const scene = new THREE.Scene();</script>
      <script>const camera = new THREE.PerspectiveCamera();</script>
    `;
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.libraries).toEqual(["https://cdn.jsdelivr.net/npm/three@0.169/build/three.min.js"]);
    expect(result.js).toContain("const scene = new THREE.Scene();");
    expect(result.js).toContain("const camera = new THREE.PerspectiveCamera();");
  });

  // ── CSS extraction (the critical bug fix) ───────────────────────────

  it("extracts <style> tags into css", () => {
    const html = '<style>body { color: red; }</style><div>Hello</div>';
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.css).toBe("body { color: red; }");
    expect(result.html).not.toContain("<style");
    expect(result.html).toContain("Hello");
  });

  it("extracts multiple <style> tags", () => {
    const html = '<style>.a { color: red; }</style><div></div><style>.b { color: blue; }</style>';
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.css).toContain(".a { color: red; }");
    expect(result.css).toContain(".b { color: blue; }");
  });

  it("merges extracted CSS with existing css prop", () => {
    const html = '<style>.extracted { color: red; }</style><div></div>';
    const result = sanitizeHtmlProp(html, undefined, undefined, "[test]", ".existing { color: blue; }");
    // Existing CSS should come AFTER extracted (so it can override)
    expect(result.css).toContain(".extracted { color: red; }");
    expect(result.css).toContain(".existing { color: blue; }");
    const extractedIdx = result.css.indexOf(".extracted");
    const existingIdx = result.css.indexOf(".existing");
    expect(extractedIdx).toBeLessThan(existingIdx);
  });

  it("returns existing css when no styles in html", () => {
    const html = "<div>No styles</div>";
    const result = sanitizeHtmlProp(html, undefined, undefined, "[test]", ".existing { color: blue; }");
    expect(result.css).toBe(".existing { color: blue; }");
  });

  it("returns empty css when no styles anywhere", () => {
    const html = "<div>No styles</div>";
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.css).toBe("");
  });

  // ── Link stylesheet extraction ──────────────────────────────────────

  it("extracts <link rel='stylesheet'> into CSS @import", () => {
    const html = '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet/dist/leaflet.css"><div></div>';
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.css).toContain('@import url("https://cdn.jsdelivr.net/npm/leaflet/dist/leaflet.css")');
    expect(result.html).not.toContain("<link");
  });

  it("extracts <link> with href-first attribute order", () => {
    const html = '<link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet"><div></div>';
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.css).toContain('@import url("https://fonts.googleapis.com/css2?family=Inter")');
  });

  it("combines <link> and <style> extraction", () => {
    const html = `
      <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet/dist/leaflet.css">
      <style>.map { height: 100%; }</style>
      <div id="map"></div>
    `;
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.css).toContain("@import");
    expect(result.css).toContain(".map { height: 100%; }");
  });

  // ── Structural tag stripping ────────────────────────────────────────

  it("strips DOCTYPE", () => {
    const html = '<!DOCTYPE html><div>content</div>';
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.html).not.toContain("DOCTYPE");
    expect(result.html).toContain("content");
  });

  it("strips <html>, <head>, <body>, <meta> tags", () => {
    const html = '<html><head><meta charset="utf-8"></head><body><div>content</div></body></html>';
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.html).not.toContain("<html");
    expect(result.html).not.toContain("<head");
    expect(result.html).not.toContain("<body");
    expect(result.html).not.toContain("<meta");
    expect(result.html).toContain("content");
  });

  it("strips remaining non-stylesheet <link> tags", () => {
    const html = '<link rel="icon" href="/favicon.ico"><div>content</div>';
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.html).not.toContain("<link");
  });

  // ── Full document extraction (common LLM output) ───────────────────

  it("handles full HTML document from LLM", () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/leaflet/dist/leaflet.css">
  <style>#map { width: 100%; height: 100%; }</style>
  <script src="https://cdn.jsdelivr.net/npm/leaflet@1/dist/leaflet.js"></script>
</head>
<body>
  <div id="map"></div>
  <script>
    const map = L.map('map').setView([51.505, -0.09], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  </script>
</body>
</html>`;
    const result = sanitizeHtmlProp(html, undefined, undefined);

    // Should extract libraries
    expect(result.libraries).toEqual(["https://cdn.jsdelivr.net/npm/leaflet@1/dist/leaflet.js"]);

    // Should extract CSS (both @import and inline)
    expect(result.css).toContain("@import");
    expect(result.css).toContain("#map { width: 100%; height: 100%; }");

    // Should extract JS
    expect(result.js).toContain("L.map('map')");

    // HTML should only contain the div
    expect(result.html).toContain('<div id="map"></div>');
    expect(result.html).not.toContain("<script");
    expect(result.html).not.toContain("<style");
    expect(result.html).not.toContain("DOCTYPE");
  });

  // ── Edge cases ──────────────────────────────────────────────────────

  it("handles empty html", () => {
    const result = sanitizeHtmlProp("", undefined, undefined);
    expect(result.html).toBe("");
    expect(result.js).toBe("");
    expect(result.css).toBe("");
    expect(result.libraries).toEqual([]);
  });

  it("handles html with only body content (clean input)", () => {
    const html = '<div id="app"><canvas></canvas></div>';
    const result = sanitizeHtmlProp(html, "init();", ["https://cdn.jsdelivr.net/npm/three@0.169/build/three.min.js"]);
    expect(result.html).toContain('<div id="app">');
    expect(result.js).toBe("init();");
    expect(result.libraries).toEqual(["https://cdn.jsdelivr.net/npm/three@0.169/build/three.min.js"]);
  });

  it("handles empty <script> tags", () => {
    const html = '<script></script><div>content</div>';
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.js).toBe("");
    expect(result.html).toContain("content");
  });

  it("handles empty <style> tags", () => {
    const html = '<style></style><div>content</div>';
    const result = sanitizeHtmlProp(html, undefined, undefined);
    expect(result.css).toBe("");
    expect(result.html).toContain("content");
  });
});

// ── buildDocument ─────────────────────────────────────────────────────────────

describe("buildDocument", () => {
  it("produces a valid HTML document", () => {
    const doc = buildDocument("<div>Hello</div>", undefined, undefined, undefined);
    expect(doc).toContain("<!DOCTYPE html>");
    expect(doc).toContain("<html>");
    expect(doc).toContain("</html>");
    expect(doc).toContain("<div>Hello</div>");
  });

  it("includes Content-Security-Policy meta tag", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("Content-Security-Policy");
    expect(doc).toContain("default-src");
    expect(doc).toContain("script-src");
  });

  it("CSP includes all trusted CDN origins", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("cdn.jsdelivr.net");
    expect(doc).toContain("cdnjs.cloudflare.com");
    expect(doc).toContain("unpkg.com");
    expect(doc).toContain("esm.sh");
  });

  it("CSP blocks frames", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("frame-src 'none'");
  });

  it("includes user CSS in <style> tag", () => {
    const doc = buildDocument("<div></div>", ".custom { color: red; }", undefined, undefined);
    expect(doc).toContain(".custom { color: red; }");
  });

  it("includes user HTML in body", () => {
    const doc = buildDocument('<div id="app"><canvas></canvas></div>', undefined, undefined, undefined);
    expect(doc).toContain('<div id="app"><canvas></canvas></div>');
  });

  it("includes error overlay handler", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("window.onerror");
    expect(doc).toContain("jarble:error");
  });

  it("includes unhandled rejection handler", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("onunhandledrejection");
  });

  it("includes CSP violation listener", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("securitypolicyviolation");
    expect(doc).toContain("jarble:csp-violation");
  });

  it("includes bridge API (window.jarble)", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("window.jarble");
    // Bridge properties are defined as object keys (send:, heartbeat:, storage:, events:, canvas:)
    expect(doc).toContain("send:");
    expect(doc).toContain("heartbeat:");
    expect(doc).toContain("storage:");
    expect(doc).toContain("events:");
    expect(doc).toContain("canvas:");
  });

  it("includes heartbeat interval", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("setInterval");
    expect(doc).toContain("jarble:heartbeat");
  });

  it("includes auto-resize handler for canvas and Three.js", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("__jarbleAutoResize");
    expect(doc).toContain("ResizeObserver");
    expect(doc).toContain("renderer");
    expect(doc).toContain("camera");
  });

  it("includes props bridge", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("__JARBLE_PROPS__");
    expect(doc).toContain("jarble:props");
  });

  // ── Library loading ─────────────────────────────────────────────────

  it("produces sequential library loading code", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, [
      "https://cdn.jsdelivr.net/npm/three@0.169/build/three.min.js",
      "https://cdn.jsdelivr.net/npm/three@0.169/examples/jsm/controls/OrbitControls.js",
    ]);
    // Should use sequential loading (loadNext pattern)
    expect(doc).toContain("loadNext");
    // Libraries should be in order in the JSON array
    const libsIdx1 = doc.indexOf("three@0.169/build/three.min.js");
    const libsIdx2 = doc.indexOf("three@0.169/examples/jsm/controls/OrbitControls.js");
    expect(libsIdx1).toBeLessThan(libsIdx2);
  });

  it("filters non-HTTP library URLs", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, [
      "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js",
      "javascript:alert(1)",
      "data:text/javascript,alert(1)",
    ]);
    expect(doc).toContain("cdn.jsdelivr.net");
    expect(doc).not.toContain("javascript:alert");
    expect(doc).not.toContain("data:text/javascript");
  });

  it("handles empty library array", () => {
    const doc = buildDocument("<div></div>", undefined, "alert('hi')", []);
    expect(doc).toContain("No libraries, running immediately");
  });

  // ── User JS execution ──────────────────────────────────────────────

  it("executes user JS via script tag injection (global scope)", () => {
    const doc = buildDocument("<div></div>", undefined, "const renderer = 1;", undefined);
    // User JS should be injected via createElement("script"), not inline try/catch
    expect(doc).toContain('document.createElement("script")');
    expect(doc).toContain("s.textContent");
    expect(doc).toContain("document.body.appendChild(s)");
  });

  it("signals jarble:ready before user JS executes", () => {
    const doc = buildDocument("<div></div>", undefined, "init();", undefined);
    const readyIdx = doc.indexOf('{ type: "jarble:ready" }');
    const jsIdx = doc.indexOf("document.body.appendChild(s)");
    expect(readyIdx).toBeGreaterThan(-1);
    expect(jsIdx).toBeGreaterThan(-1);
    expect(readyIdx).toBeLessThan(jsIdx);
  });

  it("handles empty user JS gracefully", () => {
    const doc = buildDocument("<div></div>", undefined, "", undefined);
    // Should not inject a script tag for empty JS
    expect(doc).toContain("jarble:ready");
  });

  it("uses custom logPrefix", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined, {
      logPrefix: "[Test:Custom]",
    });
    expect(doc).toContain("[Test:Custom]");
  });

  // ── Theme CSS ───────────────────────────────────────────────────────

  it("includes base theme CSS", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("color-scheme: light dark");
    expect(doc).toContain("system-ui");
    expect(doc).toContain("box-sizing: border-box");
    expect(doc).toContain("background: transparent");
  });

  it("includes canvas full-size CSS", () => {
    const doc = buildDocument("<div></div>", undefined, undefined, undefined);
    expect(doc).toContain("canvas { display: block");
    expect(doc).toContain("max-width: 100%");
    expect(doc).toContain("max-height: 100%");
  });
});
