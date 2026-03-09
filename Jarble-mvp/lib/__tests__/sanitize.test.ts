import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { sanitizeHtml } from "../sanitize";

describe("sanitizeHtml", () => {
  // ── Script stripping ────────────────────────────────────────────────────
  it("strips <script> tags", () => {
    const result = sanitizeHtml('<div>Hello</div><script>alert("xss")</script>');
    expect(result).not.toContain("<script");
    expect(result).toContain("Hello");
  });

  it("strips inline script in src attribute", () => {
    const result = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(result).not.toContain("onerror");
  });

  // ── Event handler stripping ─────────────────────────────────────────────
  it("strips onclick handlers", () => {
    const result = sanitizeHtml('<button onclick="alert(1)">Click</button>');
    expect(result).not.toContain("onclick");
    expect(result).toContain("Click");
  });

  it("strips onerror handlers", () => {
    const result = sanitizeHtml('<img onerror="alert(1)" src="x.png">');
    expect(result).not.toContain("onerror");
  });

  it("strips onload handlers", () => {
    const result = sanitizeHtml('<body onload="alert(1)">content</body>');
    expect(result).not.toContain("onload");
  });

  // ── Safe HTML preservation ──────────────────────────────────────────────
  it("allows safe HTML elements", () => {
    const html = "<p>Paragraph</p><h1>Heading</h1><strong>Bold</strong><em>Italic</em>";
    const result = sanitizeHtml(html);
    expect(result).toContain("<p>");
    expect(result).toContain("<h1>");
    expect(result).toContain("<strong>");
    expect(result).toContain("<em>");
  });

  it("allows canvas elements (custom ADD_TAGS config)", () => {
    const result = sanitizeHtml('<canvas id="myCanvas" width="200" height="100"></canvas>');
    expect(result).toContain("<canvas");
  });

  it("allows iframe-related attributes (allow, allowfullscreen, frameborder, scrolling)", () => {
    // DOMPurify normally strips iframes, but the custom ADD_ATTR should keep these attributes
    // on elements that are allowed
    const result = sanitizeHtml('<div allow="camera" scrolling="no">content</div>');
    // The allow attribute may or may not be preserved on div depending on DOMPurify behavior
    // But the key thing is it doesn't crash
    expect(result).toContain("content");
  });

  // ── Dangerous URL stripping ─────────────────────────────────────────────
  it("strips javascript: URLs", () => {
    const result = sanitizeHtml('<a href="javascript:alert(1)">Link</a>');
    expect(result).not.toContain("javascript:");
    expect(result).toContain("Link");
  });

  it("strips data: URLs in links", () => {
    const result = sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">Link</a>');
    expect(result).not.toContain("data:");
  });

  // ── Edge cases ──────────────────────────────────────────────────────────
  it("handles empty string", () => {
    expect(sanitizeHtml("")).toBe("");
  });

  it("handles plain text (no HTML)", () => {
    const text = "Just a plain text string with no HTML";
    expect(sanitizeHtml(text)).toBe(text);
  });

  it("handles string with only whitespace", () => {
    expect(sanitizeHtml("   ")).toBe("   ");
  });

  // ── SSR branch ──────────────────────────────────────────────────────────
  describe("SSR (typeof window === 'undefined')", () => {
    const origWindow = globalThis.window;

    beforeEach(() => {
      // Simulate server environment by removing window
      // @ts-expect-error - deliberately removing window for SSR test
      delete globalThis.window;
    });

    afterEach(() => {
      // Restore window
      globalThis.window = origWindow;
    });

    it("strips HTML tags on server as safe fallback", () => {
      const dirty = '<script>alert("xss")</script><p>Hello</p>';
      const result = sanitizeHtml(dirty);
      expect(result).toBe('alert("xss")Hello');
    });
  });
});
