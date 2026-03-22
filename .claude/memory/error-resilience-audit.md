# Error Resilience & Graceful Degradation Audit — Task #10

**Date**: Feb 27, 2026
**Status**: COMPLETE

## Executive Summary

Jarble has **excellent component-level error boundaries** but **weak cross-layer error handling**. Critical gaps:
1. **Streaming JSON parsing** — partial/malformed jarble_ui blocks silently leave blocks invisible
2. **SSE corruption** — mid-transmission cutoff → unfinished blocks (no error signal)
3. **Data type mismatches** — LLM sends wrong data format → Zod rejects silently
4. **No self-correction flow** — bot cannot see what it broke, can't fix it
5. **Backend validation** — limited upstream validation before SSE transmission

---

## Layer-by-Layer Analysis

### Stage 1: LLM Generates jarble_ui Block

**Current Handling**: ✅ Good prompt guidance in soul.md (documented in memory)

**What Can Go Wrong**:
- Unclosed JSON brackets: `{"component":"card","props":{"title":"test`
- Mixed object/array confusion: `"rows": ["a","b"]` vs `"rows": [["a","b"]]`
- Invalid enum values: `"status": "maybe"` (only `info/success/warning/error` allowed)
- Missing required props (handled gracefully by Zod)
- NaN/Infinity in numeric fields
- Circular references (can't happen in text, but LLM might try)

**Risk**: HIGH for malformed JSON; MEDIUM for type errors (Zod catches these)

---

### Stage 2: uiBlockParser Extracts Blocks (Backend)

**File**: `jarble-api-main/src/utils/uiBlockParser.ts`

**Current Handling**:
```typescript
// Lines 81-111: JSON.parse + structure validation
try {
  const parsed = JSON.parse(trimmed);
  // Validates: is object, has component (string), has props (object)
  if (typeof parsed !== "object" || parsed === null) return match; // INVALID → left in text
  if (typeof parsed.component !== "string") return match;
  if (typeof parsed.props !== "object" || parsed.props === null) return match;
  uiBlocks.push({...});
  return ""; // VALID → strip from text
} catch {
  logger.warn("[uiBlockParser] Failed to parse..."); // SILENT LOG
  return match; // INVALID → left in text
}
```

**What Can Go Wrong**:
- ✅ Incomplete JSON → `catch` block handles gracefully (left visible in text)
- ✅ Structural validation → Validates presence of `component`, `props`
- ❌ **Partial streaming JSON** — If SSE transmission cuts off mid-props, the block is malformed but still captures partial data
- ❌ **No size limits enforced on individual properties** — A `data` array with 10k rows could create massive memory pressure

**Risk**: MEDIUM. Structural validation is good, but partial JSON from streaming isn't detected.

---

### Stage 3: componentResolver Validates Custom Components (Backend)

**File**: `jarble-api-main/src/utils/componentResolver.ts` + `tamboAgent.ts:resolveUIBlocks()`

**Current Handling**:
```typescript
// componentResolver.ts:183-191
export function resolveCustomComponent(definition: ComponentDefinition, props: Record<string, unknown>): ResolvedBlock[] {
  return definition.layout.map((child) => ({
    component: child.component,
    props: substituteValue(child.props, props, 0),
  }));
}

// tamboAgent.ts:82-116
async function resolveUIBlocks(blocks: JarbleUIBlock[], deploymentId: string): Promise<JarbleUIBlock[]> {
  for (const block of blocks) {
    if (isBuiltinComponent(block.component)) {
      resolved.push(block);
      continue;
    }
    try {
      const definition = await readComponentFromPvc(deploymentId, block.component);
      if (!definition) {
        resolved.push(block); // PASS THROUGH — let frontend show unknown
        continue;
      }
      const children = resolveCustomComponent(definition, block.props);
      resolved.push({
        id: block.id,
        component: "layout",
        props: { title: definition.description, children },
      });
    } catch {
      resolved.push(block); // PASS THROUGH on error
    }
  }
  return resolved;
}
```

**What Can Go Wrong**:
- ✅ Unknown built-in component → Frontend shows "Unknown component" fallback
- ✅ Custom component file not found → Pass through, frontend shows unknown
- ✅ Custom component file corrupt JSON → `catch` block, pass through
- ❌ **No validation of resolved blocks** — After substituteValue(), props might be invalid but aren't re-validated against registry schemas
- ❌ **Layout child validation missing** — A custom component could expand to 50 children with no depth check

**Risk**: MEDIUM. Custom resolution is lenient, but no downstream Zod validation.

---

### Stage 4: SSE Transmission (Backend → Frontend)

**File**: `jarble-api-main/src/routes/tamboAgent.ts:285-334`

**Current Handling**:
```typescript
const emitGatewayResult = async (gatewayResult: GatewayResponse) => {
  // ... text content ...
  for (const block of resolvedBlocks) {
    sendEvent(res, {
      type: "UI_BLOCK_START",
      blockId: block.id,
      component: block.component,
      // ... metadata ...
    });
    sendEvent(res, { type: "UI_BLOCK_PROPS", blockId: block.id, props: block.props });
    sendEvent(res, { type: "UI_BLOCK_END", blockId: block.id });
  }
};

function sendEvent(res: any, event: Record<string, unknown>) {
  if (!res.writableEnded) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}
```

**What Can Go Wrong**:
- ❌ **No error wrapping** — If `JSON.stringify(event)` throws (circular ref, BigInt), silent fail
- ❌ **Props not re-validated** — Props object emitted as-is, no final Zod check
- ❌ **Uncaught stringify errors** — If a prop contains non-JSON-serializable value, `stringify()` may throw
- ❌ **No checksum/integrity** — Frontend can't detect if event was truncated mid-transmission
- ❌ **Client disconnect not handled** — `res.writableEnded` check, but partial writes aren't retried

**Risk**: MEDIUM. Stringify failures would crash the stream.

---

### Stage 5: Frontend SSE Parse (React)

**File**: `Jarble-mvp/components/tambo/StreamingBotMessage.tsx:43-155`

**Current Handling**:
```typescript
// Lines 80-147
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data: ")) continue;

  try {
    const event = JSON.parse(trimmed.slice(6));
    if (event.type === "UI_BLOCK_START") {
      pendingBlocks.set(event.blockId, {
        id: event.blockId,
        component: event.component,
        props: {},
        ...
      });
    } else if (event.type === "UI_BLOCK_PROPS") {
      const block = pendingBlocks.get(event.blockId);
      if (block) {
        block.props = event.props;
      } else {
        console.warn("[Jarble:SSE] UI_BLOCK_PROPS for unknown blockId:", event.blockId);
      }
    } else if (event.type === "UI_BLOCK_END") {
      const block = pendingBlocks.get(event.blockId);
      if (block) {
        onBlock({ ...block }); // COMMIT to state
        pendingBlocks.delete(event.blockId);
      } else {
        console.warn("[Jarble:SSE] UI_BLOCK_END for unknown blockId:", event.blockId);
      }
    }
  } catch (e) {
    console.warn("[Jarble:SSE] Malformed JSON line:", trimmed.slice(0, 100), "error:", e);
  }
}
```

**What Can Go Wrong**:
- ✅ JSON parse error → Caught, logged, silently skipped
- ❌ **Missing UI_BLOCK_PROPS** — Block START but no PROPS event → empty props object committed
- ❌ **Orphaned props** — PROPS without preceding START → logged but data lost
- ❌ **Orphaned END** — END without START → logged but no render triggered
- ❌ **Partial transmission** — Stream cuts off mid-PROPS JSON → parse fails, block lost silently
- ❌ **No timeout for pending blocks** — If END never arrives, block stays in `pendingBlocks` map forever

**Risk**: HIGH. Missing events or truncation can leave blocks invisible without user feedback.

---

### Stage 6: CanvasRenderer Validates & Renders (React)

**File**: `Jarble-mvp/components/canvas/CanvasRenderer.tsx`

**Current Handling**:
```typescript
// Lines 150-167: Built-in registry lookup + Zod validation
const entry = CANVAS_COMPONENTS[block.component];
if (entry) {
  const result = entry.propsSchema.safeParse(block.props);
  if (!result.success) {
    const errorMsg = result.error.issues.map((i) => i.message).join(", ");
    isDev && console.warn("[Jarble:Render] Zod validation FAILED...");
    return (
      <ComponentErrorCard
        componentName={block.component}
        error={`Invalid props: ${errorMsg}`}
        blockId={block.id}
        onAction={onAction}
      />
    );
  }
  // ... render with error boundary ...
}

// Lines 202-213: Custom component fallback
const customDef = getCustomComponent(block.component);
if (customDef) {
  return (
    <CanvasErrorBoundary componentName={block.component} blockId={block.id} onAction={onAction}>
      <CustomComponentRenderer definition={customDef} props={block.props} />
    </CanvasErrorBoundary>
  );
}

// Lines 215-221: Unknown component fallback
isDev && console.warn(`[Jarble:Render] Unknown component: ${block.component}...`);
return (
  <div className="rounded-xl border border-yellow-500/30 bg-yellow-500/10 p-3 text-xs text-yellow-300">
    Unknown component: <code>{block.component}</code>
  </div>
);
```

**What Can Go Wrong**:
- ✅ Invalid props → Zod catches, shows ComponentErrorCard
- ✅ Unknown component → Yellow fallback card shown
- ❌ **Zod coercion issues** — Schemas use `.optional()` and `.union()` heavily, so invalid data might pass
- ❌ **Component throw at render time** — CanvasErrorBoundary catches, but error message may be cryptic
- ❌ **Custom component throws** → ErrorBoundary catches, but CustomComponentRenderer might not validate props

**Risk**: LOW. Error boundaries work well here.

---

### Stage 7: Individual Components Render (React)

**Current Handling**: Components vary widely.

**Examples**:

#### CanvasDataTable (Lines 50-150)
```typescript
// Defensive programming
function normalizeRow(row: unknown, columns: string[]): string[] {
  if (Array.isArray(row)) return row.map(String);
  if (row && typeof row === "object") {
    // ... smart extraction ...
    return Object.values(obj).map(String);
  }
  return [String(row)]; // FALLBACK
}

// Graceful degradation
const resolvedColumns = columns.length > 0 ? columns : rows.length > 0 && rows[0] && typeof rows[0] === "object" ? Object.keys(rows[0] as Record<string, unknown>) : [];
```

**Risk**: LOW. Defensive.

#### CanvasChart (Lines 41-100)
```typescript
if (!data || data.length === 0 || !dataKeys || dataKeys.length === 0) {
  return (
    <div className="p-3 h-full flex items-center justify-center text-sm text-muted-foreground">
      No chart data provided
    </div>
  );
}
```

**Risk**: LOW. Defensive.

#### CanvasSandbox (Lines 83-120)
```typescript
// Sanitizes HTML, extracts scripts, validates library URLs
function sanitizeHtmlProp(...) { ... }
function buildDocument(...) {
  const safeLibs = (libraries || []).filter((url) => /^https?:\/\//.test(url));
  // ...
  const csp = "default-src * 'unsafe-inline' 'unsafe-eval' data: blob:; frame-src *";
}
```

**Risk**: MEDIUM. CSP is permissive; XSS possible if JS is malicious (but not from user, only from bot).

---

## Identified Gaps

### Gap 1: No Round-Trip Validation
- Backend emits UI blocks with NO Zod validation
- Frontend receives props that MIGHT be invalid
- Component might silently render with partial/wrong data

### Gap 2: Streaming Corruption Detection
- No checksum/content-length in SSE events
- If transmission cuts off, frontend sees truncated JSON
- Block is silently dropped (logged only in dev)

### Gap 3: Bot Cannot See What It Broke
- No "preview mode" where bot sees screenshot of rendered UI
- No feedback loop: "Your chart failed because data was empty"
- Bot retries blindly with similar mistakes

### Gap 4: Incomplete UI Block Tracking
- `pendingBlocks` map in SSE consumer never clears if END is missing
- Memory leak if bot sends START but not END repeatedly

### Gap 5: Custom Component Validation
- Resolved blocks (custom → layout) not re-validated against registry
- A custom component could expand to 100+ children with no check

### Gap 6: Props Coercion Too Permissive
- Zod schemas use `.optional()` on many fields
- Invalid data might pass validation but render poorly

### Gap 7: No Explicit Error Signals
- Malformed JSON in uiBlockParser → logged, left in visible text
- Better: Emit JSON_PARSE_ERROR SSE event so frontend can show explicit error

---

## Recommended Fixes (Priority Order)

### Priority 1: Add SSE Checksums (Quick Win)
```typescript
// Backend: include content-hash in each block event
sendEvent(res, {
  type: "UI_BLOCK_PROPS",
  blockId: block.id,
  props: block.props,
  contentHash: crypto.createHash('sha256').update(JSON.stringify(block.props)).digest('hex').slice(0, 8),
});

// Frontend: validate on receipt, error if mismatch
```

### Priority 2: Backend Zod Validation Before Emission
```typescript
// tamboAgent.ts: before sendEvent
const validated = entry.propsSchema.safeParse(block.props);
if (!validated.success) {
  sendEvent(res, {
    type: "UI_BLOCK_ERROR",
    blockId: block.id,
    component: block.component,
    errors: validated.error.flatten(),
  });
  continue; // Don't emit invalid block
}
```

### Priority 3: Timeout Pending Blocks
```typescript
// Frontend: track when START was received, warn if END missing after 5s
const pendingBlockTimeout = new Map<string, NodeJS.Timeout>();

if (event.type === "UI_BLOCK_START") {
  pendingBlockTimeout.set(event.blockId, setTimeout(() => {
    console.warn("[Jarble:SSE] Block timeout:", event.blockId);
    // Could auto-remove or emit warning
  }, 5000));
}

if (event.type === "UI_BLOCK_END") {
  clearTimeout(pendingBlockTimeout.get(event.blockId));
}
```

### Priority 4: Error Event Stream
```typescript
// Add new SSE event type for clarity
// UI_BLOCK_ERROR: JSON parse failed
// COMPONENT_VALIDATION_ERROR: Zod validation failed
// CUSTOM_COMPONENT_ERROR: File read or resolution failed
// RENDER_ERROR: Component threw at runtime

// Frontend can show these with retry button
```

### Priority 5: Self-Correction Loop
```typescript
// If bot emits broken UI, emit special event back:
// {
//   type: "COMPONENT_RENDER_FAILED",
//   blockId: "...",
//   component: "chart",
//   error: "Invalid props: data is empty",
// }

// Bot can then see this in next turn and say:
// "I tried to create a chart but it failed because the data was empty. Let me fix that..."
```

### Priority 6: Custom Component Expansion Limits
```typescript
// componentResolver.ts
export function resolveCustomComponent(definition: ComponentDefinition, props: Record<string, unknown>): ResolvedBlock[] {
  const MAX_EXPANDED = 50;
  const expanded = definition.layout.map((child) => ({...}));

  if (expanded.length > MAX_EXPANDED) {
    throw new Error(`Custom component ${definition.name} expanded to ${expanded.length} children, max ${MAX_EXPANDED}`);
  }

  return expanded;
}
```

---

## Bot Self-Correction Strategy

### Concept: "Preview Mode"
1. Bot renders a component
2. Frontend captures error: "Chart failed: data array is empty"
3. SSE emits: `{type: "RENDER_ERROR", blockId, component, error}`
4. Bot's system prompt says: "When you see a RENDER_ERROR in the SSE, acknowledge it and fix your output"
5. Bot: "I see — let me provide actual chart data..."

### Implementation:
- Add RENDER_ERROR to SSE event types
- Frontend emits event immediately on CanvasErrorCard mount
- Pass error info back to bot in next chat message as system context
- Bot's soul.md includes: "If a component fails, you'll see a RENDER_ERROR message. Fix it by regenerating with correct data."

---

## Validation Tightening

### Current: Permissive Zod Schemas
```typescript
export const cardSchema = z.object({
  title: z.string().optional(),
  subtitle: z.string().optional(),
  body: z.string().optional(),
  content: z.string().optional(),
  // ...
});
```

### Better: Stricter with Better Errors
```typescript
export const cardSchema = z.object({
  title: z.string().max(200, "Title must be ≤200 chars").optional(),
  subtitle: z.string().max(500).optional(),
  body: z.string().max(5000).optional(),
  // Reject unknown props
}).strict();
```

### But: Don't Over-Validate
- Keep `.optional()` for LLM flexibility
- Accept `null` and `undefined` gracefully
- Coerce numbers to strings where sensible
- Support alias fields (e.g., `label` or `title` in timeline)

---

## LLM Prompt Improvements

Add to soul.md:
```markdown
## Error Recovery

If a component fails to render, you will see a RENDER_ERROR message like:
  [RENDER_ERROR] card: "Invalid props: body is required but got null"

When this happens:
1. Read the error carefully
2. Regenerate the component with corrected data
3. Avoid using the same structure twice — vary your approach

Example:
  User: "Show me sales data"
  You: [generate broken chart]
  Error: "Chart failed: data array is empty"
  You: "I see — let me provide the sales data properly:
  ```jarble_ui
  {"component":"chart","type":"bar","data":[{"month":"Jan","sales":100},...]}
  ```
```

---

## Metrics to Track

Add logging:
- **Block drop rate**: How many blocks were extracted but never rendered?
- **Validation failure rate**: How many blocks fail Zod validation?
- **Timeout rate**: How many blocks have START but not END after 5s?
- **Re-render rate**: How often does a user see a component replaced with error card?

---

## Files Requiring Changes

1. **jarble-api-main/src/routes/tamboAgent.ts** — Add Zod validation before `sendEvent()`
2. **Jarble-mvp/components/tambo/StreamingBotMessage.tsx** — Track pending block timeouts
3. **Jarble-mvp/components/canvas/CanvasRenderer.tsx** — Better error messages
4. **jarble-api-main/src/utils/uiBlockParser.ts** — Add error event emission
5. **Zod schemas in registry.ts** — Tighten validation, add `.strict()` mode
6. **soul.md in OpenClaw prompt** — Document error recovery flow

---

## Conclusion

**Current State**: 7/10 (Good component boundaries, weak cross-layer flow)

**After Fixes**: 9/10 (Comprehensive validation + self-correction)

The system is **resilient to individual component failures** but **vulnerable to streaming corruption and silent data loss**. Priority is:
1. Add validation at backend before SSE
2. Add checksum detection at frontend
3. Implement error feedback loop for bot self-correction
