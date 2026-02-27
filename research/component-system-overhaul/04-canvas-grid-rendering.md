# Report 4: Canvas Grid Rendering & Layout Quality

**Agent**: canvas-renderer-auditor
**Status**: COMPLETE

## Architecture

The canvas uses `SimpleCanvasGrid.tsx` — a CSS Grid layout (not react-grid-layout). Components flow naturally at content size with drag-to-reorder support.

### Grid Configuration
- CSS Grid with `grid-template-columns: repeat(auto-fill, minmax(300px, 1fr))`
- Gap: 16px
- Cards size to content by default
- Drag-to-reorder via custom DnD implementation (not a library)

### Component Sizing
- Components specify internal padding (`p-3 h-full`) but no explicit size hints
- Charts/tables expand to fill grid cell
- No min-height/max-height constraints on individual cards

## Findings

### What Works Well
- CSS Grid auto-fill is responsive and handles variable component counts
- Drag-to-reorder is implemented with smooth visual feedback
- Split/merge works reliably for stat_grid, key_value, descriptions
- Error boundary in CanvasRenderer catches individual component crashes
- AnimatePresence provides enter/exit animations

### Issues Found

**1. No virtualization** — All cards render regardless of viewport visibility. With 30+ cards, this causes unnecessary DOM nodes and potential jank.

**2. Overflow handling inconsistent** — Some components (data_table) have internal scroll, others (chart with long legend) can overflow their grid cell.

**3. No explicit card size control** — Users can't resize cards. Everything is auto-sized. A wide chart gets the same width as a small badge.

**4. Mobile responsiveness limited** — Grid works down to ~320px but cards become very narrow. No mobile-specific layout.

**5. Z-index issues with dropdowns** — Select/dropdown elements inside grid cards can be clipped by adjacent cards' overflow.

**6. Inline style tag on every render** — `dangerouslySetInnerHTML` for glow CSS re-creates style element on each render.

**7. No size categories** — Components don't declare whether they need "small" (badge), "medium" (card), or "large" (data_table, chart) space.

## Recommendations

1. **Add size hints to components** — Registry should declare `size: "sm" | "md" | "lg" | "full"` per component type
2. **Grid span support** — Large components (`data_table`, `chart`) should span 2 columns when available
3. **Virtualize** — Use intersection observer to only render visible cards (important for 20+ card scenarios)
4. **Fix overflow** — Add `overflow: hidden` on card containers, let components handle their own scrolling
5. **Move inline CSS to stylesheet** — Minor but clean improvement
6. **Consider manual resize** — Allow users to drag-resize card edges (would need react-rnd or similar)

## Key Files
- `Jarble-mvp/components/workspace/SimpleCanvasGrid.tsx` — grid layout
- `Jarble-mvp/components/workspace/canvasReducer.ts` — state management
- `Jarble-mvp/components/workspace/types.ts` — CanvasCard types
- `Jarble-mvp/components/canvas/CanvasRenderer.tsx` — rendering + error boundaries
