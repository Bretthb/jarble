/**
 * Unit tests for `canvasStateToImageDescription` in
 * `lib/canvasImageUtils.ts`.
 *
 * The function turns the in-memory canvas state into an LLM-readable
 * text description. Two callers exercise it:
 *
 *   1. **Vision-disabled path** — when the bot's LLM doesn't support
 *      image input, this text replaces the raw canvas screenshot in
 *      the prompt context. Wrong output here = bot loses awareness
 *      of what the user can see.
 *
 *   2. **SSR / headless context** — server-side renderers can't
 *      capture html2canvas output, so the text serializer is the
 *      fallback for any render-anywhere context.
 *
 * The function is pure (no DOM, no canvas). Two contracts pinned:
 *
 *   1. **Reading order** — cards are sorted top-to-bottom (rows of
 *      100px) then left-to-right within a row. A regression that
 *      sorted by raw `y` would scatter same-row cards by sub-pixel
 *      jitter; sorting by floor(y/100) groups them.
 *
 *   2. **Per-component prop summarization** — every supported
 *      component type produces a one-line summary (chart type,
 *      table dimensions, code language, etc.). A regression that
 *      dropped a component type would silently make the bot blind
 *      to it.
 */

import { describe, it, expect } from "vitest";
import { canvasStateToImageDescription } from "../canvasImageUtils";

/**
 * Build a minimal CanvasCard fixture. Only the fields the function
 * reads need to be set; the rest are filled with safe defaults.
 */
function card(overrides: Partial<any> = {}): any {
  return {
    id: overrides.id ?? "card-1",
    component: overrides.component ?? "card",
    title: overrides.title,
    props: overrides.props ?? {},
    position: overrides.position ?? { x: 0, y: 0 },
    size: overrides.size ?? { width: 320, height: 200 },
    minimized: overrides.minimized ?? false,
    pinned: overrides.pinned ?? false,
    selected: overrides.selected ?? false,
    lastRenderError: overrides.lastRenderError,
  };
}

// ── Empty / single ──────────────────────────────────────────────────────────

describe("canvasStateToImageDescription — empty + single", () => {
  it("returns the empty-canvas sentinel when there are no cards", () => {
    expect(canvasStateToImageDescription([])).toBe(
      "The canvas is empty - no components are displayed.",
    );
  });

  it("describes a single card with title, position, and size", () => {
    const out = canvasStateToImageDescription([
      card({ component: "card", title: "Welcome", position: { x: 50, y: 80 }, size: { width: 320, height: 200 } }),
    ]);
    expect(out).toContain("Canvas contains 1 component:");
    expect(out).toContain("**Welcome** (card)");
    expect(out).toContain("Position: (50, 80)");
    expect(out).toContain("Size: 320x200");
  });

  it("uses the pluralized 'components' header when there are multiple cards", () => {
    const out = canvasStateToImageDescription([card({ id: "a" }), card({ id: "b" })]);
    expect(out).toContain("Canvas contains 2 components:");
  });

  it("falls back to component name (with underscores → spaces) when title is missing", () => {
    const out = canvasStateToImageDescription([
      card({ component: "data_table", title: undefined }),
    ]);
    // 'data_table' becomes 'data table' as the label.
    expect(out).toContain("**data table** (data_table)");
  });
});

// ── Status flags ────────────────────────────────────────────────────────────

describe("canvasStateToImageDescription — status flags", () => {
  it("appends [minimized] / [pinned] / [selected] in the right order when set", () => {
    const out = canvasStateToImageDescription([
      card({ title: "T", minimized: true, pinned: true, selected: true }),
    ]);
    expect(out).toContain("**T** (card) [minimized] [pinned] [selected]");
  });

  it("appends [error: ...] truncated to 60 chars when lastRenderError is set", () => {
    const longErr = "Component crashed: ".padEnd(120, "x");
    const out = canvasStateToImageDescription([
      card({ title: "T", lastRenderError: longErr }),
    ]);
    expect(out).toContain("[error:");
    // 60 chars after the prefix slice.
    expect(out).toMatch(/\[error: .{60}\]/);
  });

  it("omits status tags when none are set", () => {
    const out = canvasStateToImageDescription([card({ title: "T" })]);
    expect(out).not.toContain("[minimized]");
    expect(out).not.toContain("[pinned]");
    expect(out).not.toContain("[selected]");
    expect(out).not.toContain("[error:");
  });
});

// ── Reading order ───────────────────────────────────────────────────────────

describe("canvasStateToImageDescription — reading order", () => {
  it("sorts top-to-bottom by floor(y/100) row buckets, then left-to-right by x", () => {
    // Cards laid out:
    //   row 0 (y in [0, 99]):     B (x=200), A (x=100)
    //   row 1 (y in [100, 199]):  D (x=50),  C (x=300)
    // Expected reading order: A, B, D, C
    const cards = [
      card({ id: "B", title: "B", position: { x: 200, y: 50 } }),
      card({ id: "A", title: "A", position: { x: 100, y: 0 } }),
      card({ id: "C", title: "C", position: { x: 300, y: 150 } }),
      card({ id: "D", title: "D", position: { x: 50, y: 100 } }),
    ];
    const out = canvasStateToImageDescription(cards);

    const idxA = out.indexOf("**A**");
    const idxB = out.indexOf("**B**");
    const idxC = out.indexOf("**C**");
    const idxD = out.indexOf("**D**");
    expect(idxA).toBeGreaterThan(0);
    expect(idxA).toBeLessThan(idxB);
    expect(idxB).toBeLessThan(idxD);
    expect(idxD).toBeLessThan(idxC);
  });

  it("treats sub-100px y differences as the same row (jitter-tolerant)", () => {
    // Two cards 30px apart vertically — both in row 0. Order by x.
    const cards = [
      card({ id: "right", title: "right", position: { x: 300, y: 0 } }),
      card({ id: "left", title: "left", position: { x: 100, y: 30 } }),
    ];
    const out = canvasStateToImageDescription(cards);
    expect(out.indexOf("**left**")).toBeLessThan(out.indexOf("**right**"));
  });

  it("does not mutate the input array's order (sort is on a copy)", () => {
    const cards = [
      card({ id: "first", title: "first", position: { x: 0, y: 200 } }),
      card({ id: "second", title: "second", position: { x: 0, y: 0 } }),
    ];
    const beforeIds = cards.map((c) => c.id);
    canvasStateToImageDescription(cards);
    const afterIds = cards.map((c) => c.id);
    expect(afterIds).toEqual(beforeIds);
  });
});

// ── Per-component prop summarization ────────────────────────────────────────

describe("canvasStateToImageDescription — per-component summaries", () => {
  it("chart: includes type + title + data length", () => {
    const out = canvasStateToImageDescription([
      card({
        component: "chart",
        props: { type: "line", title: "Revenue", data: [1, 2, 3] },
      }),
    ]);
    expect(out).toContain("Chart type: line");
    expect(out).toContain('title: "Revenue"');
    expect(out).toContain("3 data points");
  });

  it("data_table: column count + row count", () => {
    const out = canvasStateToImageDescription([
      card({
        component: "data_table",
        props: { columns: ["a", "b", "c"], rows: [[1], [2], [3], [4]] },
      }),
    ]);
    expect(out).toContain("3 columns, 4 rows");
  });

  it("stat_grid: count of stat cards", () => {
    const out = canvasStateToImageDescription([
      card({ component: "stat_grid", props: { stats: [{ a: 1 }, { a: 2 }] } }),
    ]);
    expect(out).toContain("2 stat cards");
  });

  it("text_message: truncates body to 80 chars with ellipsis", () => {
    const longBody = "a".repeat(120);
    const out = canvasStateToImageDescription([
      card({ component: "text_message", props: { body: longBody } }),
    ]);
    expect(out).toMatch(/Text: "a{80}\.\.\."/);
  });

  it("code_block: language + line count", () => {
    const out = canvasStateToImageDescription([
      card({
        component: "code_block",
        props: { language: "typescript", code: "line 1\nline 2\nline 3" },
      }),
    ]);
    expect(out).toContain("Language: typescript");
    expect(out).toContain("3 lines");
  });

  it("alert: variant + optional title", () => {
    const out = canvasStateToImageDescription([
      card({ component: "alert", props: { variant: "warning", title: "Heads up" } }),
    ]);
    expect(out).toContain('warning alert: "Heads up"');
  });

  it("page: section count", () => {
    const out = canvasStateToImageDescription([
      card({
        component: "page",
        props: { sections: { hero: {}, footer: {}, body: {} } },
      }),
    ]);
    expect(out).toContain("Page with 3 sections");
  });

  it("unknown component types omit the summary line (no crash)", () => {
    const out = canvasStateToImageDescription([
      card({ component: "completely_made_up", props: { foo: "bar" } }),
    ]);
    // Header + position/size lines exist; no summary line.
    expect(out).toContain("(completely_made_up)");
    expect(out).toContain("Position:");
  });

  it("metric_card: label and value composed (number values render as-is)", () => {
    const out = canvasStateToImageDescription([
      card({ component: "metric_card", props: { label: "Users", value: 1234 } }),
    ]);
    expect(out).toContain("Users: 1234");
  });
});
