# Error Resilience Implementation Roadmap

## Phase 1: Backend Validation (2-3 hours)

### 1a. Add Zod Validation Before SSE Emission

**File**: `jarble-api-main/src/routes/tamboAgent.ts`

**Changes**:
```typescript
// Import at top
import { CANVAS_COMPONENTS } from "../components/registry.js"; // NEEDS TO BE IMPORTABLE FROM FRONTEND

// Inside emitGatewayResult() after line 304
for (const block of resolvedBlocks) {
  // NEW: Validate against registry before emitting
  const entry = CANVAS_COMPONENTS[block.component];
  if (entry) {
    const validationResult = entry.propsSchema.safeParse(block.props);
    if (!validationResult.success) {
      // Don't emit invalid block — emit error instead
      logger.warn({
        deploymentId,
        component: block.component,
        blockId: block.id,
        errors: validationResult.error.flatten(),
      }, "UI block validation failed");

      sendEvent(res, {
        type: "UI_BLOCK_ERROR",
        blockId: block.id,
        component: block.component,
        reason: "validation_failed",
        errors: validationResult.error.issues.map(i => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      continue; // Skip this block
    }
  }

  // EXISTING: emit the block
  sendEvent(res, {
    type: "UI_BLOCK_START",
    blockId: block.id,
    component: block.component,
    messageId,
    ...(block.editable ? { editable: true } : {}),
    ...(block.fileId ? { fileId: block.fileId } : {}),
    ...(block.saveMethod ? { saveMethod: block.saveMethod } : {}),
    ...(block.layoutHint ? { layoutHint: block.layoutHint } : {}),
  });
  sendEvent(res, { type: "UI_BLOCK_PROPS", blockId: block.id, props: block.props });
  sendEvent(res, { type: "UI_BLOCK_END", blockId: block.id });
}
```

**Challenge**: CANVAS_COMPONENTS is in frontend (registry.ts). Options:
1. Extract to shared package (complex)
2. Duplicate registry in backend (maintenance burden)
3. Use a simpler schema validation (JSON.stringify size checks only)
4. Keep Zod schemas in backend only (best option)

**Best Approach**: Create `jarble-api-main/src/schemas/canvasSchemas.ts` with Zod schemas, import in both backend and frontend.

---

### 1b. Add JSON Stringify Safety

**File**: `jarble-api-main/src/routes/tamboAgent.ts` → `sendEvent()` function

**Current**:
```typescript
function sendEvent(res: any, event: Record<string, unknown>) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
```

**Improved**:
```typescript
function sendEvent(res: any, event: Record<string, unknown>) {
  if (res.writableEnded) return;
  try {
    const json = JSON.stringify(event);
    res.write(`data: ${json}\n\n`);
  } catch (err) {
    logger.error({ event, error: err instanceof Error ? err.message : String(err) }, "Failed to stringify SSE event");
    // Send error event instead
    try {
      res.write(`data: ${JSON.stringify({
        type: "SSE_SERIALIZATION_ERROR",
        message: "Failed to serialize event data",
      })}\n\n`);
    } catch {
      // Give up — connection is doomed
    }
  }
}
```

---

### 1c. Add Content-Length Headers

**File**: `jarble-api-main/src/routes/tamboAgent.ts`

**Change**: Before sending a block, include size metadata
```typescript
const propsJson = JSON.stringify(block.props);
sendEvent(res, {
  type: "UI_BLOCK_PROPS",
  blockId: block.id,
  props: block.props,
  _meta: {
    propsSize: propsJson.length,
    propsChecksum: crypto
      .createHash("sha256")
      .update(propsJson)
      .digest("hex")
      .slice(0, 8),
  },
});
```

---

## Phase 2: Frontend Resilience (2-3 hours)

### 2a. Timeout Pending Blocks

**File**: `Jarble-mvp/components/tambo/StreamingBotMessage.tsx`

**In consumeSSE() function**:
```typescript
async function consumeSSE(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onText: (fullText: string) => void,
  onBlock: (block: UIBlock) => void,
  signal: AbortSignal,
  onUpdate?: (update: UIBlockUpdate) => void,
) {
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let eventCount = 0;
  let textChunks = 0;
  const pendingBlocks = new Map<string, UIBlock>();
  const blockStartTimes = new Map<string, number>(); // NEW: Track when block started
  const BLOCK_TIMEOUT_MS = 5000; // NEW: 5 second timeout

  // ... existing code ...

  while (!signal.aborted) {
    const { done, value } = await reader.read();
    if (done) {
      // NEW: Check for orphaned blocks
      const orphaned = Array.from(blockStartTimes.entries())
        .filter(([_, startTime]) => Date.now() - startTime > BLOCK_TIMEOUT_MS)
        .map(([blockId, _]) => blockId);

      if (orphaned.length > 0) {
        console.warn("[Jarble:SSE] Abandoned pending blocks (timeout):", orphaned);
        // Could emit error events or clean up
      }
      break;
    }

    // ... existing event processing ...

    for (const line of lines) {
      if (signal.aborted) break;

      const trimmed = line.trim();
      if (!trimmed.startsWith("data: ")) continue;

      try {
        const event = JSON.parse(trimmed.slice(6));
        eventCount++;

        if (event.type === "UI_BLOCK_START") {
          console.log("[Jarble:SSE] UI_BLOCK_START:", event.blockId);
          blockStartTimes.set(event.blockId, Date.now()); // NEW: Record time
          pendingBlocks.set(event.blockId, {
            id: event.blockId,
            component: event.component,
            props: {},
            ...(event.editable ? { editable: true } : {}),
            ...(event.fileId ? { fileId: event.fileId } : {}),
            ...(event.saveMethod ? { saveMethod: event.saveMethod } : {}),
          });
        } else if (event.type === "UI_BLOCK_PROPS") {
          const block = pendingBlocks.get(event.blockId);
          if (block) {
            block.props = event.props;
            // NEW: Validate checksum if present
            if (event._meta?.propsChecksum) {
              const actualChecksum = crypto
                .createHash("sha256")
                .update(JSON.stringify(event.props))
                .digest("hex")
                .slice(0, 8);
              if (actualChecksum !== event._meta.propsChecksum) {
                console.warn("[Jarble:SSE] Checksum mismatch:", event.blockId, event._meta.propsChecksum, "vs", actualChecksum);
                // Could mark block as corrupted
              }
            }
          } else {
            console.warn("[Jarble:SSE] UI_BLOCK_PROPS for unknown blockId:", event.blockId);
          }
        } else if (event.type === "UI_BLOCK_END") {
          const block = pendingBlocks.get(event.blockId);
          if (block) {
            blockStartTimes.delete(event.blockId); // NEW: Clear timeout tracker
            console.log("[Jarble:SSE] UI_BLOCK_END:", event.blockId);
            onBlock({ ...block });
            pendingBlocks.delete(event.blockId);
          } else {
            console.warn("[Jarble:SSE] UI_BLOCK_END for unknown blockId:", event.blockId);
          }
        } else if (event.type === "UI_BLOCK_ERROR") { // NEW
          console.warn("[Jarble:SSE] UI_BLOCK_ERROR:", event.blockId, event.errors);
          blockStartTimes.delete(event.blockId);
          pendingBlocks.delete(event.blockId);
          // Could emit error UI to user
        } else if (event.type === "SSE_SERIALIZATION_ERROR") { // NEW
          console.error("[Jarble:SSE] SSE_SERIALIZATION_ERROR:", event.message);
          // Stream is likely corrupted — consider reconnect
        }
      } catch (e) {
        console.warn("[Jarble:SSE] Malformed JSON line:", trimmed.slice(0, 100), "error:", e);
      }
    }
    if (finished) break;
  }

  if (signal.aborted) {
    console.log("[Jarble:SSE] consumeSSE ended (aborted)");
  }
}
```

---

### 2b. Render Error Feedback

**File**: `Jarble-mvp/components/canvas/CanvasRenderer.tsx`

**Modify ComponentErrorCard**:
```typescript
function ComponentErrorCard({
  componentName,
  error,
  blockId,
  onAction,
}: {
  componentName: string;
  error: string;
  blockId: string;
  onAction?: (action: CanvasAction) => void;
}) {
  const [feedbackSent, setFeedbackSent] = useState(false);

  const handleReportError = () => {
    onAction?.({
      blockId,
      component: componentName,
      action: "component_error_report",
      payload: {
        error,
        component: componentName,
        timestamp: new Date().toISOString(),
      },
    });
    setFeedbackSent(true);
  };

  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-xs space-y-3">
      <div className="flex items-start gap-2 text-red-400">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <div className="min-w-0">
          <p className="font-medium">
            <code>{componentName}</code> failed to render
          </p>
          <p className="mt-1 text-red-400/80 break-words">{error}</p>
        </div>
      </div>
      {onAction && (
        <div className="flex items-center gap-2">
          <button
            onClick={handleReportError}
            disabled={feedbackSent}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50 transition-colors text-xs font-medium"
          >
            <Bell className="w-3 h-3" />
            {feedbackSent ? "Error reported" : "Tell bot about this"}
          </button>
          <button
            onClick={() =>
              onAction({
                blockId,
                component: componentName,
                action: "component_abandon",
                payload: {},
              })
            }
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors text-xs font-medium"
          >
            <X className="w-3 h-3" />
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
```

---

## Phase 3: Bot Self-Correction (1-2 hours)

### 3a. Update soul.md

Add this section to the bot's system prompt:

```markdown
## Component Rendering & Error Recovery

When you generate UI components with jarble_ui blocks, they are validated and rendered in real-time.

### If a component fails:

If you see a message like:
```
[COMPONENT_ERROR] chart: "Invalid props: data array is empty"
```

This means your component definition had invalid data. When this happens:
1. **Read the error carefully** — it tells you exactly what's wrong
2. **Provide correct data** — don't repeat the same structure
3. **Acknowledge the fix** — say "I see — let me provide the data properly"

### Example error recovery:

```
User: "Show a sales chart"
You: {"component":"chart","type":"bar","data":[],"dataKeys":["sales"]}
[ERROR] data array is empty
You: I see the chart needs actual data. Here's the sales information:
{"component":"chart","type":"bar","data":[
  {"month":"Jan","sales":1000},
  {"month":"Feb","sales":1200},
  {"month":"Mar","sales":1400}
],"dataKeys":["sales"]}
```

### Why this matters:

- **Invalid data** (empty arrays, wrong types) causes components to fail
- **Silent failures** are confusing — I'll tell you immediately what broke
- **Your feedback helps** — error messages include what was invalid and why

### Types of errors you might see:

| Error | Cause | Fix |
|-------|-------|-----|
| "data array is empty" | Chart/table has no rows | Provide actual data: `[{...}, {...}]` |
| "Invalid enum value" | Wrong status/variant | Check allowed values in component reference |
| "Title must be string" | Passed a number or null | Convert to string: `"title": String(value)` |
| "Unknown component" | Used a custom component that wasn't defined | Use only built-in components unless you've defined the custom one |

### Best practices:

- Always provide sample data — don't generate empty datasets
- Use the component reference to check valid prop values
- Test different data sizes — some components work better with more/fewer items
- When in doubt, use simple components like `card` or `alert`
```

---

### 3b. Modify Soul Prompt to Encourage Validation

```markdown
## Data Quality Checklist

Before emitting a component, verify:
- [ ] Non-empty data arrays (at least 1 item)
- [ ] Correct data types (strings vs numbers)
- [ ] Required fields present
- [ ] Valid enum values
- [ ] Reasonable sizes (< 100 items for initial display)

If any fail, provide corrected data.
```

---

## Phase 4: Monitoring & Metrics (1 hour)

### 4a. Add Error Metrics to Logger

**File**: `jarble-api-main/src/routes/tamboAgent.ts`

```typescript
const metrics = {
  blocksEmitted: 0,
  blocksValidationFailed: 0,
  blockPropsErrors: 0,
  stringifyErrors: 0,
  checksumMismatches: 0,
};

// In emitGatewayResult:
for (const block of resolvedBlocks) {
  const entry = CANVAS_COMPONENTS[block.component];
  if (entry) {
    const result = entry.propsSchema.safeParse(block.props);
    if (!result.success) {
      metrics.blocksValidationFailed++;
      // ...emit error...
      continue;
    }
  }
  metrics.blocksEmitted++;
  // ...emit block...
}

// At end of stream:
logger.info({ deploymentId, metrics }, "Chat session metrics");
```

---

### 4b. Frontend Metrics

**File**: `Jarble-mvp/components/tambo/StreamingBotMessage.tsx`

```typescript
const metrics = {
  totalEvents: 0,
  textChunks: 0,
  blocksReceived: 0,
  blockErrors: 0,
  orphanedBlocks: 0,
  checksumFailures: 0,
};

// Track and log at stream end
```

---

## Phase 5: Advanced Features (Future)

### 5a. Progressive Enhancement
- Start rendering with partial props
- Show "Loading..." state while waiting for PROPS event
- Upgrade UI when full props arrive

### 5b. Component Retry
- If a block fails validation, ask bot to regenerate
- Send: `[RETRY_REQUEST] component=chart reason="data_empty" suggestion="provide at least 1 data point"`

### 5c. Component Preview Mode
- Before rendering, show bot a simple text summary: "Chart: 3 data points, bar type, colors: [blue, red]"
- Bot can say "that looks wrong, let me fix" before we render

---

## Implementation Priority

1. **Phase 1a** (Backend validation) — 1-2 hours — HIGH IMPACT
2. **Phase 2a** (Timeout tracking) — 30 mins — HIGH IMPACT
3. **Phase 3a** (soul.md update) — 30 mins — MEDIUM IMPACT (enables self-correction)
4. **Phase 1b** (Stringify safety) — 30 mins — MEDIUM IMPACT
5. **Phase 1c** (Checksums) — 1 hour — LOW IMPACT (nice-to-have)
6. **Phase 2b** (Error feedback UI) — 1 hour — MEDIUM IMPACT
7. **Phase 4** (Metrics) — 1 hour — LOW IMPACT (observability)

**Total**: ~6 hours for full implementation

---

## Testing Strategy

### Unit Tests
```typescript
// Test Zod validation with various invalid inputs
describe("UI block validation", () => {
  it("rejects empty data arrays", () => { ... });
  it("rejects wrong enum values", () => { ... });
  it("coerces numbers to strings", () => { ... });
});

// Test timeout tracking
describe("Pending block cleanup", () => {
  it("warns after 5s without END event", () => { ... });
  it("clears timeout on END event", () => { ... });
});
```

### Integration Tests
```typescript
// Simulate SSE with malformed blocks
// Verify no console errors, blocks shown with error cards
// Verify timeout cleanup works
```

### Manual Testing
```
1. Have bot intentionally generate:
   - Empty data arrays
   - Wrong enum values
   - Missing required props
   - Truncated JSON (simulate network cut)

2. Verify:
   - Error card appears immediately
   - Error message is clear
   - Bot sees the error message
   - Bot can fix it on next turn
```

---

## Rollout Plan

1. Implement Phase 1a + 2a first (core validation + timeout)
2. Test with real bot conversations
3. Implement Phase 3a (soul.md updates)
4. Test self-correction loop
5. Monitor metrics for improvements
6. Add Phase 1c + 2b as follow-ups

