import type { CanvasCard } from "./types";
import { DEFAULT_CARD_SIZES, DEFAULT_CARD_SIZE } from "./types";

/**
 * Pure function: find a non-overlapping position for a new card.
 * Starts at viewport center, spirals outward.
 */
export function findOpenPosition(
  cards: CanvasCard[],
  viewport: { x: number; y: number },
  zoom: number,
  containerWidth: number,
  containerHeight: number,
  cardSize: { width: number; height: number }
): { x: number; y: number } {
  // Center of visible viewport in canvas coordinates
  const cx = (-viewport.x + containerWidth / 2) / zoom - cardSize.width / 2;
  const cy = (-viewport.y + containerHeight / 2) / zoom - cardSize.height / 2;

  // If no cards, place at center
  if (cards.length === 0) return { x: cx, y: cy };

  // Check center first, then spiral outward to find non-overlapping position
  const step = 40;
  const overlapsAny = (x: number, y: number) =>
    cards.some(
      (c) =>
        x < c.position.x + c.size.width &&
        x + cardSize.width > c.position.x &&
        y < c.position.y + c.size.height &&
        y + cardSize.height > c.position.y
    );

  // Ring 0: check center position directly
  if (!overlapsAny(cx, cy)) return { x: cx, y: cy };

  // Rings 1..N: spiral outward
  for (let ring = 1; ring <= 20; ring++) {
    for (let angle = 0; angle < 360; angle += 30) {
      const rad = (angle * Math.PI) / 180;
      const x = cx + Math.cos(rad) * step * ring;
      const y = cy + Math.sin(rad) * step * ring;

      if (!overlapsAny(x, y)) return { x, y };
    }
  }

  // Fallback: offset from last card
  const last = cards[cards.length - 1];
  return { x: last.position.x + 50, y: last.position.y + 50 };
}

/** Get the default size for a component type. */
export function getDefaultSize(component: string): { width: number; height: number } {
  return DEFAULT_CARD_SIZES[component] || DEFAULT_CARD_SIZE;
}

/** Get the current viewport container dimensions. */
export function getContainerSize(): { width: number; height: number } {
  if (typeof window === "undefined") return { width: 1200, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight - 120 };
}

// ── Component type ordering for tidy layout ─────────────────────────────────
// Compact KPI-style components come first (top row), then charts/tables, then misc.
const TYPE_ORDER: Record<string, number> = {
  header: 0,
  metric_card: 1,
  badge: 1,
  progress: 1,
  alert: 2,
  stat_grid: 2,
  chart: 3,
  data_table: 4,
  spreadsheet: 4,
  map: 5,
  code_editor: 5,
  sandbox: 6,
  video: 6,
};
const COMPACT_TYPES = new Set(["metric_card", "badge", "progress", "header", "alert", "button_group", "divider"]);
const GAP = 16;
const PADDING = 24;

/**
 * Arrange cards into a clean, organized grid layout.
 * - Groups compact cards (metric_card, badge, etc.) into rows
 * - Larger cards (chart, table, sandbox) get their own rows or pair up
 * - Resets card sizes to their defaults
 * - Returns new cards array with updated positions and sizes (immutable).
 */
export function tidyLayout(cards: CanvasCard[], containerWidth: number): CanvasCard[] {
  if (cards.length === 0) return cards;

  // Available width for laying out cards
  const maxWidth = Math.max(600, containerWidth - PADDING * 2);

  // Sort cards by type priority, preserving original order within same type
  const sorted = [...cards].sort((a, b) => {
    const oa = TYPE_ORDER[a.component] ?? 10;
    const ob = TYPE_ORDER[b.component] ?? 10;
    return oa - ob;
  });

  // Reset all card sizes to defaults
  const sized = sorted.map((card) => ({
    ...card,
    size: DEFAULT_CARD_SIZES[card.component] || DEFAULT_CARD_SIZE,
  }));

  // Pack cards into rows using a simple greedy row-packing algorithm
  const result: CanvasCard[] = [];
  let y = PADDING;
  let i = 0;

  while (i < sized.length) {
    const card = sized[i];
    const isCompact = COMPACT_TYPES.has(card.component);

    if (isCompact) {
      // Pack as many compact cards as fit in one row
      const row: typeof sized = [];
      let rowWidth = 0;
      while (i < sized.length && COMPACT_TYPES.has(sized[i].component)) {
        const c = sized[i];
        const needed = rowWidth > 0 ? c.size.width + GAP : c.size.width;
        if (rowWidth > 0 && rowWidth + needed > maxWidth) break;
        row.push(c);
        rowWidth += needed;
        i++;
      }
      // Center the row if it's narrower than maxWidth
      const totalRowWidth = row.reduce((sum, c) => sum + c.size.width, 0) + GAP * (row.length - 1);
      let x = PADDING + Math.max(0, (maxWidth - totalRowWidth) / 2);
      const rowHeight = Math.max(...row.map((c) => c.size.height));
      for (const c of row) {
        result.push({ ...c, position: { x, y } });
        x += c.size.width + GAP;
      }
      y += rowHeight + GAP;
    } else {
      // Non-compact: try to fit two side-by-side if they both fit
      const next = i + 1 < sized.length ? sized[i + 1] : null;
      const canPair = next && !COMPACT_TYPES.has(next.component) &&
        card.size.width + GAP + (next?.size.width ?? 0) <= maxWidth;

      if (canPair && next) {
        const pairWidth = card.size.width + GAP + next.size.width;
        const x = PADDING + Math.max(0, (maxWidth - pairWidth) / 2);
        const rowHeight = Math.max(card.size.height, next.size.height);
        result.push({ ...card, position: { x, y } });
        result.push({ ...next, position: { x: x + card.size.width + GAP, y } });
        y += rowHeight + GAP;
        i += 2;
      } else {
        // Single card — center it
        const x = PADDING + Math.max(0, (maxWidth - card.size.width) / 2);
        result.push({ ...card, position: { x, y } });
        y += card.size.height + GAP;
        i++;
      }
    }
  }

  return result;
}
