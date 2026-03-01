import { describe, it, expect } from "vitest";
import {
  validateLibraryUrl,
  sanitizeLibraries,
  TRUSTED_CDN_ORIGINS,
  extractUIBlocks,
} from "../uiBlockParser.js";

// ── validateLibraryUrl ──────────────────────────────────────────────────────

describe("validateLibraryUrl", () => {
  it("accepts valid CDN URLs from each trusted domain", () => {
    const validUrls = [
      "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js",
      "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
      "https://unpkg.com/react@18/umd/react.production.min.js",
      "https://cdn.tailwindcss.com/3.4.1",
      "https://esm.sh/react@18",
      "https://threejs.org/build/three.module.js",
      "https://d3js.org/d3.v7.min.js",
      "https://cdn.plot.ly/plotly-latest.min.js",
      "https://fonts.googleapis.com/css2?family=Inter",
      "https://fonts.gstatic.com/s/inter/v13/font.woff2",
    ];
    for (const url of validUrls) {
      expect(validateLibraryUrl(url)).toBe(true);
    }
  });

  it("rejects HTTP URLs (must be HTTPS)", () => {
    expect(validateLibraryUrl("http://cdn.jsdelivr.net/npm/d3@7")).toBe(false);
    expect(validateLibraryUrl("http://unpkg.com/react@18")).toBe(false);
  });

  it("rejects unknown domains", () => {
    expect(validateLibraryUrl("https://evil.com/malware.js")).toBe(false);
    expect(validateLibraryUrl("https://cdn.example.com/lib.js")).toBe(false);
    expect(validateLibraryUrl("https://attacker.jsdelivr.net/exploit.js")).toBe(false);
  });

  it("rejects malformed URLs", () => {
    expect(validateLibraryUrl("not-a-url")).toBe(false);
    expect(validateLibraryUrl("")).toBe(false);
    expect(validateLibraryUrl("https://")).toBe(false);
    expect(validateLibraryUrl("javascript:alert(1)")).toBe(false);
    expect(validateLibraryUrl("data:text/javascript,alert(1)")).toBe(false);
  });

  it("rejects protocol-relative URLs", () => {
    expect(validateLibraryUrl("//cdn.jsdelivr.net/npm/d3")).toBe(false);
  });
});

// ── TRUSTED_CDN_ORIGINS ─────────────────────────────────────────────────────

describe("TRUSTED_CDN_ORIGINS", () => {
  it("contains exactly 10 trusted origins", () => {
    expect(TRUSTED_CDN_ORIGINS.size).toBe(10);
  });

  it("is a Set for O(1) lookups", () => {
    expect(TRUSTED_CDN_ORIGINS).toBeInstanceOf(Set);
  });
});

// ── sanitizeLibraries ───────────────────────────────────────────────────────

describe("sanitizeLibraries", () => {
  it("filters out non-string items", () => {
    const result = sanitizeLibraries([
      "https://cdn.jsdelivr.net/npm/d3@7",
      42,
      null,
      undefined,
      true,
      { url: "https://cdn.jsdelivr.net/bad" },
    ]);
    expect(result).toEqual(["https://cdn.jsdelivr.net/npm/d3@7"]);
  });

  it("filters out untrusted URLs from the array", () => {
    const result = sanitizeLibraries([
      "https://cdn.jsdelivr.net/npm/d3@7",
      "https://evil.com/malware.js",
      "https://unpkg.com/react@18",
      "http://cdn.jsdelivr.net/insecure",
    ]);
    expect(result).toEqual([
      "https://cdn.jsdelivr.net/npm/d3@7",
      "https://unpkg.com/react@18",
    ]);
  });

  it("returns empty array for non-array input", () => {
    expect(sanitizeLibraries(undefined)).toEqual([]);
    expect(sanitizeLibraries(null)).toEqual([]);
    expect(sanitizeLibraries("not-an-array")).toEqual([]);
    expect(sanitizeLibraries(42)).toEqual([]);
    expect(sanitizeLibraries({})).toEqual([]);
  });

  it("returns empty array for empty array input", () => {
    expect(sanitizeLibraries([])).toEqual([]);
  });

  it("passes through all valid URLs unchanged", () => {
    const urls = [
      "https://cdn.jsdelivr.net/npm/d3@7",
      "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",
      "https://esm.sh/react@18",
    ];
    expect(sanitizeLibraries(urls)).toEqual(urls);
  });
});

// ── extractUIBlocks integration (library filtering) ─────────────────────────

describe("extractUIBlocks — sandbox library filtering", () => {
  it("filters untrusted library URLs from sandbox blocks", () => {
    const text = [
      "```jarble_ui",
      JSON.stringify({
        component: "sandbox",
        props: {
          html: "<div>Hello</div>",
          libraries: [
            "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js",
            "https://evil.com/malware.js",
            "https://unpkg.com/three@0.150.0/build/three.module.js",
          ],
        },
      }),
      "```",
    ].join("\n");

    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].component).toBe("sandbox");
    expect(uiBlocks[0].props.libraries).toEqual([
      "https://cdn.jsdelivr.net/npm/d3@7/dist/d3.min.js",
      "https://unpkg.com/three@0.150.0/build/three.module.js",
    ]);
  });

  it("does not reject the block when all libraries are invalid", () => {
    const text = [
      "```jarble_ui",
      JSON.stringify({
        component: "sandbox",
        props: {
          html: "<canvas></canvas>",
          libraries: [
            "https://evil.com/bad.js",
            "http://cdn.jsdelivr.net/insecure.js",
          ],
        },
      }),
      "```",
    ].join("\n");

    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].props.libraries).toEqual([]);
  });

  it("does not touch blocks without libraries prop", () => {
    const text = [
      "```jarble_ui",
      JSON.stringify({
        component: "card",
        props: { title: "Hello", body: "World" },
      }),
      "```",
    ].join("\n");

    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].props.libraries).toBeUndefined();
  });

  it("sanitizes libraries on any component type that has them", () => {
    const text = [
      "```jarble_ui",
      JSON.stringify({
        component: "custom_widget",
        props: {
          html: "<div></div>",
          libraries: [
            "https://esm.sh/chart.js",
            "https://malicious-cdn.com/inject.js",
          ],
        },
      }),
      "```",
    ].join("\n");

    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].props.libraries).toEqual(["https://esm.sh/chart.js"]);
  });
});
