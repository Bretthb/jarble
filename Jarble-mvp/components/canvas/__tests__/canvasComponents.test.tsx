import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import React from "react";

// ── Mock heavy dependencies before importing anything ─────────────────────
// Sentry
vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

// Mock the ComponentCatalogProvider
vi.mock("@/components/ComponentCatalogProvider", () => ({
  useComponentCatalog: () => ({
    getCustomComponent: () => undefined,
    isCustomComponent: () => false,
  }),
}));

// Mock next/dynamic to just return the component directly
vi.mock("next/dynamic", () => ({
  __esModule: true,
  default: (loader: () => Promise<{ default: React.ComponentType }>) => {
    // Return a placeholder that we can recognize
    const DynamicPlaceholder = (props: Record<string, unknown>) => (
      <div data-testid="dynamic-component" {...props} />
    );
    DynamicPlaceholder.displayName = "DynamicPlaceholder";
    return DynamicPlaceholder;
  },
}));

// Now import after mocks
import CanvasRenderer, { type UIBlock } from "../CanvasRenderer";
import { CANVAS_COMPONENTS } from "../registry";
import {
  cardSchema,
  alertSchema,
  chartSchema,
  dataTableSchema,
  statGridSchema,
  badgeSchema,
  listSchema,
} from "../registry";

// ── Schema validation tests ───────────────────────────────────────────────

describe("Canvas schema validation", () => {
  describe("cardSchema", () => {
    it("accepts valid card props", () => {
      const result = cardSchema.safeParse({ title: "Hello", body: "World" });
      expect(result.success).toBe(true);
    });

    it("accepts card with no required fields (all optional)", () => {
      const result = cardSchema.safeParse({});
      expect(result.success).toBe(true);
    });

    it("accepts card with all fields", () => {
      const result = cardSchema.safeParse({
        title: "Title",
        subtitle: "Subtitle",
        body: "Body text",
        content: "Some content",
        icon: "star",
        status: "info",
      });
      expect(result.success).toBe(true);
    });
  });

  describe("alertSchema", () => {
    it("accepts valid alert props", () => {
      const result = alertSchema.safeParse({
        message: "Something happened",
        variant: "info",
      });
      expect(result.success).toBe(true);
    });

    it("rejects missing required message", () => {
      const result = alertSchema.safeParse({ variant: "info" });
      expect(result.success).toBe(false);
    });

    it("rejects missing required variant", () => {
      const result = alertSchema.safeParse({ message: "Test" });
      expect(result.success).toBe(false);
    });

    it("rejects invalid variant value", () => {
      const result = alertSchema.safeParse({
        message: "Test",
        variant: "critical", // not in enum
      });
      expect(result.success).toBe(false);
    });

    it("accepts all valid variant values", () => {
      for (const variant of ["info", "success", "warning", "error"]) {
        const result = alertSchema.safeParse({ message: "Test", variant });
        expect(result.success).toBe(true);
      }
    });
  });

  describe("dataTableSchema", () => {
    it("accepts valid data table props", () => {
      const result = dataTableSchema.safeParse({
        columns: ["Name", "Age"],
        rows: [["Alice", 30], ["Bob", 25]],
      });
      expect(result.success).toBe(true);
    });

    it("accepts rows with booleans and nulls", () => {
      const result = dataTableSchema.safeParse({
        columns: ["Name", "Active"],
        rows: [["Alice", true], ["Bob", null]],
      });
      expect(result.success).toBe(true);
    });

    it("rejects when columns is missing", () => {
      const result = dataTableSchema.safeParse({ rows: [[]] });
      expect(result.success).toBe(false);
    });
  });

  describe("statGridSchema", () => {
    it("accepts valid stat grid props", () => {
      const result = statGridSchema.safeParse({
        stats: [{ label: "Revenue", value: "$1M" }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("badgeSchema", () => {
    it("accepts valid badge props", () => {
      const result = badgeSchema.safeParse({ text: "NEW" });
      expect(result.success).toBe(true);
    });
  });

  describe("listSchema", () => {
    it("accepts valid list props", () => {
      const result = listSchema.safeParse({
        items: [{ text: "Item 1" }],
      });
      expect(result.success).toBe(true);
    });
  });
});

// ── Registry tests ────────────────────────────────────────────────────────

describe("CANVAS_COMPONENTS registry", () => {
  it("has at least 30 registered components", () => {
    const count = Object.keys(CANVAS_COMPONENTS).length;
    expect(count).toBeGreaterThanOrEqual(30);
  });

  it("every entry has a component and propsSchema", () => {
    for (const [name, entry] of Object.entries(CANVAS_COMPONENTS)) {
      expect(entry.component, `${name} missing component`).toBeDefined();
      expect(entry.propsSchema, `${name} missing propsSchema`).toBeDefined();
      expect(typeof entry.propsSchema.safeParse, `${name} schema missing safeParse`).toBe("function");
    }
  });

  it("has canvas alias pointing to sandbox schema", () => {
    expect(CANVAS_COMPONENTS["canvas"]).toBeDefined();
    expect(CANVAS_COMPONENTS["canvas"].propsSchema).toBe(CANVAS_COMPONENTS["sandbox"].propsSchema);
  });

  it("includes all core component types", () => {
    const coreComponents = [
      "card", "data_table", "stat_grid", "chart", "alert", "progress",
      "list", "timeline", "tabs", "accordion", "badge",
    ];
    for (const name of coreComponents) {
      expect(CANVAS_COMPONENTS[name], `${name} not in registry`).toBeDefined();
    }
  });
});

// ── CanvasRenderer rendering tests ────────────────────────────────────────

describe("CanvasRenderer", () => {
  it("renders a card component with valid props", () => {
    const block: UIBlock = {
      id: "test-1",
      component: "card",
      props: { title: "Test Card", body: "Card body text" },
    };
    render(<CanvasRenderer block={block} />);
    expect(screen.getByText("Test Card")).toBeDefined();
    expect(screen.getByText("Card body text")).toBeDefined();
  });

  it("renders an alert component with valid props", () => {
    const block: UIBlock = {
      id: "test-2",
      component: "alert",
      props: { message: "Alert message", variant: "warning" },
    };
    render(<CanvasRenderer block={block} />);
    expect(screen.getByText("Alert message")).toBeDefined();
  });

  it("shows error card for invalid props", () => {
    const block: UIBlock = {
      id: "test-3",
      component: "alert",
      props: {}, // missing required message and variant
    };
    render(<CanvasRenderer block={block} />);
    expect(screen.getByText(/failed to render/i)).toBeDefined();
  });

  it("shows unknown component fallback for unregistered component", () => {
    const block: UIBlock = {
      id: "test-4",
      component: "totally_nonexistent_component_xyz",
      props: {},
    };
    render(<CanvasRenderer block={block} />);
    expect(screen.getByText(/unknown component/i)).toBeDefined();
  });

  it("passes onAction to error card buttons", () => {
    const onAction = vi.fn();
    const block: UIBlock = {
      id: "test-5",
      component: "alert",
      props: {}, // invalid — triggers error card
    };
    render(<CanvasRenderer block={block} onAction={onAction} />);
    // Error card should have Fix and Remove buttons
    const fixButton = screen.getByText("Fix Component");
    expect(fixButton).toBeDefined();
  });
});
