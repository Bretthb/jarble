/**
 * Tests for uiBlockParser — fenced block extraction from bot text.
 *
 * Covers: extractUIBlocks, extractUIUpdates, extractComponentDefs,
 * extractAllUIBlocks, validateLibraryUrl, sanitizeLibraries,
 * TRUSTED_CDN_ORIGINS, and the brace-depth JSON extractor.
 */
import { describe, it, expect, vi } from "vitest";

// Mock logger
vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
  createModuleLogger: () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() }),
}));

import {
  extractUIBlocks,
  extractUIUpdates,
  extractComponentDefs,
  extractAllUIBlocks,
  validateLibraryUrl,
  sanitizeLibraries,
  TRUSTED_CDN_ORIGINS,
} from "./uiBlockParser.js";

// ── validateLibraryUrl ─────────────────────────────────────────────────────

describe("validateLibraryUrl", () => {
  it("accepts URLs from all trusted CDN origins", () => {
    expect(validateLibraryUrl("https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js")).toBe(true);
    expect(validateLibraryUrl("https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js")).toBe(true);
    expect(validateLibraryUrl("https://unpkg.com/react@18/umd/react.production.min.js")).toBe(true);
    expect(validateLibraryUrl("https://cdn.tailwindcss.com")).toBe(true);
    expect(validateLibraryUrl("https://esm.sh/three")).toBe(true);
    expect(validateLibraryUrl("https://threejs.org/build/three.min.js")).toBe(true);
    expect(validateLibraryUrl("https://d3js.org/d3.v7.min.js")).toBe(true);
    expect(validateLibraryUrl("https://cdn.plot.ly/plotly-latest.min.js")).toBe(true);
    expect(validateLibraryUrl("https://fonts.googleapis.com/css2?family=Roboto")).toBe(true);
    expect(validateLibraryUrl("https://fonts.gstatic.com/s/roboto/v30/font.woff2")).toBe(true);
  });

  it("rejects URLs from untrusted origins", () => {
    expect(validateLibraryUrl("https://evil.com/malware.js")).toBe(false);
    expect(validateLibraryUrl("https://example.com/script.js")).toBe(false);
  });

  it("rejects subdomain spoofing attempts", () => {
    expect(validateLibraryUrl("https://cdn.jsdelivr.net.evil.com/script.js")).toBe(false);
  });

  it("rejects HTTP (non-HTTPS) URLs", () => {
    expect(validateLibraryUrl("http://cdn.jsdelivr.net/npm/three")).toBe(false);
    expect(validateLibraryUrl("http://cdnjs.cloudflare.com/script.js")).toBe(false);
  });

  it("rejects non-URL strings", () => {
    expect(validateLibraryUrl("not a url")).toBe(false);
    expect(validateLibraryUrl("")).toBe(false);
  });

  it("rejects dangerous protocols", () => {
    expect(validateLibraryUrl("javascript:alert(1)")).toBe(false);
    expect(validateLibraryUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(validateLibraryUrl("file:///etc/passwd")).toBe(false);
    expect(validateLibraryUrl("ftp://cdn.jsdelivr.net/file")).toBe(false);
  });
});

// ── sanitizeLibraries ──────────────────────────────────────────────────────

describe("sanitizeLibraries", () => {
  it("filters to only trusted URLs", () => {
    const input = [
      "https://cdn.jsdelivr.net/npm/three",
      "https://evil.com/script.js",
      "https://unpkg.com/react",
    ];
    const result = sanitizeLibraries(input);
    expect(result).toEqual([
      "https://cdn.jsdelivr.net/npm/three",
      "https://unpkg.com/react",
    ]);
  });

  it("returns empty array for non-array input", () => {
    expect(sanitizeLibraries(null)).toEqual([]);
    expect(sanitizeLibraries(undefined)).toEqual([]);
    expect(sanitizeLibraries("string")).toEqual([]);
    expect(sanitizeLibraries(42)).toEqual([]);
    expect(sanitizeLibraries({})).toEqual([]);
  });

  it("filters out non-string entries", () => {
    const input = ["https://cdn.jsdelivr.net/npm/three", 42, null, true];
    const result = sanitizeLibraries(input);
    expect(result).toEqual(["https://cdn.jsdelivr.net/npm/three"]);
  });

  it("returns empty array for empty input", () => {
    expect(sanitizeLibraries([])).toEqual([]);
  });

  it("returns all items when all are trusted", () => {
    const input = [
      "https://cdn.jsdelivr.net/npm/three",
      "https://cdnjs.cloudflare.com/ajax/libs/d3.js",
    ];
    expect(sanitizeLibraries(input)).toHaveLength(2);
  });
});

// ── TRUSTED_CDN_ORIGINS ────────────────────────────────────────────────────

describe("TRUSTED_CDN_ORIGINS", () => {
  it("is a Set", () => {
    expect(TRUSTED_CDN_ORIGINS).toBeInstanceOf(Set);
  });

  it("contains expected CDN origins", () => {
    expect(TRUSTED_CDN_ORIGINS.has("https://cdn.jsdelivr.net")).toBe(true);
    expect(TRUSTED_CDN_ORIGINS.has("https://cdnjs.cloudflare.com")).toBe(true);
    expect(TRUSTED_CDN_ORIGINS.has("https://unpkg.com")).toBe(true);
    expect(TRUSTED_CDN_ORIGINS.has("https://esm.sh")).toBe(true);
    expect(TRUSTED_CDN_ORIGINS.has("https://threejs.org")).toBe(true);
  });

  it("has exactly 10 origins", () => {
    expect(TRUSTED_CDN_ORIGINS.size).toBe(10);
  });

  it("does not contain untrusted origins", () => {
    expect(TRUSTED_CDN_ORIGINS.has("https://evil.com")).toBe(false);
    expect(TRUSTED_CDN_ORIGINS.has("http://cdn.jsdelivr.net")).toBe(false);
  });
});

// ── extractUIBlocks ──────────────────────────────────────────────────────────

describe("extractUIBlocks", () => {
  it("extracts a single jarble_ui block", () => {
    const text = `Here is a chart:\n\`\`\`jarble_ui\n{"component":"chart","props":{"type":"bar","data":[]}}\n\`\`\`\nDone.`;
    const { cleanText, uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].component).toBe("chart");
    expect(uiBlocks[0].props).toEqual({ type: "bar", data: [] });
    expect(cleanText).toBe("Here is a chart:\n\nDone.");
  });

  it("extracts multiple jarble_ui blocks", () => {
    const text = [
      "```jarble_ui",
      '{"component":"card","props":{"title":"A"}}',
      "```",
      "text between",
      "```jarble_ui",
      '{"component":"card","props":{"title":"B"}}',
      "```",
    ].join("\n");
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(2);
    expect(uiBlocks[0].props.title).toBe("A");
    expect(uiBlocks[1].props.title).toBe("B");
  });

  it("preserves editable and fileId fields", () => {
    const text = '```jarble_ui\n{"component":"code_editor","props":{"code":"x=1"},"editable":true,"fileId":"main.py"}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].editable).toBe(true);
    expect(uiBlocks[0].fileId).toBe("main.py");
  });

  it("does not set editable when false", () => {
    const text = '```jarble_ui\n{"component":"card","props":{},"editable":false}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].editable).toBeUndefined();
  });

  it("handles saveMethod chat", () => {
    const text = '```jarble_ui\n{"component":"card","props":{},"saveMethod":"chat"}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].saveMethod).toBe("chat");
  });

  it("does not set saveMethod for non-chat values", () => {
    const text = '```jarble_ui\n{"component":"card","props":{},"saveMethod":"other"}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].saveMethod).toBeUndefined();
  });

  it("handles all valid layout_hint values", () => {
    const hints = ["full-width", "half", "third", "compact", "auto"];
    for (const hint of hints) {
      const text = `\`\`\`jarble_ui\n{"component":"card","props":{},"layout_hint":"${hint}"}\n\`\`\``;
      const { uiBlocks } = extractUIBlocks(text);
      expect(uiBlocks[0].layoutHint).toBe(hint);
    }
  });

  it("ignores invalid layout_hint values", () => {
    const text = '```jarble_ui\n{"component":"card","props":{},"layout_hint":"huge"}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].layoutHint).toBeUndefined();
  });

  it("handles dashboardId and dashboardTitle fields", () => {
    const text = '```jarble_ui\n{"component":"card","props":{},"dashboardId":"dash-1","dashboardTitle":"My Dashboard"}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].dashboardId).toBe("dash-1");
    expect(uiBlocks[0].dashboardTitle).toBe("My Dashboard");
  });

  it("leaves invalid JSON as visible text", () => {
    const text = "```jarble_ui\n{invalid json}\n```";
    const { cleanText, uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
    expect(cleanText).toContain("{invalid json}");
  });

  it("leaves blocks missing component or props as text", () => {
    const text = '```jarble_ui\n{"component":"chart"}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
  });

  it("skips blocks with non-string component", () => {
    const text = '```jarble_ui\n{"component":42,"props":{}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
  });

  it("skips blocks with null props", () => {
    const text = '```jarble_ui\n{"component":"card","props":null}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
  });

  it("does NOT match jarble_ui_update blocks", () => {
    const text = '```jarble_ui_update\n{"card_id":"x","props":{"title":"Y"}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
  });

  it("does NOT match jarble_ui_define blocks", () => {
    const text = '```jarble_ui_define\n{"name":"foo","layout":[{"component":"card","props":{}}]}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
  });

  it("enforces MAX_BLOCKS (20)", () => {
    const blocks = Array.from({ length: 25 }, (_, i) =>
      `\`\`\`jarble_ui\n{"component":"card","props":{"title":"${i}"}}\n\`\`\``
    ).join("\n");
    const { uiBlocks } = extractUIBlocks(blocks);
    expect(uiBlocks).toHaveLength(20);
  });

  it("generates unique IDs for each block", () => {
    const text = [
      '```jarble_ui\n{"component":"card","props":{"title":"A"}}\n```',
      '```jarble_ui\n{"component":"card","props":{"title":"B"}}\n```',
    ].join("\n");
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].id).not.toBe(uiBlocks[1].id);
  });

  it("returns empty arrays for empty input", () => {
    const { cleanText, uiBlocks } = extractUIBlocks("");
    expect(uiBlocks).toHaveLength(0);
    expect(cleanText).toBe("");
  });

  it("returns text as-is when no blocks present", () => {
    const text = "Just regular text with no blocks.";
    const { cleanText, uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
    expect(cleanText).toBe(text);
  });

  it("skips blocks exceeding MAX_BLOCK_SIZE (100KB)", () => {
    const huge = "x".repeat(110_000);
    const text = `\`\`\`jarble_ui\n{"component":"card","props":{"body":"${huge}"}}\n\`\`\``;
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
  });

  it("handles incomplete/streaming blocks", () => {
    const text = '```jarble_ui\n{"component":"card","props":{"title":"Inc';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
  });

  it("handles block without closing backticks", () => {
    const text = '```jarble_ui\n{"component":"card","props":{"title":"A"}}';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].component).toBe("card");
  });

  it("collapses triple newlines in clean text", () => {
    const text = 'Before\n\n\n```jarble_ui\n{"component":"card","props":{}}\n```\n\n\nAfter';
    const { cleanText } = extractUIBlocks(text);
    expect(cleanText).not.toContain("\n\n\n");
  });

  it("trims clean text", () => {
    const text = '  \n```jarble_ui\n{"component":"card","props":{}}\n```\n  ';
    const { cleanText } = extractUIBlocks(text);
    expect(cleanText).toBe(cleanText.trim());
  });
});

// ── Library URL sanitization in extractUIBlocks ────────────────────────────

describe("library URL sanitization in blocks", () => {
  it("sanitizes library URLs in sandbox blocks", () => {
    const text = `\`\`\`jarble_ui
{"component":"sandbox","props":{"html":"<div>Hi</div>","libraries":["https://cdn.jsdelivr.net/npm/three","https://evil.com/malware.js"]}}
\`\`\``;
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].props.libraries).toEqual(["https://cdn.jsdelivr.net/npm/three"]);
  });

  it("passes through all trusted library URLs", () => {
    const text = `\`\`\`jarble_ui
{"component":"sandbox","props":{"html":"<div/>","libraries":["https://cdn.jsdelivr.net/npm/three","https://cdnjs.cloudflare.com/d3.js"]}}
\`\`\``;
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].props.libraries).toHaveLength(2);
  });

  it("does not touch props without libraries field", () => {
    const text = '```jarble_ui\n{"component":"card","props":{"title":"No libs"}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].props.libraries).toBeUndefined();
  });

  it("replaces libraries with empty array when all are untrusted", () => {
    const text = `\`\`\`jarble_ui
{"component":"sandbox","props":{"html":"<div/>","libraries":["https://evil.com/a.js","https://bad.com/b.js"]}}
\`\`\``;
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks[0].props.libraries).toEqual([]);
  });
});

// ── Brace-depth JSON extractor edge cases ──────────────────────────────────

describe("brace-depth JSON extractor", () => {
  it("handles nested objects in JSON", () => {
    const text = '```jarble_ui\n{"component":"card","props":{"meta":{"nested":{"deep":true}}}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect((uiBlocks[0].props as any).meta.nested.deep).toBe(true);
  });

  it("handles strings containing braces", () => {
    const text = '```jarble_ui\n{"component":"code_block","props":{"code":"function() { return {}; }","language":"js"}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].props.code).toContain("function()");
  });

  it("handles strings containing escaped quotes", () => {
    const text = '```jarble_ui\n{"component":"card","props":{"body":"He said \\"hello\\""}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].props.body).toContain('He said "hello"');
  });

  it("handles arrays in JSON", () => {
    const text = '```jarble_ui\n{"component":"data_table","props":{"columns":["A","B"],"rows":[["1","2"],["3","4"]]}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect((uiBlocks[0].props.rows as any[][])).toHaveLength(2);
  });

  it("handles JSON with special characters in strings (newlines, tabs)", () => {
    const text = '```jarble_ui\n{"component":"card","props":{"title":"Hello\\nWorld\\t!"}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
  });

  it("handles code blocks containing triple backticks in JSON strings", () => {
    const codeContent = "```python\\ndef hello():\\n    pass\\n```";
    const text = `\`\`\`jarble_ui\n{"component":"code_block","props":{"code":"${codeContent}","language":"markdown"}}\n\`\`\``;
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].component).toBe("code_block");
  });

  it("handles empty string values", () => {
    const text = '```jarble_ui\n{"component":"card","props":{"title":"","body":""}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].props.title).toBe("");
  });

  it("handles numeric and boolean values", () => {
    const text = '```jarble_ui\n{"component":"progress","props":{"value":75,"showLabel":true}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].props.value).toBe(75);
    expect(uiBlocks[0].props.showLabel).toBe(true);
  });

  it("handles null values in JSON", () => {
    const text = '```jarble_ui\n{"component":"card","props":{"title":"Test","subtitle":null}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].props.subtitle).toBeNull();
  });
});

// ── Marker boundary detection ──────────────────────────────────────────────

describe("marker boundary detection", () => {
  it("requires whitespace/newline after jarble_ui marker", () => {
    const text = '```jarble_ui_custom\n{"component":"card","props":{}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(0);
  });

  it("matches jarble_ui followed by newline", () => {
    const text = '```jarble_ui\n{"component":"card","props":{}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
  });

  it("matches jarble_ui followed by space", () => {
    const text = '```jarble_ui {"component":"card","props":{}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
  });

  it("matches jarble_ui followed by tab", () => {
    const text = '```jarble_ui\t{"component":"card","props":{}}\n```';
    const { uiBlocks } = extractUIBlocks(text);
    expect(uiBlocks).toHaveLength(1);
  });
});

// ── extractUIUpdates ─────────────────────────────────────────────────────────

describe("extractUIUpdates", () => {
  it("extracts a single update block", () => {
    const text = '```jarble_ui_update\n{"card_id":"card-abc","props":{"title":"Updated"}}\n```';
    const { cleanText, uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates).toHaveLength(1);
    expect(uiUpdates[0].cardId).toBe("card-abc");
    expect(uiUpdates[0].props).toEqual({ title: "Updated" });
    expect(uiUpdates[0].merge).toBe(true); // default
    expect(cleanText).toBe("");
  });

  it("respects merge: false", () => {
    const text = '```jarble_ui_update\n{"card_id":"x","props":{"html":"<div>"},"merge":false}\n```';
    const { uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates[0].merge).toBe(false);
  });

  it("captures optional component field for type changes", () => {
    const text = '```jarble_ui_update\n{"card_id":"x","props":{},"component":"sandbox"}\n```';
    const { uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates[0].component).toBe("sandbox");
  });

  it("does not include component when not present", () => {
    const text = '```jarble_ui_update\n{"card_id":"x","props":{}}\n```';
    const { uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates[0].component).toBeUndefined();
  });

  it("leaves invalid update blocks as text", () => {
    const text = '```jarble_ui_update\n{"props":{"title":"no card_id"}}\n```';
    const { uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates).toHaveLength(0);
  });

  it("skips blocks with missing props", () => {
    const text = '```jarble_ui_update\n{"card_id":"x"}\n```';
    const { uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates).toHaveLength(0);
  });

  it("skips blocks with null props", () => {
    const text = '```jarble_ui_update\n{"card_id":"x","props":null}\n```';
    const { uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates).toHaveLength(0);
  });

  it("extracts multiple update blocks", () => {
    const text = [
      '```jarble_ui_update\n{"card_id":"a","props":{"v":1}}\n```',
      '```jarble_ui_update\n{"card_id":"b","props":{"v":2}}\n```',
    ].join("\n");
    const { uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates).toHaveLength(2);
  });

  it("enforces MAX_UPDATES (20)", () => {
    const blocks = Array.from({ length: 25 }, (_, i) =>
      `\`\`\`jarble_ui_update\n{"card_id":"card-${i}","props":{}}\n\`\`\``
    ).join("\n");
    const { uiUpdates } = extractUIUpdates(blocks);
    expect(uiUpdates).toHaveLength(20);
  });

  it("skips oversized update blocks", () => {
    const huge = "x".repeat(110_000);
    const text = `\`\`\`jarble_ui_update\n{"card_id":"x","props":{"data":"${huge}"}}\n\`\`\``;
    const { uiUpdates } = extractUIUpdates(text);
    expect(uiUpdates).toHaveLength(0);
  });
});

// ── extractComponentDefs ─────────────────────────────────────────────────────

describe("extractComponentDefs", () => {
  it("extracts a valid component definition", () => {
    const text = [
      "I'll define a component:",
      "```jarble_ui_define",
      JSON.stringify({
        name: "kpi_row",
        description: "Row of KPI metrics",
        layout: [
          { component: "metric_card", props: { label: "{{label1}}", value: "{{value1}}" } },
          { component: "metric_card", props: { label: "{{label2}}", value: "{{value2}}" } },
        ],
      }),
      "```",
      "Now I'll use it.",
    ].join("\n");
    const { cleanText, componentDefs } = extractComponentDefs(text);

    expect(componentDefs).toHaveLength(1);
    expect(componentDefs[0].name).toBe("kpi_row");
    expect(componentDefs[0].description).toBe("Row of KPI metrics");
    expect(componentDefs[0].layout).toHaveLength(2);
    expect(componentDefs[0].layout[0].component).toBe("metric_card");
    expect(componentDefs[0].layout[0].props.label).toBe("{{label1}}");
    expect(cleanText).toBe("I'll define a component:\n\nNow I'll use it.");
  });

  it("rejects invalid component name format — uppercase", () => {
    const text = '```jarble_ui_define\n{"name":"KPI-Row","layout":[{"component":"card","props":{}}]}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
  });

  it("rejects name starting with number", () => {
    const text = '```jarble_ui_define\n{"name":"1bad","layout":[{"component":"card","props":{}}]}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
  });

  it("rejects name with dashes", () => {
    const text = '```jarble_ui_define\n{"name":"my-widget","layout":[{"component":"card","props":{}}]}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
  });

  it("accepts valid names with underscores and numbers", () => {
    const text = '```jarble_ui_define\n{"name":"my_comp_2","layout":[{"component":"card","props":{}}]}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(1);
    expect(componentDefs[0].name).toBe("my_comp_2");
  });

  it("accepts single-letter names", () => {
    const text = '```jarble_ui_define\n{"name":"a","layout":[{"component":"card","props":{}}]}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(1);
  });

  it("rejects missing layout", () => {
    const text = '```jarble_ui_define\n{"name":"foo"}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
  });

  it("rejects non-array layout", () => {
    const text = '```jarble_ui_define\n{"name":"foo","layout":"not_array"}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
  });

  it("strips description if not a string", () => {
    const text = '```jarble_ui_define\n{"name":"foo","description":42,"layout":[{"component":"card","props":{}}]}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(1);
    expect(componentDefs[0].description).toBeUndefined();
  });

  it("rejects missing name", () => {
    const text = '```jarble_ui_define\n{"layout":[{"component":"card","props":{}}]}\n```';
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
  });

  it("extracts multiple definitions", () => {
    const text = [
      '```jarble_ui_define\n{"name":"comp_a","layout":[{"component":"card","props":{}}]}\n```',
      '```jarble_ui_define\n{"name":"comp_b","layout":[{"component":"list","props":{}}]}\n```',
    ].join("\nsome text\n");
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(2);
    expect(componentDefs[0].name).toBe("comp_a");
    expect(componentDefs[1].name).toBe("comp_b");
  });

  it("enforces MAX_DEFS (5)", () => {
    const blocks = Array.from({ length: 8 }, (_, i) =>
      `\`\`\`jarble_ui_define\n{"name":"comp_${String.fromCharCode(97 + i)}","layout":[{"component":"card","props":{}}]}\n\`\`\``
    ).join("\n");
    const { componentDefs } = extractComponentDefs(blocks);
    expect(componentDefs).toHaveLength(5);
  });

  it("leaves invalid JSON as visible text", () => {
    const text = "```jarble_ui_define\n{broken json\n```";
    const { cleanText, componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
    expect(cleanText).toContain("{broken json");
  });

  it("skips oversized define blocks", () => {
    const huge = "x".repeat(110_000);
    const text = `\`\`\`jarble_ui_define\n{"name":"big","layout":[{"component":"card","props":{"data":"${huge}"}}]}\n\`\`\``;
    const { componentDefs } = extractComponentDefs(text);
    expect(componentDefs).toHaveLength(0);
  });
});

// ── extractAllUIBlocks (integration) ─────────────────────────────────────────

describe("extractAllUIBlocks", () => {
  it("handles all three block types in one message", () => {
    const text = [
      "Let me define and use a component.",
      "```jarble_ui_define",
      JSON.stringify({
        name: "status_row",
        layout: [
          { component: "metric_card", props: { label: "{{label}}", value: "{{value}}" } },
        ],
      }),
      "```",
      "Now rendering:",
      '```jarble_ui\n{"component":"status_row","props":{"label":"Users","value":"1234"}}\n```',
      "And updating an existing card:",
      '```jarble_ui_update\n{"card_id":"card-xyz","props":{"title":"Refreshed"}}\n```',
    ].join("\n");

    const { cleanText, uiBlocks, uiUpdates, componentDefs } = extractAllUIBlocks(text);

    expect(componentDefs).toHaveLength(1);
    expect(componentDefs[0].name).toBe("status_row");

    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].component).toBe("status_row");
    expect(uiBlocks[0].props).toEqual({ label: "Users", value: "1234" });

    expect(uiUpdates).toHaveLength(1);
    expect(uiUpdates[0].cardId).toBe("card-xyz");

    expect(cleanText).toBe("Let me define and use a component.\n\nNow rendering:\n\nAnd updating an existing card:");
  });

  it("processes define before render (order matters)", () => {
    const text = [
      '```jarble_ui_define\n{"name":"widget","layout":[{"component":"card","props":{"body":"{{text}}"}}]}\n```',
      '```jarble_ui\n{"component":"widget","props":{"text":"hello"}}\n```',
    ].join("\n");

    const { componentDefs, uiBlocks } = extractAllUIBlocks(text);
    expect(componentDefs).toHaveLength(1);
    expect(uiBlocks).toHaveLength(1);
    expect(uiBlocks[0].component).toBe("widget");
  });

  it("returns empty arrays when no blocks present", () => {
    const text = "Just plain text with no UI blocks.";
    const { cleanText, uiBlocks, uiUpdates, componentDefs } = extractAllUIBlocks(text);
    expect(cleanText).toBe("Just plain text with no UI blocks.");
    expect(uiBlocks).toHaveLength(0);
    expect(uiUpdates).toHaveLength(0);
    expect(componentDefs).toHaveLength(0);
  });

  it("handles empty text", () => {
    const result = extractAllUIBlocks("");
    expect(result.cleanText).toBe("");
    expect(result.uiBlocks).toHaveLength(0);
    expect(result.uiUpdates).toHaveLength(0);
    expect(result.componentDefs).toHaveLength(0);
  });

  it("cleans up triple+ newlines from stripped blocks", () => {
    const text = "Before\n\n```jarble_ui\n" +
      '{"component":"card","props":{"title":"x"}}\n' +
      "```\n\n\n\nAfter";
    const { cleanText } = extractAllUIBlocks(text);
    expect(cleanText).not.toMatch(/\n{3,}/);
  });
});
