# Report 5: Frontend Bundle + Rendering Performance

**Agent**: frontend-perf-analyzer
**Status**: COMPLETE

## Critical Findings

### FINDING 1: Registry eagerly imports ALL 24 canvas components (HIGH)
`registry.ts` uses static imports for all 24 components. Every component pulled into initial JS bundle for `/d/[id]` even though a typical session uses 3-5 types.

**Impact**: Several have heavy sub-deps:
- `CanvasChart` eagerly imports recharts (~200KB gzipped)
- `CanvasCodeEditor` uses `dynamic()` — GOOD
- `CanvasSpreadsheet` uses `dynamic()` — GOOD
- `CanvasVideo` uses `dynamic()` — GOOD

**Fix**: Convert registry to lazy loading with `React.lazy()` or `next/dynamic`.

### FINDING 2: @xyflow/react NOT lazy-loaded on /deployments (HIGH)
Static import in `Deployments.tsx`. ~150KB gzipped. Could leak into shared chunks.

**Fix**: Wrap in `dynamic(() => import("@/views/Deployments"), { ssr: false })`.

### FINDING 3: recharts eagerly imported (HIGH)
Listed in `optimizePackageImports` but still in main bundle because `CanvasChart` is eagerly imported by registry. ~200KB gzipped.

**Fix**: Resolved automatically if registry is made lazy (Finding 1).

### FINDING 4: Two chart libraries — recharts AND @ant-design/plots (MEDIUM)
- **recharts**: Used ONLY in `CanvasChart.tsx`
- **@ant-design/plots**: Used in 29 orphaned component files (NOT in registry, NOT imported)
- **antd**: Only in 2 orphaned files

The 29 Ant Design chart files are dead code (never imported by registry).

**Fix**:
1. Delete 29 orphaned Ant Design files (or register them — see component audit)
2. Remove @ant-design/plots, @ant-design/cssinjs, antd from package.json if not registering

### FINDING 5: Unused dependencies (MEDIUM)
- `react-grid-layout` — only in type declarations
- `leaflet` + `react-leaflet` — not imported anywhere
- `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` — not in frontend code

### FINDING 6: No React.memo on canvas components (MEDIUM)
- CanvasRenderer not wrapped in React.memo
- None of the 24 canvas components use React.memo
- Canvas reducer dispatch causes all cards to re-render

**Fix**: Wrap CanvasRenderer in React.memo, consider virtualization for 10+ cards.

### FINDING 7: SSE streaming already well-optimized (LOW — good)
Text deltas throttled to 50ms (20fps). Good stateRef pattern avoids stale closures. Generation counter prevents abort races.

### FINDING 8: framer-motion acceptable (LOW)
~32KB gzipped. Used on both major pages. In `optimizePackageImports`. Keep as-is.

### FINDING 9: Inline style on every render (LOW)
`dangerouslySetInnerHTML` for CSS in SimpleCanvasGrid.tsx. Move to CSS file.

## Summary

| Priority | Action | Bundle Savings | Effort |
|----------|--------|---------------|--------|
| P0 | Lazy-load canvas registry | ~200KB (recharts) | Medium |
| P0 | Dynamic import Deployments view | ~150KB (@xyflow) | Low |
| P1 | Delete/register 29 orphaned Ant files | Cleanup | Low |
| P1 | Remove unused deps | Install time | Low |
| P2 | React.memo on CanvasRenderer | Re-render reduction | Low |
| P2 | Move inline CSS to stylesheet | Minor perf | Trivial |

**Total estimated bundle savings: ~350KB gzipped from P0 items alone.**
