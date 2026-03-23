# Streaming & Parser Evaluation — llm-ui NO-GO + Alternative

**Date**: 2026-02-28
**Agent**: streaming-researcher
**Status**: Complete

---

## Verdict: NO-GO on llm-ui

### Reasons

1. **Architectural mismatch** — llm-ui renders blocks inline in chat; Jarble dispatches to separate canvas grid
2. **No fenced block support** — Only supports single-character delimiters (`【】`), not triple-backtick fenced blocks with language tags
3. **Backend regression** — Would require moving parsing from server to client (currently blocks are pre-parsed via SSE events)
4. **Pre-1.0 library** — v0.13.3, no updates in ~2 years
5. **Bundle cost** — ~200KB for functionality we don't need
6. **No priority ordering** — Can't handle define > update > render extraction order

### The Real Problem

Blocks only extract on `state: "final"` in `openclawGateway.ts`. During streaming, raw text (including partial blocks) is forwarded, then blocks appear in a burst at the end.

## Alternative: Incremental Block Extraction (4 days, 0 dependencies)

### Phase A: Backend incremental parsing (2-3 days)

Modify `openclawGateway.ts` to extract complete blocks on each `state: "delta"`:

```typescript
const emittedBlockIds = new Set<string>();
if (state === "delta") {
  fullText = text;
  const { uiBlocks } = extractUIBlocks(fullText);
  for (const block of uiBlocks) {
    if (!emittedBlockIds.has(block.id)) {
      emittedBlockIds.add(block.id);
      onBlockDetected?.(block);
    }
  }
  onDelta?.(text);
}
```

### Phase B: Fix nested backtick regex (1 day)

Replace greedy regex with JSON-aware parser tracking brace depth.

### Phase C: rAF smoothing (0.5 days, optional)

Add `requestAnimationFrame` throttle to `setStreamingText` in `useCanvasChat.ts` (~20 lines).

## Effort Comparison

| Approach | Effort | Risk | New Dependencies |
|----------|--------|------|------------------|
| Adopt llm-ui | 3-4 weeks | Critical | 5+ packages (~200KB) |
| **Alternative** | **4 days** | **Low** | **0** |
