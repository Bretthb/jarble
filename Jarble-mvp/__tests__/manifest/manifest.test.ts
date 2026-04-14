/**
 * Component Manifest - Comprehensive Tests
 *
 * Tests the single source of truth for all 37+ component definitions,
 * derived exports, derive functions, and security constants.
 */

import { describe, it, expect } from "vitest";
import {
  COMPONENT_MANIFEST,
  COMPONENT_NAMES,
  COMPONENT_NAME_SET,
  DEFAULT_CARD_SIZES,
  MANIFEST_SPLITTABLE,
  COMPONENT_SCHEMAS,
  SANDBOX_SDK_VERSION,
  TRUSTED_CDN_ORIGINS,
  TRUSTED_EMBED_ORIGINS,
  generatePromptReference,
  generateMcpReference,
  getComponentReference,
  getComponentDescriptions,
  deriveComponentNames,
  deriveComponentNameSet,
} from "@jarble/component-manifest";

// ── Expected components (42 canonical + 1 alias) ──────────────────────────

const CANONICAL_COMPONENTS = [
  "card", "data_table", "stat_grid", "key_value", "code_block",
  "alert", "progress", "image", "layout", "chart",
  "tabs", "accordion", "badge", "list", "timeline",
  "divider", "metric_card", "header", "button_group", "form",
  "code_editor", "spreadsheet", "sandbox", "sandpack_sandbox",
  "video", "embed", "audio", "avatar", "blockquote",
  "text_message", "image_gallery", "map", "descriptions", "steps",
  "result", "carousel", "statistic", "tag_cloud", "tree",
  "reasoning", "tool", "sources", "confirmation", "page",
];

const ALIAS_COMPONENTS = ["canvas"];

const ALL_COMPONENTS = [...CANONICAL_COMPONENTS, ...ALIAS_COMPONENTS];

// ── COMPONENT_MANIFEST ─────────────────────────────────────────────────────

describe("COMPONENT_MANIFEST", () => {
  it("has entries for all canonical components", () => {
    for (const name of CANONICAL_COMPONENTS) {
      expect(COMPONENT_MANIFEST[name]).toBeDefined();
    }
  });

  it("has the canvas alias pointing to sandbox", () => {
    expect(COMPONENT_MANIFEST.canvas).toBeDefined();
    expect(COMPONENT_MANIFEST.canvas.name).toBe("canvas");
    expect(COMPONENT_MANIFEST.canvas.description).toBe(
      COMPONENT_MANIFEST.sandbox.description
    );
  });

  it("canvas alias has empty aliases array", () => {
    expect(COMPONENT_MANIFEST.canvas.aliases).toEqual([]);
  });

  it("total entry count matches expected (canonical + alias)", () => {
    expect(Object.keys(COMPONENT_MANIFEST).length).toBe(ALL_COMPONENTS.length);
  });

  describe("required fields", () => {
    it.each(CANONICAL_COMPONENTS)("%s has all required fields", (name) => {
      const entry = COMPONENT_MANIFEST[name];
      expect(entry.name).toBe(name);
      expect(typeof entry.description).toBe("string");
      expect(entry.description.length).toBeGreaterThan(0);
      expect(typeof entry.reference).toBe("string");
      expect(entry.reference.length).toBeGreaterThan(0);
      expect(["display", "chart", "interactive", "media", "specialized"]).toContain(entry.category);
      expect(typeof entry.layout).toBe("object");
      expect(["static", "dynamic"]).toContain(entry.loading);
      expect(typeof entry.expensive).toBe("boolean");
      expect(Array.isArray(entry.aliases)).toBe(true);
      expect(Array.isArray(entry.tags)).toBe(true);
      expect(typeof entry.builtin).toBe("boolean");
      expect(typeof entry.renderOrder).toBe("number");
    });
  });

  describe("layout hints", () => {
    const validHints = ["full-width", "half", "third", "compact", "auto"];

    it.each(CANONICAL_COMPONENTS)("%s has valid defaultHint", (name) => {
      const entry = COMPONENT_MANIFEST[name];
      expect(validHints).toContain(entry.layout.defaultHint);
    });

    it.each(CANONICAL_COMPONENTS)("%s has positive defaultSize", (name) => {
      const entry = COMPONENT_MANIFEST[name];
      expect(entry.layout.defaultSize.w).toBeGreaterThan(0);
      expect(entry.layout.defaultSize.h).toBeGreaterThan(0);
    });

    it.each(CANONICAL_COMPONENTS)("%s defaultSize values are numbers", (name) => {
      const entry = COMPONENT_MANIFEST[name];
      expect(typeof entry.layout.defaultSize.w).toBe("number");
      expect(typeof entry.layout.defaultSize.h).toBe("number");
    });
  });

  describe("categories", () => {
    it("chart component is in chart category", () => {
      expect(COMPONENT_MANIFEST.chart.category).toBe("chart");
    });

    it("sandbox is in specialized category", () => {
      expect(COMPONENT_MANIFEST.sandbox.category).toBe("specialized");
    });

    it("button_group is in interactive category", () => {
      expect(COMPONENT_MANIFEST.button_group.category).toBe("interactive");
    });

    it("video is in media category", () => {
      expect(COMPONENT_MANIFEST.video.category).toBe("media");
    });

    it("card is in display category", () => {
      expect(COMPONENT_MANIFEST.card.category).toBe("display");
    });
  });

  describe("loading strategy", () => {
    it("sandbox uses dynamic loading", () => {
      expect(COMPONENT_MANIFEST.sandbox.loading).toBe("dynamic");
    });

    it("card uses static loading", () => {
      expect(COMPONENT_MANIFEST.card.loading).toBe("static");
    });

    it("chart uses dynamic loading", () => {
      expect(COMPONENT_MANIFEST.chart.loading).toBe("dynamic");
    });
  });

  describe("expensive flag", () => {
    it("sandbox is marked as expensive", () => {
      expect(COMPONENT_MANIFEST.sandbox.expensive).toBe(true);
    });

    it("card is not marked as expensive", () => {
      expect(COMPONENT_MANIFEST.card.expensive).toBe(false);
    });
  });

  describe("builtin flag", () => {
    it.each(CANONICAL_COMPONENTS)("%s is marked as builtin", (name) => {
      expect(COMPONENT_MANIFEST[name].builtin).toBe(true);
    });
  });

  describe("render order", () => {
    it.each(CANONICAL_COMPONENTS)("%s has renderOrder between 1 and 10", (name) => {
      const entry = COMPONENT_MANIFEST[name];
      expect(entry.renderOrder).toBeGreaterThanOrEqual(1);
      expect(entry.renderOrder).toBeLessThanOrEqual(10);
    });
  });
});

// ── COMPONENT_NAMES / COMPONENT_NAME_SET ──────────────────────────────────

describe("COMPONENT_NAMES", () => {
  it("is an array of strings", () => {
    expect(Array.isArray(COMPONENT_NAMES)).toBe(true);
    for (const name of COMPONENT_NAMES) {
      expect(typeof name).toBe("string");
    }
  });

  it("includes all canonical components", () => {
    for (const name of CANONICAL_COMPONENTS) {
      expect(COMPONENT_NAMES).toContain(name);
    }
  });

  it("includes the canvas alias", () => {
    expect(COMPONENT_NAMES).toContain("canvas");
  });
});

describe("COMPONENT_NAME_SET", () => {
  it("is a Set", () => {
    expect(COMPONENT_NAME_SET instanceof Set).toBe(true);
  });

  it("contains all component names", () => {
    for (const name of ALL_COMPONENTS) {
      expect(COMPONENT_NAME_SET.has(name)).toBe(true);
    }
  });

  it("does not contain non-existent names", () => {
    expect(COMPONENT_NAME_SET.has("nonexistent")).toBe(false);
    expect(COMPONENT_NAME_SET.has("")).toBe(false);
  });

  it("has same size as COMPONENT_NAMES", () => {
    expect(COMPONENT_NAME_SET.size).toBe(COMPONENT_NAMES.length);
  });
});

// ── DEFAULT_CARD_SIZES ─────────────────────────────────────────────────────

describe("DEFAULT_CARD_SIZES", () => {
  it("has entries for all components including alias", () => {
    for (const name of ALL_COMPONENTS) {
      expect(DEFAULT_CARD_SIZES[name]).toBeDefined();
    }
  });

  it.each(ALL_COMPONENTS)("%s has width and height", (name) => {
    const size = DEFAULT_CARD_SIZES[name];
    expect(typeof size.width).toBe("number");
    expect(typeof size.height).toBe("number");
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });

  it("derives sizes from manifest layout.defaultSize", () => {
    for (const name of CANONICAL_COMPONENTS) {
      const manifestEntry = COMPONENT_MANIFEST[name];
      const cardSize = DEFAULT_CARD_SIZES[name];
      expect(cardSize.width).toBe(manifestEntry.layout.defaultSize.w);
      expect(cardSize.height).toBe(manifestEntry.layout.defaultSize.h);
    }
  });
});

// ── COMPONENT_SCHEMAS ──────────────────────────────────────────────────────

describe("COMPONENT_SCHEMAS", () => {
  it("has schemas for all components including alias", () => {
    for (const name of ALL_COMPONENTS) {
      expect(COMPONENT_SCHEMAS[name]).toBeDefined();
    }
  });

  it("canvas schema is the same as sandbox schema", () => {
    expect(COMPONENT_SCHEMAS.canvas).toBe(COMPONENT_SCHEMAS.sandbox);
  });

  it("each schema is a Zod type (has parse and safeParse)", () => {
    for (const name of ALL_COMPONENTS) {
      const schema = COMPONENT_SCHEMAS[name];
      expect(typeof schema.parse).toBe("function");
      expect(typeof schema.safeParse).toBe("function");
    }
  });

  it("card schema accepts valid props", () => {
    const result = COMPONENT_SCHEMAS.card.safeParse({ title: "Hello", body: "World" });
    expect(result.success).toBe(true);
  });

  it("card schema accepts empty object", () => {
    const result = COMPONENT_SCHEMAS.card.safeParse({});
    expect(result.success).toBe(true);
  });

  it("alert schema requires message and variant", () => {
    const invalid = COMPONENT_SCHEMAS.alert.safeParse({});
    expect(invalid.success).toBe(false);
    const valid = COMPONENT_SCHEMAS.alert.safeParse({ message: "hi", variant: "info" });
    expect(valid.success).toBe(true);
  });

  it("chart schema validates type enum", () => {
    const valid = COMPONENT_SCHEMAS.chart.safeParse({
      type: "bar",
      data: [{ x: "a", y: 1 }],
      dataKeys: ["y"],
    });
    expect(valid.success).toBe(true);

    const invalid = COMPONENT_SCHEMAS.chart.safeParse({
      type: "scatter",
      data: [],
      dataKeys: [],
    });
    expect(invalid.success).toBe(false);
  });

  it("sandbox schema requires html", () => {
    const invalid = COMPONENT_SCHEMAS.sandbox.safeParse({});
    expect(invalid.success).toBe(false);
    const valid = COMPONENT_SCHEMAS.sandbox.safeParse({ html: "<div>test</div>" });
    expect(valid.success).toBe(true);
  });

  it("progress schema validates value range 0-100", () => {
    const valid = COMPONENT_SCHEMAS.progress.safeParse({ value: 50 });
    expect(valid.success).toBe(true);
    const tooHigh = COMPONENT_SCHEMAS.progress.safeParse({ value: 150 });
    expect(tooHigh.success).toBe(false);
    const tooLow = COMPONENT_SCHEMAS.progress.safeParse({ value: -1 });
    expect(tooLow.success).toBe(false);
  });
});

// ── MANIFEST_SPLITTABLE ────────────────────────────────────────────────────

describe("MANIFEST_SPLITTABLE", () => {
  it("identifies stat_grid as splittable", () => {
    expect(MANIFEST_SPLITTABLE.stat_grid).toBeDefined();
  });

  it("identifies key_value as splittable", () => {
    expect(MANIFEST_SPLITTABLE.key_value).toBeDefined();
  });

  it("identifies descriptions as splittable", () => {
    expect(MANIFEST_SPLITTABLE.descriptions).toBeDefined();
  });

  it("each splittable entry has into and propsKey", () => {
    for (const [, config] of Object.entries(MANIFEST_SPLITTABLE)) {
      expect(typeof config.into).toBe("string");
      expect(typeof config.propsKey).toBe("string");
    }
  });

  it("card is not splittable", () => {
    expect(MANIFEST_SPLITTABLE.card).toBeUndefined();
  });

  it("sandbox is not splittable", () => {
    expect(MANIFEST_SPLITTABLE.sandbox).toBeUndefined();
  });
});

// ── TRUSTED_CDN_ORIGINS ────────────────────────────────────────────────────

describe("TRUSTED_CDN_ORIGINS", () => {
  it("has exactly 12 origins", () => {
    expect(TRUSTED_CDN_ORIGINS.length).toBe(12);
  });

  it("all origins start with https://", () => {
    for (const origin of TRUSTED_CDN_ORIGINS) {
      expect(origin.startsWith("https://")).toBe(true);
    }
  });

  it("includes key CDN providers", () => {
    expect(TRUSTED_CDN_ORIGINS).toContain("https://cdn.jsdelivr.net");
    expect(TRUSTED_CDN_ORIGINS).toContain("https://cdnjs.cloudflare.com");
    expect(TRUSTED_CDN_ORIGINS).toContain("https://unpkg.com");
    expect(TRUSTED_CDN_ORIGINS).toContain("https://esm.sh");
  });

  it("includes threejs.org and d3js.org", () => {
    expect(TRUSTED_CDN_ORIGINS).toContain("https://threejs.org");
    expect(TRUSTED_CDN_ORIGINS).toContain("https://d3js.org");
  });

  it("includes font providers", () => {
    expect(TRUSTED_CDN_ORIGINS).toContain("https://fonts.googleapis.com");
    expect(TRUSTED_CDN_ORIGINS).toContain("https://fonts.gstatic.com");
  });

  it("does not contain any non-https origins", () => {
    for (const origin of TRUSTED_CDN_ORIGINS) {
      expect(origin).not.toMatch(/^http:\/\//);
    }
  });
});

describe("TRUSTED_EMBED_ORIGINS", () => {
  it("is a non-empty array", () => {
    expect(TRUSTED_EMBED_ORIGINS.length).toBeGreaterThan(0);
  });

  it("all origins start with https://", () => {
    for (const origin of TRUSTED_EMBED_ORIGINS) {
      expect(origin.startsWith("https://")).toBe(true);
    }
  });

  it("includes youtube", () => {
    expect(TRUSTED_EMBED_ORIGINS).toContain("https://www.youtube.com");
  });
});

// ── SANDBOX_SDK_VERSION ────────────────────────────────────────────────────

describe("SANDBOX_SDK_VERSION", () => {
  it('equals "1.0"', () => {
    expect(SANDBOX_SDK_VERSION).toBe("1.0");
  });
});

// ── generatePromptReference ─────────────────────────────────────────────

describe("generatePromptReference", () => {
  it("returns a non-empty string", () => {
    const result = generatePromptReference(COMPONENT_MANIFEST);
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("with top10Only includes top components", () => {
    const result = generatePromptReference(COMPONENT_MANIFEST, { top10Only: true });
    // Sandbox-first: sandbox and sandpack_sandbox are first, chart/data_table removed from top
    expect(result).toContain("sandbox");
    expect(result).toContain("sandpack_sandbox");
    expect(result).toContain("card");
    expect(result).toContain("metric_card");
    expect(result).toContain("stat_grid");
  });

  it("with top10Only includes component_reference pointer", () => {
    const result = generatePromptReference(COMPONENT_MANIFEST, { top10Only: true });
    expect(result).toContain("component_reference");
  });

  it("full reference contains category headers", () => {
    const result = generatePromptReference(COMPONENT_MANIFEST);
    expect(result).toContain("Display");
    expect(result).toContain("Charts");
    expect(result).toContain("Interactive");
    expect(result).toContain("Media");
    expect(result).toContain("Specialized");
  });

  it("full reference lists all builtin components", () => {
    const result = generatePromptReference(COMPONENT_MANIFEST);
    for (const name of CANONICAL_COMPONENTS) {
      expect(result).toContain(name);
    }
  });
});

// ── generateMcpReference / getComponentReference / getComponentDescriptions

describe("generateMcpReference", () => {
  it("returns an array of builtin component entries", () => {
    const result = generateMcpReference(COMPONENT_MANIFEST);
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);
  });

  it("each entry has name, description, and reference", () => {
    const result = generateMcpReference(COMPONENT_MANIFEST);
    for (const entry of result) {
      expect(typeof entry.name).toBe("string");
      expect(typeof entry.description).toBe("string");
      expect(typeof entry.reference).toBe("string");
    }
  });

  it("includes key canonical components", () => {
    const result = generateMcpReference(COMPONENT_MANIFEST);
    const names = result.map(e => e.name);
    expect(names).toContain("card");
    expect(names).toContain("chart");
    expect(names).toContain("sandbox");
  });
});

describe("getComponentReference", () => {
  it("returns reference string for existing component", () => {
    const result = getComponentReference(COMPONENT_MANIFEST, "card");
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
  });

  it("returns null for non-existent component", () => {
    const result = getComponentReference(COMPONENT_MANIFEST, "nonexistent");
    expect(result).toBeNull();
  });

  it("returns reference for canvas alias", () => {
    const result = getComponentReference(COMPONENT_MANIFEST, "canvas");
    expect(result).not.toBeNull();
    const sandboxRef = getComponentReference(COMPONENT_MANIFEST, "sandbox");
    expect(result).toBe(sandboxRef);
  });
});

describe("getComponentDescriptions", () => {
  it("returns a record of component descriptions", () => {
    const result = getComponentDescriptions(COMPONENT_MANIFEST);
    expect(typeof result).toBe("object");
  });

  it("has descriptions for builtin components", () => {
    const result = getComponentDescriptions(COMPONENT_MANIFEST);
    expect(typeof result.card).toBe("string");
    expect(typeof result.chart).toBe("string");
    expect(typeof result.sandbox).toBe("string");
  });

  it("descriptions are non-empty strings", () => {
    const result = getComponentDescriptions(COMPONENT_MANIFEST);
    for (const [, desc] of Object.entries(result)) {
      expect(desc.length).toBeGreaterThan(0);
    }
  });
});

// ── deriveComponentNames / deriveComponentNameSet ───────────────────────

describe("deriveComponentNames", () => {
  it("returns same names as COMPONENT_NAMES", () => {
    const result = deriveComponentNames(COMPONENT_MANIFEST);
    expect(result).toEqual(COMPONENT_NAMES);
  });
});

describe("deriveComponentNameSet", () => {
  it("returns a Set with same size as COMPONENT_NAME_SET", () => {
    const result = deriveComponentNameSet(COMPONENT_MANIFEST);
    expect(result.size).toBe(COMPONENT_NAME_SET.size);
  });

  it("contains all component names", () => {
    const result = deriveComponentNameSet(COMPONENT_MANIFEST);
    for (const name of ALL_COMPONENTS) {
      expect(result.has(name)).toBe(true);
    }
  });
});
