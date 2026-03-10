/**
 * Canvas Component Registry — Tests
 *
 * Tests the component registry that maps component names to React components
 * and Zod prop schemas. Verifies alignment with the shared manifest.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock next/dynamic before importing registry
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: (loader: () => Promise<unknown>) => {
    const Placeholder = () => null;
    Placeholder.displayName = "DynamicPlaceholder";
    return Placeholder;
  },
}));

// Mock Sentry
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import { CANVAS_COMPONENTS, type CanvasComponentEntry } from "../registry";
import {
  COMPONENT_MANIFEST,
  COMPONENT_NAME_SET,
  COMPONENT_SCHEMAS,
} from "@jarble/component-manifest";

// ── Constants ────────────────────────────────────────────────────────────────

const MANIFEST_NAMES = Object.keys(COMPONENT_MANIFEST);
const REGISTRY_NAMES = Object.keys(CANVAS_COMPONENTS);

// ── Registry Completeness ────────────────────────────────────────────────────

describe("Canvas Component Registry", () => {
  describe("completeness", () => {
    it("has entries for all manifest components", () => {
      for (const name of MANIFEST_NAMES) {
        expect(CANVAS_COMPONENTS[name]).toBeDefined();
      }
    });

    it("registry has same keys as manifest", () => {
      const manifestSet = new Set(MANIFEST_NAMES);
      const registrySet = new Set(REGISTRY_NAMES);

      // Every manifest name should be in registry
      for (const name of manifestSet) {
        expect(registrySet.has(name)).toBe(true);
      }

      // Every registry name should be in manifest
      for (const name of registrySet) {
        expect(manifestSet.has(name)).toBe(true);
      }
    });

    it("registry size matches manifest size", () => {
      expect(REGISTRY_NAMES.length).toBe(MANIFEST_NAMES.length);
    });
  });

  describe("entry structure", () => {
    it.each(REGISTRY_NAMES)("%s has a component and propsSchema", (name) => {
      const entry = CANVAS_COMPONENTS[name];
      expect(entry).toBeDefined();
      expect(entry.component).toBeDefined();
      expect(entry.propsSchema).toBeDefined();
    });

    it.each(REGISTRY_NAMES)("%s component is a function or object", (name) => {
      const entry = CANVAS_COMPONENTS[name];
      // Static imports are functions, dynamic imports are objects (from next/dynamic mock)
      expect(["function", "object"]).toContain(typeof entry.component);
    });

    it.each(REGISTRY_NAMES)("%s propsSchema has parse and safeParse", (name) => {
      const entry = CANVAS_COMPONENTS[name];
      expect(typeof entry.propsSchema.parse).toBe("function");
      expect(typeof entry.propsSchema.safeParse).toBe("function");
    });
  });

  describe("canvas alias", () => {
    it("canvas entry exists", () => {
      expect(CANVAS_COMPONENTS.canvas).toBeDefined();
    });

    it("canvas uses same schema as sandbox", () => {
      expect(CANVAS_COMPONENTS.canvas.propsSchema).toBe(
        CANVAS_COMPONENTS.sandbox.propsSchema
      );
    });

    it("canvas uses same component as sandbox", () => {
      expect(CANVAS_COMPONENTS.canvas.component).toBe(
        CANVAS_COMPONENTS.sandbox.component
      );
    });
  });

  describe("schema alignment with manifest", () => {
    it.each(REGISTRY_NAMES)(
      "%s registry schema matches COMPONENT_SCHEMAS",
      (name) => {
        expect(CANVAS_COMPONENTS[name].propsSchema).toBe(
          COMPONENT_SCHEMAS[name]
        );
      }
    );
  });

  describe("unknown component lookup", () => {
    it("returns undefined for non-existent component", () => {
      expect(CANVAS_COMPONENTS["nonexistent"]).toBeUndefined();
    });

    it("returns undefined for empty string", () => {
      expect(CANVAS_COMPONENTS[""]).toBeUndefined();
    });
  });

  describe("schema validation basics", () => {
    it("card schema accepts minimal props", () => {
      const result = CANVAS_COMPONENTS.card.propsSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("card schema accepts full props", () => {
      const result = CANVAS_COMPONENTS.card.propsSchema.safeParse({
        title: "Test",
        subtitle: "Sub",
        body: "Content",
      });
      expect(result.success).toBe(true);
    });

    it("alert schema rejects missing required fields", () => {
      const result = CANVAS_COMPONENTS.alert.propsSchema.safeParse({});
      expect(result.success).toBe(false);
    });

    it("alert schema accepts valid props", () => {
      const result = CANVAS_COMPONENTS.alert.propsSchema.safeParse({
        message: "Warning!",
        variant: "warning",
      });
      expect(result.success).toBe(true);
    });

    it("chart schema validates type enum", () => {
      const valid = CANVAS_COMPONENTS.chart.propsSchema.safeParse({
        type: "bar",
        data: [{ x: "a", y: 1 }],
        dataKeys: ["y"],
      });
      expect(valid.success).toBe(true);

      const invalid = CANVAS_COMPONENTS.chart.propsSchema.safeParse({
        type: "waterfall",
        data: [],
        dataKeys: [],
      });
      expect(invalid.success).toBe(false);
    });

    it("data_table schema requires columns and rows", () => {
      const invalid = CANVAS_COMPONENTS.data_table.propsSchema.safeParse({});
      expect(invalid.success).toBe(false);

      const valid = CANVAS_COMPONENTS.data_table.propsSchema.safeParse({
        columns: ["Name"],
        rows: [["Alice"]],
      });
      expect(valid.success).toBe(true);
    });

    it("sandbox schema requires html", () => {
      const invalid = CANVAS_COMPONENTS.sandbox.propsSchema.safeParse({});
      expect(invalid.success).toBe(false);

      const valid = CANVAS_COMPONENTS.sandbox.propsSchema.safeParse({
        html: "<div>hello</div>",
      });
      expect(valid.success).toBe(true);
    });

    it("progress schema validates value range", () => {
      const valid = CANVAS_COMPONENTS.progress.propsSchema.safeParse({
        value: 50,
      });
      expect(valid.success).toBe(true);

      const tooHigh = CANVAS_COMPONENTS.progress.propsSchema.safeParse({
        value: 101,
      });
      expect(tooHigh.success).toBe(false);
    });

    it("badge schema requires text", () => {
      const invalid = CANVAS_COMPONENTS.badge.propsSchema.safeParse({});
      expect(invalid.success).toBe(false);

      const valid = CANVAS_COMPONENTS.badge.propsSchema.safeParse({
        text: "New",
      });
      expect(valid.success).toBe(true);
    });

    it("header schema requires title", () => {
      const invalid = CANVAS_COMPONENTS.header.propsSchema.safeParse({});
      expect(invalid.success).toBe(false);

      const valid = CANVAS_COMPONENTS.header.propsSchema.safeParse({
        title: "Section Header",
      });
      expect(valid.success).toBe(true);
    });

    it("form schema requires fields array", () => {
      const valid = CANVAS_COMPONENTS.form.propsSchema.safeParse({
        fields: [{ name: "email", label: "Email", type: "email" }],
      });
      expect(valid.success).toBe(true);
    });

    it("list schema requires items array", () => {
      const valid = CANVAS_COMPONENTS.list.propsSchema.safeParse({
        items: [{ text: "Item 1" }],
      });
      expect(valid.success).toBe(true);
    });
  });

  describe("logRegistry", () => {
    it("logRegistry function is exported", async () => {
      const mod = await import("../registry");
      expect(typeof mod.logRegistry).toBe("function");
    });
  });
});
