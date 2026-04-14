/**
 * Component Manifest - Tests
 *
 * Tests the shared component manifest that defines all canvas component
 * metadata, schemas, names, and derived data structures.
 */

import { describe, it, expect } from "vitest";
import {
  COMPONENT_MANIFEST,
  COMPONENT_NAMES,
  COMPONENT_NAME_SET,
  COMPONENT_SCHEMAS,
  DEFAULT_CARD_SIZES,
  MANIFEST_SPLITTABLE,
  type ComponentManifestEntry,
} from "@jarble/component-manifest";

// ── Manifest Structure ───────────────────────────────────────────────────────

describe("COMPONENT_MANIFEST", () => {
  it("has 45 entries (44 components + canvas alias)", () => {
    expect(Object.keys(COMPONENT_MANIFEST).length).toBe(45);
  });

  it("each entry has required fields", () => {
    for (const [name, entry] of Object.entries(COMPONENT_MANIFEST)) {
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(entry.layout).toBeDefined();
      expect(entry.layout.defaultSize).toBeDefined();
      expect(typeof entry.layout.defaultSize.w).toBe("number");
      expect(typeof entry.layout.defaultSize.h).toBe("number");
    }
  });

  it("each entry has a category", () => {
    for (const [name, entry] of Object.entries(COMPONENT_MANIFEST)) {
      expect(typeof entry.category).toBe("string");
    }
  });

  it("canvas alias exists and points to sandbox", () => {
    expect(COMPONENT_MANIFEST.canvas).toBeDefined();
    expect(COMPONENT_MANIFEST.canvas.name).toBe("canvas");
  });

  it("includes all expected component names", () => {
    const expectedNames = [
      "card", "data_table", "stat_grid", "key_value", "code_block",
      "alert", "progress", "image", "layout", "chart",
      "tabs", "accordion", "badge", "list", "timeline",
      "divider", "metric_card", "header", "button_group", "form",
      "code_editor", "spreadsheet", "sandbox",
      "sandpack_sandbox", "video", "embed", "canvas",
      "audio", "avatar", "blockquote", "text_message", "image_gallery",
      "map", "descriptions", "steps", "result", "carousel",
      "statistic", "tag_cloud", "tree", "reasoning", "tool",
      "sources", "page", "confirmation",
    ];
    for (const name of expectedNames) {
      expect(COMPONENT_MANIFEST[name]).toBeDefined();
    }
  });
});

// ── Derived Exports ──────────────────────────────────────────────────────────

describe("COMPONENT_NAMES", () => {
  it("has 45 names", () => {
    expect(COMPONENT_NAMES.length).toBe(45);
  });

  it("matches manifest keys", () => {
    const manifestKeys = Object.keys(COMPONENT_MANIFEST).sort();
    expect([...COMPONENT_NAMES].sort()).toEqual(manifestKeys);
  });
});

describe("COMPONENT_NAME_SET", () => {
  it("is a Set with 45 entries", () => {
    expect(COMPONENT_NAME_SET.size).toBe(45);
  });

  it("has O(1) lookup for known components", () => {
    expect(COMPONENT_NAME_SET.has("card")).toBe(true);
    expect(COMPONENT_NAME_SET.has("sandbox")).toBe(true);
    expect(COMPONENT_NAME_SET.has("canvas")).toBe(true);
    expect(COMPONENT_NAME_SET.has("chart")).toBe(true);
  });

  it("returns false for unknown components", () => {
    expect(COMPONENT_NAME_SET.has("nonexistent")).toBe(false);
    expect(COMPONENT_NAME_SET.has("")).toBe(false);
  });
});

// ── COMPONENT_SCHEMAS ────────────────────────────────────────────────────────

describe("COMPONENT_SCHEMAS", () => {
  it("has 45 schemas", () => {
    expect(Object.keys(COMPONENT_SCHEMAS).length).toBe(45);
  });

  it("every schema has parse and safeParse", () => {
    for (const [name, schema] of Object.entries(COMPONENT_SCHEMAS)) {
      expect(typeof schema.parse).toBe("function");
      expect(typeof schema.safeParse).toBe("function");
    }
  });

  it("keys match manifest keys", () => {
    const schemaKeys = Object.keys(COMPONENT_SCHEMAS).sort();
    const manifestKeys = Object.keys(COMPONENT_MANIFEST).sort();
    expect(schemaKeys).toEqual(manifestKeys);
  });
});

// ── DEFAULT_CARD_SIZES ───────────────────────────────────────────────────────

describe("DEFAULT_CARD_SIZES", () => {
  it("has entry for every manifest component", () => {
    for (const name of Object.keys(COMPONENT_MANIFEST)) {
      expect(DEFAULT_CARD_SIZES[name]).toBeDefined();
    }
  });

  it("each size has positive width and height", () => {
    for (const [name, size] of Object.entries(DEFAULT_CARD_SIZES)) {
      expect(size.width).toBeGreaterThan(0);
      expect(size.height).toBeGreaterThan(0);
    }
  });
});

// ── MANIFEST_SPLITTABLE ──────────────────────────────────────────────────────

describe("MANIFEST_SPLITTABLE", () => {
  it("only includes components that have splittable config", () => {
    for (const [name, config] of Object.entries(MANIFEST_SPLITTABLE)) {
      expect(COMPONENT_MANIFEST[name]).toBeDefined();
      expect(COMPONENT_MANIFEST[name].splittable).toBeDefined();
    }
  });

  it("each splittable has into and propsKey", () => {
    for (const [name, config] of Object.entries(MANIFEST_SPLITTABLE)) {
      expect(typeof config.into).toBe("string");
      expect(typeof config.propsKey).toBe("string");
    }
  });
});
