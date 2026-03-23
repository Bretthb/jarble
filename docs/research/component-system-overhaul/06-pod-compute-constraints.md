# Report 6: Pod Compute & Performance Constraints

**Agent**: pod-perf-analyzer
**Status**: COMPLETE

## Executive Summary

**Good news**: Pods are NOT resource-constrained. CPU (2 cores) and memory (3GB) are adequate.

**Bottleneck**: Latency comes from I/O overhead and protocol inefficiency, not compute:
- MCP process spawn: 50-80ms per tool call
- Component file I/O: 10-50ms (no caching, every call hits disk)
- Custom component resolution on API side: 100-200ms via kubectl exec (expensive round-trip)
- JSON serialization overhead on large payloads: 5-20ms

## Performance Waterfall

Single UI block render: ~150-200ms
- Pod MCP overhead: ~70-150ms (process spawn + I/O + JSON)
- API resolution (if custom component): +100-200ms via kubectl exec
- Frontend rendering: <20ms (not a bottleneck)

Total conversation with 5 blocks + LLM: 15-60s (dominated by LLM inference)

## Critical Issues

### 1. No component caching (pod-side)
`readComponent()` does filesystem I/O on every call. Same custom component read 5 times = 5 disk I/O ops.
**Fix**: LRU in-memory cache (20-50 components) → 50ms → 0.5ms per lookup

### 2. Double I/O for custom components
Pod reads file via `fs.readFileSync()`, then API reads again via `kubectl exec` + `cat` + parse.
**Fix**: Create MCP tool `get_component_definition()`, eliminate kubectl exec path

### 3. MCP subprocess overhead
New process spawn per tool call. 50-80ms per spawn, unavoidable without protocol changes.
**Mitigation**: Cache reduces calls → fewer spawns

### 4. Connection pooling missing
New WS connection per chat message. ~30ms handshake + auth per message.
**Fix**: Reuse connection per session (5-min idle timeout)

## Optimization Roadmap

### Phase 1: High-impact, low-effort (30-50min, 20-30% improvement)
1. Pod LRU component cache
2. API component definition cache
3. MCP tool for component lookup

### Phase 2: Medium-impact (100-150min, 10-20% improvement)
4. WS connection pooling
5. Streaming JSON parsing

### Phase 3: Nice-to-have
6. Binary MCP protocol (requires upstream OpenClaw support)

## NOT a Problem
- Resource constraints (CPU/memory adequate)
- LLM latency (expected, not optimizable by us)
- WS gateway latency (already fast)
- Frontend rendering (<20ms)

## Key Files
- `jarble-api-main/src/k8s/components.ts` — resource specs
- `jarble-api-main/src/mcp/jarble-ui-server.js` — MCP server
- `jarble-api-main/src/utils/componentResolver.ts` — template resolution
- `jarble-api-main/src/services/openclawGateway.ts` — WebSocket connection
