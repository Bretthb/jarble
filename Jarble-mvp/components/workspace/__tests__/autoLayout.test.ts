import { describe, it, expect, vi } from "vitest";
import {
  findOpenPosition,
  getDefaultSize,
  getContainerSize,
  computeSpan,
  packIntoRows,
  tidyLayout,
  TYPE_ORDER,
} from "../autoLayout";
import type { CanvasCard } from "../types";

// Suppress dev console noise
vi.spyOn(console, "log").mockImplementation(() => {});

function makeCard(overrides: Partial<CanvasCard> = {}): CanvasCard {
  return {
    id: "card-1",
    component: "card",
    props: {},
    position: { x: 0, y: 0 },
    size: { width: 320, height: 220 },
    zIndex: 1,
    minimized: false,
    createdAt: 1000,
    ...overrides,
  };
}

// ── findOpenPosition ──────────────────────────────────────────────────────

describe("findOpenPosition", () => {
  const viewport = { x: 0, y: 0 };
  const zoom = 1;
  const containerW = 1200;
  const containerH = 800;
  const cardSize = { width: 320, height: 220 };

  it("returns center position when no cards exist", () => {
    const pos = findOpenPosition([], viewport, zoom, containerW, containerH, cardSize);
    // cx = (-0 + 1200/2) / 1 - 320/2 = 440
    // cy = (-0 + 800/2) / 1 - 220/2 = 290
    expect(pos.x).toBeCloseTo(440, 0);
    expect(pos.y).toBeCloseTo(290, 0);
  });

  it("returns center if no overlap", () => {
    const cards = [makeCard({ position: { x: 0, y: 0 }, size: { width: 100, height: 100 } })];
    const pos = findOpenPosition(cards, viewport, zoom, containerW, containerH, cardSize);
    // Center (440, 290) doesn't overlap (0,0,100,100), so should still be center
    expect(pos.x).toBeCloseTo(440, 0);
    expect(pos.y).toBeCloseTo(290, 0);
  });

  it("finds non-overlapping position when center is occupied", () => {
    // Place a card exactly at center
    const centerX = 440;
    const centerY = 180;
    const cards = [makeCard({ position: { x: centerX, y: centerY }, size: { width: 320, height: 220 } })];
    const pos = findOpenPosition(cards, viewport, zoom, containerW, containerH, cardSize);
    // Should find a different position via spiral
    expect(pos.x !== centerX || pos.y !== centerY).toBe(true);
  });

  it("uses fallback when all spiral positions are occupied", () => {
    // Fill a grid of positions (extreme case - this tests the fallback branch)
    // We can't easily fill 20 rings x 12 angles, but verify function doesn't crash
    const cards = [makeCard({ position: { x: 0, y: 0 }, size: { width: 10000, height: 10000 } })];
    const pos = findOpenPosition(cards, viewport, zoom, containerW, containerH, cardSize);
    // Should return some position without throwing
    expect(typeof pos.x).toBe("number");
    expect(typeof pos.y).toBe("number");
  });
});

// ── getDefaultSize ────────────────────────────────────────────────────────

describe("getDefaultSize", () => {
  it("returns default size for known component", () => {
    const size = getDefaultSize("chart");
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });

  it("returns fallback default for unknown component", () => {
    const size = getDefaultSize("totally_unknown_component");
    expect(size).toEqual({ width: 320, height: 220 });
  });
});

// ── getContainerSize ──────────────────────────────────────────────────────

describe("getContainerSize", () => {
  it("returns window-based dimensions in browser environment", () => {
    // jsdom provides window
    const size = getContainerSize();
    expect(size.width).toBeGreaterThan(0);
    expect(size.height).toBeGreaterThan(0);
  });
});

// ── computeSpan ───────────────────────────────────────────────────────────

describe("computeSpan", () => {
  it("returns 1 for compact components (metric_card)", () => {
    const card = makeCard({ component: "metric_card" });
    expect(computeSpan(card)).toBe(1);
  });

  it("returns 2 for medium components (chart)", () => {
    const card = makeCard({ component: "chart" });
    expect(computeSpan(card)).toBe(2);
  });

  it("returns 3 for full-width components (sandbox)", () => {
    const card = makeCard({ component: "sandbox" });
    expect(computeSpan(card)).toBe(3);
  });

  it("returns 1 for unknown components", () => {
    const card = makeCard({ component: "totally_unknown" });
    expect(computeSpan(card)).toBe(1);
  });

  it("respects layoutHint override (full-width)", () => {
    const card = makeCard({ component: "metric_card", layoutHint: "full-width" });
    expect(computeSpan(card)).toBe(3);
  });

  it("respects layoutHint override (third)", () => {
    const card = makeCard({ component: "sandbox", layoutHint: "third" });
    expect(computeSpan(card)).toBe(1);
  });

  it("ignores auto layoutHint and uses auto-detection", () => {
    const card = makeCard({ component: "chart", layoutHint: "auto" });
    expect(computeSpan(card)).toBe(2);
  });

  it("clamps span to totalColumns", () => {
    const card = makeCard({ component: "sandbox" }); // normally 3
    expect(computeSpan(card, 2)).toBe(2);
  });

  it("handles dynamic data_table span (few columns)", () => {
    const card = makeCard({
      component: "data_table",
      props: { columns: [{ key: "a" }, { key: "b" }] },
    });
    expect(computeSpan(card)).toBe(1);
  });

  it("handles dynamic data_table span (many columns)", () => {
    const card = makeCard({
      component: "data_table",
      props: { columns: Array(7).fill({ key: "x" }) },
    });
    expect(computeSpan(card)).toBe(3);
  });

  it("handles dynamic stat_grid span (few stats)", () => {
    const card = makeCard({
      component: "stat_grid",
      props: { stats: [{ label: "A", value: 1 }, { label: "B", value: 2 }] },
    });
    expect(computeSpan(card)).toBe(2);
  });

  it("handles dynamic stat_grid span (many stats)", () => {
    const card = makeCard({
      component: "stat_grid",
      props: { stats: Array(5).fill({ label: "X", value: 1 }) },
    });
    expect(computeSpan(card)).toBe(3);
  });
});

// ── packIntoRows ──────────────────────────────────────────────────────────

describe("packIntoRows", () => {
  it("returns empty array for empty cards", () => {
    expect(packIntoRows([])).toEqual([]);
  });

  it("packs a single span-3 card into one row", () => {
    const cards = [makeCard({ component: "sandbox" })]; // span 3
    const rows = packIntoRows(cards);
    expect(rows).toHaveLength(1);
    expect(rows[0].cards).toHaveLength(1);
    expect(rows[0].cards[0].span).toBe(3);
  });

  it("packs three span-1 cards into one row", () => {
    const cards = [
      makeCard({ id: "a", component: "metric_card" }),
      makeCard({ id: "b", component: "badge" }),
      makeCard({ id: "c", component: "progress" }),
    ];
    const rows = packIntoRows(cards);
    expect(rows).toHaveLength(1);
    expect(rows[0].cards).toHaveLength(3);
  });

  it("overflows to next row when span exceeds totalColumns", () => {
    const cards = [
      makeCard({ id: "a", component: "chart" }),    // span 2
      makeCard({ id: "b", component: "chart" }),    // span 2 - won't fit in row 1
    ];
    const rows = packIntoRows(cards);
    expect(rows).toHaveLength(2);
  });

  it("sorts cards by TYPE_ORDER priority", () => {
    const cards = [
      makeCard({ id: "table", component: "data_table", props: { columns: Array(7).fill({ key: "x" }) } }),
      makeCard({ id: "header", component: "header" }),
      makeCard({ id: "metric", component: "metric_card" }),
    ];
    const rows = packIntoRows(cards);
    // header (order 0) should be first, then metric (1), then table (4)
    const allCards = rows.flatMap((r) => r.cards.map((c) => c.card.id));
    const headerIdx = allCards.indexOf("header");
    const metricIdx = allCards.indexOf("metric");
    const tableIdx = allCards.indexOf("table");
    expect(headerIdx).toBeLessThan(metricIdx);
    expect(metricIdx).toBeLessThan(tableIdx);
  });

  it("respects custom totalColumns parameter", () => {
    const cards = [
      makeCard({ id: "a", component: "metric_card" }), // span 1
      makeCard({ id: "b", component: "metric_card" }), // span 1
    ];
    const rows = packIntoRows(cards, 1); // Only 1 column
    expect(rows).toHaveLength(2); // Each card in its own row
  });
});

// ── tidyLayout ────────────────────────────────────────────────────────────

describe("tidyLayout", () => {
  it("returns empty array unchanged", () => {
    const result = tidyLayout([], 1200);
    expect(result).toEqual([]);
  });

  it("resets card sizes to defaults", () => {
    const cards = [makeCard({ id: "a", component: "card", size: { width: 999, height: 999 } })];
    const result = tidyLayout(cards, 1200);
    expect(result[0].size.width).not.toBe(999);
  });

  it("sorts cards by type priority", () => {
    const cards = [
      makeCard({ id: "chart", component: "chart" }),       // TYPE_ORDER 3
      makeCard({ id: "metric", component: "metric_card" }), // TYPE_ORDER 1
      makeCard({ id: "header", component: "header" }),       // TYPE_ORDER 0
    ];
    const result = tidyLayout(cards, 1200);
    const ids = result.map((c) => c.id);
    expect(ids.indexOf("header")).toBeLessThan(ids.indexOf("metric"));
    expect(ids.indexOf("metric")).toBeLessThan(ids.indexOf("chart"));
  });

  it("assigns y positions in increasing order", () => {
    const cards = [
      makeCard({ id: "a", component: "metric_card" }),
      makeCard({ id: "b", component: "chart" }),
    ];
    const result = tidyLayout(cards, 1200);
    // metric_card (compact) comes first, then chart
    const aY = result.find((c) => c.id === "a")!.position.y;
    const bY = result.find((c) => c.id === "b")!.position.y;
    expect(aY).toBeLessThanOrEqual(bY);
  });

  it("packs compact cards into the same row", () => {
    const cards = [
      makeCard({ id: "a", component: "metric_card", size: { width: 200, height: 100 } }),
      makeCard({ id: "b", component: "badge", size: { width: 200, height: 100 } }),
    ];
    const result = tidyLayout(cards, 1200);
    // Both compact - should share the same y
    expect(result[0].position.y).toBe(result[1].position.y);
  });

  it("preserves card count", () => {
    const cards = [
      makeCard({ id: "a", component: "card" }),
      makeCard({ id: "b", component: "chart" }),
      makeCard({ id: "c", component: "sandbox" }),
    ];
    const result = tidyLayout(cards, 1200);
    expect(result).toHaveLength(3);
  });
});

// ── TYPE_ORDER ─────────────────────────────────────────────────────────────

describe("TYPE_ORDER", () => {
  it("has header at priority 0", () => {
    expect(TYPE_ORDER["header"]).toBe(0);
  });

  it("has metric_card at priority 1", () => {
    expect(TYPE_ORDER["metric_card"]).toBe(1);
  });

  it("has chart at priority 3", () => {
    expect(TYPE_ORDER["chart"]).toBe(3);
  });

  it("has sandbox at priority 6", () => {
    expect(TYPE_ORDER["sandbox"]).toBe(6);
  });
});
