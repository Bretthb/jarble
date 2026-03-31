/**
 * Tests for qaValidators - QA pipeline for composed component blocks.
 *
 * Covers: validateCspCompliance, validateHtmlIntegrity, validateNativeProps,
 * validateDataConsistency, runPipelineQA.
 */
import { describe, it, expect } from "vitest";

import {
  validateCspCompliance,
  validateHtmlIntegrity,
  validateNativeProps,
  validateDataConsistency,
  runPipelineQA,
} from "./qaValidators.js";

// ── validateCspCompliance ──────────────────────────────────────────────────

describe("validateCspCompliance", () => {
  it("passes for clean HTML with no scripts", () => {
    const result = validateCspCompliance("<div>Hello world</div>");
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.fixes).toHaveLength(0);
    expect(result.validator).toBe("csp_compliance");
  });

  it("passes for scripts from trusted CDN origins", () => {
    const html = `
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.8.5/d3.min.js"></script>
      <script src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
      <script src="https://cdn.tailwindcss.com"></script>
      <div>Content</div>
    `;
    const result = validateCspCompliance(html);
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("detects script from non-CDN origin", () => {
    const html = `<script src="https://evil.com/malware.js"></script>`;
    const result = validateCspCompliance(html);
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("non-CDN origin"),
    );
  });

  it("detects multiple non-CDN scripts", () => {
    const html = `
      <script src="https://evil.com/a.js"></script>
      <script src="https://cdn.jsdelivr.net/npm/three"></script>
      <script src="https://attacker.org/b.js"></script>
    `;
    const result = validateCspCompliance(html);
    expect(result.passed).toBe(false);
    expect(result.warnings).toHaveLength(2);
  });

  it("detects inline event handlers (onclick)", () => {
    const html = `<button onclick="doStuff()">Click</button>`;
    const result = validateCspCompliance(html);
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Inline event handlers"),
    );
    expect(result.fixes).toContainEqual(
      expect.stringContaining("Stripped inline event handlers"),
    );
    // Verify the handler was removed from cleaned HTML
    expect(result.details?.cleanedHtml).toBeDefined();
    expect(result.details!.cleanedHtml as string).not.toContain("onclick=");
  });

  it("detects inline onload handler", () => {
    const html = `<body onload="init()">Content</body>`;
    const result = validateCspCompliance(html);
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Inline event handlers"),
    );
  });

  it("detects eval() usage", () => {
    const html = `<script>eval("alert(1)")</script>`;
    const result = validateCspCompliance(html);
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("eval()"),
    );
  });

  it("detects new Function() usage", () => {
    const html = `<script>const fn = new Function("return 1")</script>`;
    const result = validateCspCompliance(html);
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("new Function()"),
    );
  });

  it("detects iframe creation inside sandbox", () => {
    const html = `<div><iframe src="https://evil.com"></iframe></div>`;
    const result = validateCspCompliance(html);
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("iframe creation"),
    );
    expect(result.fixes).toContainEqual(
      expect.stringContaining("Stripped iframe"),
    );
    expect(result.details!.cleanedHtml as string).toContain("<!-- iframe removed -->");
  });

  it("detects document.write() usage", () => {
    const html = `<script>document.write("<h1>bad</h1>")</script>`;
    const result = validateCspCompliance(html);
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("document.write()"),
    );
  });

  it("handles empty string without crashing", () => {
    const result = validateCspCompliance("");
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("reports multiple violations simultaneously", () => {
    const html = `
      <div onclick="bad()">
        <script>eval("x"); document.write("y")</script>
        <iframe src="http://evil.com"></iframe>
      </div>
    `;
    const result = validateCspCompliance(html);
    expect(result.passed).toBe(false);
    // Should have at least: inline handlers, eval, document.write, iframe
    expect(result.warnings.length).toBeGreaterThanOrEqual(4);
  });
});

// ── validateHtmlIntegrity ──────────────────────────────────────────────────

describe("validateHtmlIntegrity", () => {
  it("passes for valid HTML with jarble:ready signal", () => {
    const html = `
      <div>Content</div>
      <script>
        window.parent.postMessage({ type: 'jarble:ready' }, '*');
      </script>
    `;
    const result = validateHtmlIntegrity(html);
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(result.validator).toBe("html_integrity");
  });

  it("detects unclosed script tag", () => {
    const html = `
      <script>console.log("hello")
      <script>window.parent.postMessage({ type: 'jarble:ready' }, '*');</script>
    `;
    const result = validateHtmlIntegrity(html);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Unclosed <script>"),
    );
  });

  it("detects unclosed div tag", () => {
    const html = `
      <div><div>Nested
      <script>window.parent.postMessage({ type: 'jarble:ready' }, '*');</script>
    `;
    const result = validateHtmlIntegrity(html);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Unclosed <div>"),
    );
  });

  it("warns on missing jarble:ready signal", () => {
    const html = `<div>Content</div><script>console.log("hi");</script>`;
    const result = validateHtmlIntegrity(html);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Missing jarble:ready"),
    );
  });

  it("auto-fixes by appending ready signal before last </script>", () => {
    const html = `<div>Hello</div><script>doStuff();</script>`;
    const result = validateHtmlIntegrity(html);
    expect(result.fixes).toContainEqual(
      expect.stringContaining("Appended jarble:ready"),
    );
    const cleaned = result.details!.cleanedHtml as string;
    expect(cleaned).toContain("jarble:ready");
    // The signal should be inserted before the closing script tag
    expect(cleaned).toContain("postMessage");
  });

  it("auto-fixes by wrapping in <script> when no script tag exists", () => {
    const html = `<div>Pure HTML content</div>`;
    const result = validateHtmlIntegrity(html);
    expect(result.fixes).toContainEqual(
      expect.stringContaining("Appended jarble:ready"),
    );
    const cleaned = result.details!.cleanedHtml as string;
    expect(cleaned).toContain("<script>");
    expect(cleaned).toContain("jarble:ready");
  });

  it("still passes when jarble:ready is missing (only that warning)", () => {
    // The passed flag ignores the jarble:ready warning
    const html = `<div>Content</div>`;
    const result = validateHtmlIntegrity(html);
    expect(result.passed).toBe(true); // passed filters out jarble:ready warnings
    expect(result.warnings).toHaveLength(1);
  });

  it("warns on excessive DOM size (>500 tags)", () => {
    const divs = Array.from({ length: 501 }, () => "<div>x</div>").join("");
    const html = `${divs}<script>window.parent.postMessage({ type: 'jarble:ready' }, '*');</script>`;
    const result = validateHtmlIntegrity(html);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Excessive DOM size"),
    );
  });

  it("does not warn on DOM size under 500 tags", () => {
    const divs = Array.from({ length: 100 }, () => "<div>x</div>").join("");
    const html = `${divs}<script>window.parent.postMessage({ type: 'jarble:ready' }, '*');</script>`;
    const result = validateHtmlIntegrity(html);
    expect(result.warnings).toHaveLength(0);
  });

  it("handles empty string without crashing", () => {
    const result = validateHtmlIntegrity("");
    expect(result.passed).toBe(true); // only jarble:ready warning, which is filtered
    expect(result.fixes).toContainEqual(
      expect.stringContaining("Appended jarble:ready"),
    );
  });
});

// ── validateNativeProps ────────────────────────────────────────────────────

describe("validateNativeProps", () => {
  it("passes for valid chart props", () => {
    const result = validateNativeProps("chart", {
      type: "bar",
      data: [{ month: "Jan", sales: 100 }, { month: "Feb", sales: 200 }],
      dataKeys: ["sales"],
      xAxisKey: "month",
    });
    expect(result.passed).toBe(true);
    expect(result.validator).toBe("native_props");
  });

  it("passes for valid data_table props", () => {
    const result = validateNativeProps("data_table", {
      columns: [{ header: "Name", key: "name" }],
      rows: [["Alice"], ["Bob"]],
    });
    expect(result.passed).toBe(true);
  });

  it("detects empty data_table rows", () => {
    const result = validateNativeProps("data_table", {
      columns: [{ header: "Name", key: "name" }],
      rows: [],
    });
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("empty rows"),
    );
  });

  it("detects missing data_table columns", () => {
    const result = validateNativeProps("data_table", {
      rows: [["Alice"]],
    });
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("missing columns"),
    );
  });

  it("detects empty chart data", () => {
    const result = validateNativeProps("chart", {
      type: "bar",
      data: [],
      dataKeys: ["sales"],
    });
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("empty data"),
    );
  });

  it("auto-derives missing chart dataKeys from data (autofix)", () => {
    // When dataKeys is missing but data has numeric fields, autofixNativeProps
    // derives dataKeys automatically - so the warning does NOT fire
    const result = validateNativeProps("chart", {
      type: "bar",
      data: [{ month: "Jan", sales: 100 }],
    });
    expect(result.passed).toBe(true);
    expect(result.fixes).toContainEqual(
      expect.stringContaining("Auto-fixed"),
    );
    // The derived dataKeys should appear in fixed props
    const fixedProps = result.details?.fixedProps as Record<string, unknown> | undefined;
    expect(fixedProps?.dataKeys).toEqual(["sales"]);
    expect(fixedProps?.xAxisKey).toBe("month");
  });

  it("warns when chart has no data AND no dataKeys", () => {
    // With empty data, autofix cannot derive dataKeys
    const result = validateNativeProps("chart", {
      type: "bar",
      data: [],
    });
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("empty data"),
    );
    expect(result.warnings).toContainEqual(
      expect.stringContaining("missing dataKeys"),
    );
  });

  it("detects empty stat_grid stats", () => {
    const result = validateNativeProps("stat_grid", {
      stats: [],
    });
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("empty stats"),
    );
  });

  it("works without schema (no crash)", () => {
    const result = validateNativeProps("chart", {
      type: "bar",
      data: [{ x: "A", y: 1 }],
      dataKeys: ["y"],
      xAxisKey: "x",
    });
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("reports schema validation errors when schema provided", () => {
    const schema = {
      type: "object",
      required: ["type", "data"],
      properties: {
        type: { type: "string", enum: ["bar", "line", "pie"] },
        data: { type: "array" },
      },
    };
    const result = validateNativeProps(
      "chart",
      { type: "invalid_type", data: [{ x: 1 }], dataKeys: ["x"] },
      schema,
    );
    // Should have schema enum violation
    expect(result.warnings.some((w) => w.includes("enum"))).toBe(true);
  });

  it("reports auto-fix when props are corrected", () => {
    // data_table rows as objects should be auto-fixed to arrays
    const result = validateNativeProps("data_table", {
      columns: [{ header: "Name", key: "name" }],
      rows: [{ name: "Alice" }, { name: "Bob" }],
    });
    expect(result.fixes).toContainEqual(
      expect.stringContaining("Auto-fixed"),
    );
    expect(result.details?.fixedProps).toBeDefined();
  });

  it("auto-fixes stat_grid single stat wrapped in object", () => {
    const result = validateNativeProps("stat_grid", {
      stats: { label: "Revenue", value: "$48K" },
    });
    // autofixNativeProps wraps single stat in array
    expect(result.fixes).toContainEqual(
      expect.stringContaining("Auto-fixed"),
    );
    // After fix, stats should be an array with one item, not empty
    expect(result.passed).toBe(true);
  });
});

// ── validateDataConsistency ────────────────────────────────────────────────

describe("validateDataConsistency", () => {
  it("passes when metrics are consistent across components", () => {
    const blocks = [
      {
        type: "native" as const,
        component: "stat_grid",
        props: {
          stats: [
            { label: "Revenue", value: "$48K" },
            { label: "Users", value: "1200" },
          ],
        },
      },
      {
        type: "native" as const,
        component: "metric_card",
        props: { label: "Revenue", value: "$50K" },
      },
    ];
    const result = validateDataConsistency(blocks);
    // $48K = 48000, $50K = 50000 - within 2x, so consistent
    expect(result.passed).toBe(true);
    expect(result.validator).toBe("data_consistency");
  });

  it("detects magnitude mismatch for same label", () => {
    const blocks = [
      {
        type: "native" as const,
        component: "stat_grid",
        props: {
          stats: [{ label: "Revenue", value: "$48000" }],
        },
      },
      {
        type: "native" as const,
        component: "metric_card",
        props: { label: "Revenue", value: "$48" },
      },
    ];
    const result = validateDataConsistency(blocks);
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("inconsistent values"),
    );
  });

  it("detects mixed currencies across components", () => {
    const blocks = [
      {
        type: "native" as const,
        component: "stat_grid",
        props: { stats: [{ label: "Price", value: "$100" }] },
      },
      {
        type: "native" as const,
        component: "metric_card",
        props: { label: "Cost", value: "€85" },
      },
    ];
    const result = validateDataConsistency(blocks);
    expect(result.passed).toBe(false);
    expect(result.warnings).toContainEqual(
      expect.stringContaining("Mixed currency"),
    );
  });

  it("handles K/M/B suffixes correctly", () => {
    const blocks = [
      {
        type: "native" as const,
        component: "stat_grid",
        props: {
          stats: [{ label: "Revenue", value: "$48K" }],
        },
      },
      {
        type: "native" as const,
        component: "metric_card",
        props: { label: "Revenue", value: "$48000" },
      },
    ];
    const result = validateDataConsistency(blocks);
    // 48K = 48000, 48000 = 48000 - exact match
    expect(result.passed).toBe(true);
  });

  it("handles M suffix", () => {
    const blocks = [
      {
        type: "native" as const,
        component: "stat_grid",
        props: { stats: [{ label: "ARR", value: "2.5M" }] },
      },
      {
        type: "native" as const,
        component: "metric_card",
        props: { label: "ARR", value: "2500000" },
      },
    ];
    const result = validateDataConsistency(blocks);
    expect(result.passed).toBe(true);
  });

  it("handles B suffix", () => {
    const blocks = [
      {
        type: "native" as const,
        component: "stat_grid",
        props: { stats: [{ label: "Market Cap", value: "1.5B" }] },
      },
      {
        type: "native" as const,
        component: "metric_card",
        props: { label: "Market Cap", value: "1500000000" },
      },
    ];
    const result = validateDataConsistency(blocks);
    expect(result.passed).toBe(true);
  });

  it("returns no warnings for a single block", () => {
    const blocks = [
      {
        type: "native" as const,
        component: "stat_grid",
        props: {
          stats: [{ label: "Revenue", value: "$48K" }],
        },
      },
    ];
    const result = validateDataConsistency(blocks);
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it("ignores non-numeric values", () => {
    const blocks = [
      {
        type: "native" as const,
        component: "stat_grid",
        props: { stats: [{ label: "Status", value: "Active" }] },
      },
      {
        type: "native" as const,
        component: "metric_card",
        props: { label: "Status", value: "Pending" },
      },
    ];
    const result = validateDataConsistency(blocks);
    expect(result.passed).toBe(true);
  });

  it("ignores zero values in magnitude comparison", () => {
    const blocks = [
      {
        type: "native" as const,
        component: "stat_grid",
        props: { stats: [{ label: "Errors", value: 0 }] },
      },
      {
        type: "native" as const,
        component: "metric_card",
        props: { label: "Errors", value: 5000 },
      },
    ];
    const result = validateDataConsistency(blocks);
    // Zero values are filtered out of magnitude comparison
    expect(result.passed).toBe(true);
  });
});

// ── runPipelineQA ──────────────────────────────────────────────────────────

describe("runPipelineQA", () => {
  it("returns a QAReport with all results for mixed blocks", () => {
    const blocks = [
      {
        type: "sandbox" as const,
        slotIndex: 0,
        component: "sandbox",
        props: {},
        html: `<div>Hello</div><script>window.parent.postMessage({ type: 'jarble:ready' }, '*');</script>`,
      },
      {
        type: "native" as const,
        slotIndex: 1,
        component: "chart",
        props: {
          type: "bar",
          data: [{ x: "A", y: 10 }],
          dataKeys: ["y"],
          xAxisKey: "x",
        },
      },
    ];
    const report = runPipelineQA(blocks, {});
    expect(report).toHaveProperty("passed");
    expect(report).toHaveProperty("results");
    expect(report).toHaveProperty("totalWarnings");
    expect(report).toHaveProperty("totalFixes");
    // Sandbox block produces 2 results (csp + integrity), native produces 1
    // No consistency check since only 1 native block
    expect(report.results.length).toBe(3);
  });

  it("auto-fixes propagate to sandbox block HTML (integrity fix)", () => {
    const blocks = [
      {
        type: "sandbox" as const,
        slotIndex: 0,
        component: "sandbox",
        props: {},
        html: `<div>Content</div><script>doStuff();</script>`,
      },
    ];
    runPipelineQA(blocks, {});
    // Integrity auto-fix should have appended jarble:ready signal
    expect(blocks[0].html).toContain("jarble:ready");
  });

  it("CSP and integrity validators both run for sandbox blocks", () => {
    const blocks = [
      {
        type: "sandbox" as const,
        slotIndex: 0,
        component: "sandbox",
        props: {},
        html: `<script src="https://evil.com/bad.js"></script><script>doStuff();</script>`,
      },
    ];
    const report = runPipelineQA(blocks, {});
    // Should have both csp_compliance and html_integrity results
    const validators = report.results.map((r) => r.validator);
    expect(validators).toContain("csp_compliance");
    expect(validators).toContain("html_integrity");
    // CSP should flag the non-CDN script
    const csp = report.results.find((r) => r.validator === "csp_compliance")!;
    expect(csp.warnings.some((w) => w.includes("non-CDN"))).toBe(true);
    // Integrity should auto-fix the missing jarble:ready
    expect(blocks[0].html).toContain("jarble:ready");
  });

  it("auto-fixes propagate to native block props", () => {
    const blocks = [
      {
        type: "native" as const,
        slotIndex: 0,
        component: "data_table",
        props: {
          columns: [{ header: "Name", key: "name" }],
          rows: [{ name: "Alice" }, { name: "Bob" }],
        },
      },
    ];
    runPipelineQA(blocks, {});
    // After pipeline, rows should be arrays (auto-fixed from objects)
    expect(Array.isArray((blocks[0].props.rows as unknown[])[0])).toBe(true);
  });

  it("includes slotIndex on each result", () => {
    const blocks = [
      {
        type: "native" as const,
        slotIndex: 3,
        component: "stat_grid",
        props: { stats: [{ label: "Test", value: 42 }] },
      },
    ];
    const report = runPipelineQA(blocks, {});
    for (const result of report.results) {
      if (result.validator !== "data_consistency") {
        expect(result.slotIndex).toBe(3);
      }
    }
  });

  it("runs data consistency when 2+ native blocks exist", () => {
    const blocks = [
      {
        type: "native" as const,
        slotIndex: 0,
        component: "stat_grid",
        props: { stats: [{ label: "Revenue", value: "$48K" }] },
      },
      {
        type: "native" as const,
        slotIndex: 1,
        component: "metric_card",
        props: { label: "Revenue", value: "$50K" },
      },
    ];
    const report = runPipelineQA(blocks, {});
    const consistencyResult = report.results.find(
      (r) => r.validator === "data_consistency",
    );
    expect(consistencyResult).toBeDefined();
  });

  it("skips data consistency for single native block", () => {
    const blocks = [
      {
        type: "native" as const,
        slotIndex: 0,
        component: "chart",
        props: {
          type: "line",
          data: [{ x: "A", y: 1 }],
          dataKeys: ["y"],
          xAxisKey: "x",
        },
      },
    ];
    const report = runPipelineQA(blocks, {});
    const consistencyResult = report.results.find(
      (r) => r.validator === "data_consistency",
    );
    expect(consistencyResult).toBeUndefined();
  });

  it("correctly calculates totalWarnings and totalFixes", () => {
    const blocks = [
      {
        type: "sandbox" as const,
        slotIndex: 0,
        component: "sandbox",
        props: {},
        html: `<div onclick="x()">Bad</div>`, // CSP warning + fix, integrity fix
      },
      {
        type: "native" as const,
        slotIndex: 1,
        component: "data_table",
        props: { rows: [] }, // empty rows warning + missing columns warning
      },
    ];
    const report = runPipelineQA(blocks, {});
    expect(report.totalWarnings).toBeGreaterThanOrEqual(3); // inline handler, missing ready, empty rows, missing columns
    expect(report.totalFixes).toBeGreaterThanOrEqual(2); // stripped handler, appended ready
    expect(report.passed).toBe(false);
  });

  it("reports passed=true when all validators pass", () => {
    const blocks = [
      {
        type: "sandbox" as const,
        slotIndex: 0,
        component: "sandbox",
        props: {},
        html: `<div>Clean</div><script>window.parent.postMessage({ type: 'jarble:ready' }, '*');</script>`,
      },
      {
        type: "native" as const,
        slotIndex: 1,
        component: "chart",
        props: {
          type: "bar",
          data: [{ month: "Jan", sales: 100 }],
          dataKeys: ["sales"],
          xAxisKey: "month",
        },
      },
    ];
    const report = runPipelineQA(blocks, {});
    expect(report.passed).toBe(true);
    expect(report.totalWarnings).toBe(0);
  });

  it("handles empty blocks array", () => {
    const report = runPipelineQA([], {});
    expect(report.passed).toBe(true);
    expect(report.results).toHaveLength(0);
    expect(report.totalWarnings).toBe(0);
    expect(report.totalFixes).toBe(0);
  });

  it("applies schema validation for native blocks when schema provided", () => {
    const schemas = {
      chart: {
        type: "object",
        required: ["type", "data"],
        properties: {
          type: { type: "string", enum: ["bar", "line", "pie", "area"] },
          data: { type: "array" },
        },
      },
    };
    const blocks = [
      {
        type: "native" as const,
        slotIndex: 0,
        component: "chart",
        props: { type: "invalid", data: [{ x: 1 }], dataKeys: ["x"] },
      },
    ];
    const report = runPipelineQA(blocks, schemas);
    expect(report.passed).toBe(false);
    expect(report.totalWarnings).toBeGreaterThanOrEqual(1);
  });
});
