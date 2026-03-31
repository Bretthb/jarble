/**
 * Tests for the shared component-manifest promptText and sandbox entry.
 *
 * These test Phase 1 changes:
 * - CORE_COMPONENT_NAMES ordering (sandbox first)
 * - Sandbox default size (800x650)
 */

import { describe, it, expect } from "vitest";
import {
  generatePromptReference,
  COMPONENT_MANIFEST,
} from "@jarble/component-manifest";

// ── CORE_COMPONENT_NAMES ordering ────────────────────────────────────────────

describe("generatePromptReference - core component ordering", () => {
  it("lists sandbox as the first component in top-10 mode", () => {
    const output = generatePromptReference(COMPONENT_MANIFEST, {
      top10Only: true,
    });

    const lines = output.split("\n").filter((l) => l.startsWith("**"));
    expect(lines.length).toBeGreaterThan(0);

    // First component entry should be sandbox
    expect(lines[0]).toMatch(/^\*\*sandbox\*\*/);
  });

  it("lists sandpack_sandbox as the second component in top-10 mode", () => {
    const output = generatePromptReference(COMPONENT_MANIFEST, {
      top10Only: true,
    });

    const lines = output.split("\n").filter((l) => l.startsWith("**"));
    expect(lines.length).toBeGreaterThan(1);

    expect(lines[1]).toMatch(/^\*\*sandpack_sandbox\*\*/);
  });

  it("does not list chart, data_table, spreadsheet, or code_editor in top 10", () => {
    const output = generatePromptReference(COMPONENT_MANIFEST, {
      top10Only: true,
    });

    // These were removed from CORE_COMPONENT_NAMES in Phase 1
    const componentLines = output.split("\n").filter((l) => l.startsWith("**"));
    const componentNames = componentLines.map((l) => {
      const match = l.match(/^\*\*(\w+)\*\*/);
      return match ? match[1] : "";
    });

    expect(componentNames).not.toContain("chart");
    expect(componentNames).not.toContain("data_table");
    expect(componentNames).not.toContain("spreadsheet");
    expect(componentNames).not.toContain("code_editor");
  });

  it("includes card, metric_card, stat_grid in top 10", () => {
    const output = generatePromptReference(COMPONENT_MANIFEST, {
      top10Only: true,
    });

    const componentLines = output.split("\n").filter((l) => l.startsWith("**"));
    const componentNames = componentLines.map((l) => {
      const match = l.match(/^\*\*(\w+)\*\*/);
      return match ? match[1] : "";
    });

    expect(componentNames).toContain("card");
    expect(componentNames).toContain("metric_card");
    expect(componentNames).toContain("stat_grid");
  });

  it("includes pointer to component_reference tool for remaining components", () => {
    const output = generatePromptReference(COMPONENT_MANIFEST, {
      top10Only: true,
    });

    expect(output).toContain("component_reference");
    expect(output).toContain("more typed components available");
  });
});

// ── Full reference mode ──────────────────────────────────────────────────────

describe("generatePromptReference - full mode", () => {
  it("includes all builtin components grouped by category", () => {
    const output = generatePromptReference(COMPONENT_MANIFEST);

    expect(output).toContain("### Component Quick Reference");
    expect(output).toContain("**Display**");
    expect(output).toContain("**Charts**");
  });

  it("does not include the top-10 header", () => {
    const output = generatePromptReference(COMPONENT_MANIFEST);

    expect(output).not.toContain("Top 10");
  });
});

// ── Sandbox entry ────────────────────────────────────────────────────────────

describe("sandbox manifest entry - Phase 1 size change", () => {
  it("exists in the component manifest", () => {
    expect(COMPONENT_MANIFEST["sandbox"]).toBeDefined();
  });

  it("has default size of 800x650", () => {
    const sandbox = COMPONENT_MANIFEST["sandbox"];
    expect(sandbox.layout?.defaultSize).toEqual({ w: 800, h: 650 });
  });

  it("is categorized as specialized", () => {
    expect(COMPONENT_MANIFEST["sandbox"].category).toBe("specialized");
  });

  it("is marked as builtin", () => {
    expect(COMPONENT_MANIFEST["sandbox"].builtin).toBe(true);
  });

  it("is marked as expensive", () => {
    expect(COMPONENT_MANIFEST["sandbox"].expensive).toBe(true);
  });

  it("has aliases including iframe, canvas, html", () => {
    const aliases = COMPONENT_MANIFEST["sandbox"].aliases;
    expect(aliases).toContain("iframe");
    expect(aliases).toContain("canvas");
    expect(aliases).toContain("html");
  });

  it("has promptGuidance mentioning html and css fields", () => {
    const guidance = COMPONENT_MANIFEST["sandbox"].promptGuidance;
    expect(guidance).toBeDefined();
    expect(guidance).toContain("html=ONLY body HTML");
    expect(guidance).toContain("css=all styles");
    expect(guidance).toContain("js=all JavaScript");
  });
});
