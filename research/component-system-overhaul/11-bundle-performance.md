# Report 11: Bundle Optimization & Frontend Performance Deep Dive

**Agent**: bundle-perf-analyzer
**Status**: COMPLETE
**Date**: 2026-02-27

## Executive Summary

Comprehensive analysis of Jarble's frontend bundle, rendering pipeline, and performance optimization opportunities. Examined lazy-loading strategies, chart library overhead, canvas virtualization, React.memo opportunities, SSE streaming performance, and CSS optimization.

**Key findings**: ~350-500KB savings from removing orphaned Ant Design dependencies, ~250KB from lazy-loading heavy components in registry, major re-render reduction from React.memo on CanvasRenderer and all canvas components.

---

## 1. Lazy Loading Strategy for 56+ Components

### Current Problem

`registry.ts` eagerly imports all 24 registered components at the top level (lines 11-33). When any page imports `registry.ts` (which `CanvasRenderer.tsx` does), the entire bundle for all components is pulled in — including recharts (~45KB gzipped), framer-motion, Monaco editor, fortune-sheet, and leaflet.

Some heavy components already use `next/dynamic` internally (CanvasCodeEditor, CanvasSpreadsheet, CanvasMap), but the registry still eagerly resolves each module's default export.

### Recommended: `next/dynamic` at Registry Level

For Next.js 15, `next/dynamic` is preferred over raw `React.lazy` because it handles SSR, integrates with chunk naming, and supports loading fallbacks.

**Tiered approach**:

```typescript
// registry.ts — AFTER (lazy-loaded)
import dynamic from "next/dynamic";

const ComponentSkeleton = () => (
  <div className="h-full w-full animate-pulse rounded-lg bg-muted/30" />
);

function lazyComponent(loader: () => Promise<{ default: ComponentType<any> }>) {
  return dynamic(loader, { loading: ComponentSkeleton, ssr: false });
}

// Tier 1: Lightweight (~1-3KB each) — keep eager
import CanvasCard from "./components/CanvasCard";
import CanvasAlert from "./components/CanvasAlert";
import CanvasProgress from "./components/CanvasProgress";
// ... 8 more lightweight components

// Tier 2: Medium deps — lazy load
const CanvasDataTable = lazyComponent(() => import("./components/CanvasDataTable"));
const CanvasStatGrid = lazyComponent(() => import("./components/CanvasStatGrid"));
const CanvasLayout = lazyComponent(() => import("./components/CanvasLayout"));
// ... 6 more medium components

// Tier 3: Heavy library deps — lazy load
const CanvasChart = lazyComponent(() => import("./components/CanvasChart"));         // recharts ~45KB
const CanvasCodeEditor = lazyComponent(() => import("./components/CanvasCodeEditor")); // monaco ~500KB
const CanvasSpreadsheet = lazyComponent(() => import("./components/CanvasSpreadsheet")); // fortune-sheet ~200KB
const CanvasSandbox = lazyComponent(() => import("./components/CanvasSandbox"));
```

**Estimated impact**: Initial page load chunk shrinks by ~250-300KB (uncompressed).

### Suspense Boundaries

Place a Suspense boundary inside `CanvasRenderer.tsx`, wrapping the `<Component {...validatedProps} />`:

```typescript
<Suspense fallback={<div className="h-full w-full animate-pulse rounded-lg bg-muted/30" />}>
  <Component {...validatedProps} />
</Suspense>
```

Each card independently shows a loading skeleton while its chunk loads.

---

## 2. Bundle Analysis Tools

### @next/bundle-analyzer Setup

```typescript
// next.config.ts
const withBundleAnalyzer = process.env.ANALYZE === "true"
  ? require("@next/bundle-analyzer")({ enabled: true })
  : (config: NextConfig) => config;
```

### Tree-Shaking Assessment

| Library | Size (gzipped) | Tree-shakeable? | Current State | Action |
|---------|---------------|-----------------|---------------|--------|
| `recharts` | ~45KB | Partial | `optimizePackageImports` ✅ | Lazy-load at registry |
| `@ant-design/plots` | ~150-300KB | Poor (G2 core) | `next/dynamic` per component | **Delete orphaned files** |
| `framer-motion` | ~35KB | Good | `optimizePackageImports` ✅ | Already good |
| `@xyflow/react` | ~60KB | Moderate | **NOT optimized** | Add to optimizePackageImports |
| `monaco-editor` | ~500KB | No | `next/dynamic` ✅ | Already good |
| `antd` | ~200KB | Good | **NOT optimized** | Add to optimizePackageImports |
| `lucide-react` | ~200KB raw | Good | `optimizePackageImports` ✅ | Already good |

### Immediate next.config.ts Fix

```typescript
experimental: {
  optimizePackageImports: [
    "lucide-react", "framer-motion", "recharts", "date-fns",
    "@xyflow/react",              // ADD
    "antd",                       // ADD
    "@ant-design/plots",          // ADD (if keeping)
    "@radix-ui/react-accordion",  // ADD
    "@radix-ui/react-dialog",     // ADD
    "@radix-ui/react-tabs",       // ADD
  ],
},
```

---

## 3. Chart Library Bundle Optimization

### Current State

- **recharts** (~45KB gzipped): Used in 2 registered components — `CanvasChart.tsx` and `CanvasMetricCard.tsx`
- **@ant-design/plots** (~150-300KB gzipped): Used in **22 orphaned component files** NOT registered in `registry.ts`
- **antd** (~200KB): Only used for `ConfigProvider` in `AntThemeProvider.tsx`

### Recommendation: Delete Orphaned Ant Design Files (Option A)

**Rationale**:
1. 22 Ant Design chart components are dead code — none registered, bots cannot render them
2. `@ant-design/plots` pulls in `@antv/g2` (~150KB gzipped, not tree-shakeable)
3. `antd` (~200KB) is only used for theming these orphaned charts
4. recharts covers bar/line/pie/area — ~95% of bot-generated charts
5. Specialized charts (sankey, treemap, heatmap) can be rendered via `sandbox` component with CDN libs

**Implementation**:
1. Delete all 22 orphaned Ant Design canvas component files
2. Delete `AntThemeProvider.tsx`
3. Remove from package.json: `@ant-design/plots`, `antd`, `@ant-design/cssinjs`
4. Run `pnpm install` to clean lock file

**Estimated savings**: ~350-500KB removed from dependency tree.

---

## 4. Canvas Virtualization for 20+ Cards

### Why Standard Virtualizers Don't Apply

`SimpleCanvasGrid.tsx` renders cards with absolute positioning (freeform canvas). Standard virtualizers (`react-window`, `react-virtuoso`, `@tanstack/react-virtual`) assume list/grid flow — not freeform absolute positioning.

### Recommended: Intersection Observer for Lazy Mount/Unmount

```typescript
// hooks/useVisibleCards.ts
export function useVisibleCards(
  containerRef: React.RefObject<HTMLDivElement | null>,
  cards: CanvasCard[],
  rootMargin = "200px"
): Set<string> {
  // IntersectionObserver tracks which cards are visible
  // Cards outside viewport render lightweight placeholder
  // rootMargin="200px" pre-renders nearby cards (no visible pop-in)
  // ...
}
```

**Usage in SimpleCanvasGrid**: Cards outside viewport render `<div className="bg-muted/10 border" />` instead of full component tree.

**Expected impact**: With 20+ cards where only 5-8 are visible, avoids mounting ~12-15 component trees.

---

## 5. React.memo and Re-render Prevention

### Current Problem

Zero `React.memo` usage in the canvas component tree. Rendering pipeline:

```
SimpleCanvasGrid (re-renders on any state change)
  → renderCard (recreated per render)
    → CardContent (memo'd ✅)
      → CanvasRenderer (NO memo ❌)
        → CanvasActionProvider
          → Canvas{Component} (NO memo ❌)
```

### Where to Apply React.memo

**P0: CanvasRenderer** — Performs Zod validation on every render. Memoize + useMemo on validation:

```typescript
const CanvasRenderer = memo(function CanvasRenderer({ block, onAction }) {
  const validationResult = useMemo(
    () => entry?.propsSchema.safeParse(block.props) ?? null,
    [entry, block.props]
  );
  // ...
});
```

**P1: All 24 Canvas Components** — Wrap with `memo`. Since props come as validated plain objects, shallow comparison works.

**P2: Extract Memoized CanvasCardShell** — When card A is dragged, cards B, C, D should not re-render:

```typescript
const CanvasCardShell = memo(function CanvasCardShell({
  card, renderCard, isStreaming, ...
}) {
  return <motion.div ...>{renderCard(card)}</motion.div>;
});
```

---

## 6. SSE/Streaming Performance

### Current State

- Text deltas throttled to 50ms (20fps) — **reasonable, no change needed**
- String accumulation + `stripUIMarkers` regex runs on full text every 50ms

### Optimization

```typescript
// Only run regex when text contains a fenced block marker
const hasMarkers = accumulatedText.includes("```jarble_ui");
setStreamingText(hasMarkers ? stripUIMarkers(accumulatedText) : accumulatedText);
```

**MessagePack/Binary**: Not recommended — SSE events are small (<1KB), JSON parse overhead is <0.01ms.

**Web Worker**: Not recommended — single-line JSON.parse at <1KB is faster inline than postMessage overhead.

---

## 7. Image/Media Optimization

Add native lazy loading to `CanvasImage.tsx`:

```typescript
<img src={src} alt={alt || ""} loading="lazy" decoding="async" className="..." />
```

With Intersection Observer virtualization, off-screen card images won't be mounted at all.

---

## 8. CSS Performance

### Tailwind v4

No runtime JS overhead. CSS generated at build time. **No action needed.**

### Inline Style Block

`SimpleCanvasGrid.tsx` has `<style dangerouslySetInnerHTML>` with `@keyframes` — re-inserted on every render. **Move to CSS file**:

```css
@keyframes canvas-streaming-glow {
  0%, 100% { box-shadow: 0 0 6px 0 hsl(var(--primary) / 0.2); }
  50% { box-shadow: 0 0 14px 2px hsl(var(--primary) / 0.35); }
}
.canvas-card-streaming {
  animation: canvas-streaming-glow 2s ease-in-out infinite;
}
```

---

## Priority-Ordered Action Items

| Priority | Action | Bundle Impact | Effort |
|----------|--------|---------------|--------|
| **P0** | Delete 22 orphaned Ant Design files + remove deps | -350KB+ | 30 min |
| **P0** | Lazy-load heavy components in registry.ts | -250KB initial | 1 hour |
| **P1** | React.memo on CanvasRenderer + all 24 components | Re-render reduction | 2 hours |
| **P1** | Add antd, @xyflow/react, Radix to optimizePackageImports | -50KB | 10 min |
| **P1** | Cache Zod validation with useMemo | CPU savings | 20 min |
| **P2** | Extract memoized CanvasCardShell | Prevent cascade re-renders | 1 hour |
| **P2** | Intersection Observer virtualization for 20+ cards | DOM reduction | 3 hours |
| **P2** | Move inline <style> keyframes to CSS file | Avoid CSSOM recalc | 15 min |
| **P3** | Add loading="lazy" to CanvasImage | Network optimization | 5 min |
| **P3** | Optimize stripUIMarkers with early-exit | Minor CPU savings | 5 min |
| **P3** | Set up @next/bundle-analyzer for CI | Process improvement | 30 min |
