# Tambo Migration Synthesis: Should Jarble Switch from jarble_ui to Tambo?

**Date**: 2026-03-03
**Status**: Final Recommendation
**Research basis**: 5 parallel research tasks covering core architecture, self-hosting infrastructure, state sync, pain point audit, and marketplace impact.

---

## Executive Summary

**Recommendation: DO NOT migrate to Tambo. Instead, adopt a HYBRID approach — use Tambo's Zod-to-tool-definition pattern for marketplace schema publishing, but keep jarble_ui as the rendering engine.**

The architectures are fundamentally incompatible in ways that would require rewriting the majority of Jarble's UI system (canvas grid, autoFixProps, error recovery, sandbox, marketplace) with no clear benefit. However, Tambo's approach to schema-driven component registration is worth adopting as a design pattern for the marketplace package system.

---

## 1. Architecture Comparison: The Core Tension

### How Each System Works

| | Jarble (jarble_ui) | Tambo |
|---|---|---|
| **LLM integration** | MCP tools → fenced blocks in text | Tool calls → streaming props |
| **Component selection** | LLM calls `render_ui` MCP tool | Tambo agent matches semantically |
| **Data flow** | Text → parser → SSE events → render | Tool call → stream → progressive render |
| **Props delivery** | All-or-nothing (complete JSON) | Incremental (props arrive one by one) |
| **Error repair** | 20 rules in autoFixProps (1,055 lines) | None — LLM must get it right |
| **Layout** | Detachable canvas cards in responsive grid | Inline in message thread |
| **Sandbox** | Double-iframe with CSP, heartbeat, bridge API | Not supported |

### The Fundamental Mismatch

Jarble and Tambo solve the same problem (AI renders UI components) but from **opposite architectural directions**:

1. **Jarble = Detached Canvas Cards**: Components live in a separate grid panel, can be rearranged, split, merged, persisted across messages. The canvas is a first-class workspace, not just message decoration.

2. **Tambo = Inline Message Components**: Components render inside the chat message where they were generated. No drag-to-reorder, no split/merge, no cross-message persistence.

This is not a superficial difference — it's the core UX philosophy. Jarble's canvas grid system (`SimpleCanvasGrid.tsx`, `canvasReducer.ts`, 26 reducer actions) has no Tambo equivalent and would need to be rebuilt from scratch on top of Tambo, defeating the purpose of the migration.

---

## 2. Self-Hosting Infrastructure Assessment

### Tambo Self-Hosted Architecture
- **3 services**: Web (Next.js, port 8260), API (NestJS, port 8261), PostgreSQL 17 (port 5433)
- **K8s ready**: Manifests for StatefulSet (PostgreSQL) + Deployments (API ×2, Web ×2)
- **Storage**: 10Gi PVC for PostgreSQL
- **Cost**: Free forever for self-hosting (Apache 2.0 license)
- **LLM**: OpenAI-centric (`FALLBACK_OPENAI_API_KEY` required). No native OpenRouter/Anthropic/Google support.

### Impact on Jarble's K8s Cluster
Deploying Tambo self-hosted would add:
- 5 new pods (2 API, 2 Web, 1 PostgreSQL) to the existing K3s cluster
- ~10Gi additional storage for PostgreSQL PVC
- A second PostgreSQL instance (Jarble already uses MySQL/SQLite)
- Authentication complexity (Tambo uses NextAuth, Jarble uses Auth0)
- Network policies for inter-service communication

### Critical Limitation: LLM Provider Lock-In
Tambo's backend is built around OpenAI's API format. Jarble supports 5 LLM providers (OpenRouter, Anthropic, OpenAI, Google, Claude Max) via the `providerEnvMap` in `openclaw.ts`. Tambo would either:
- Force all users to OpenAI-compatible providers
- Require significant backend modifications to support Jarble's multi-provider model

This is a **dealbreaker** for Jarble's multi-provider value proposition.

---

## 3. What Jarble Would Gain from Tambo

### Real Benefits
1. **Progressive prop streaming** — UI builds in real-time instead of appearing all-at-once after full JSON parse (~280 lines of SSE pipeline could be replaced)
2. **Automatic Zod-to-tool-definition** — No manual MCP tool description maintenance
3. **Built-in reconnection** — Framework handles SSE disconnects

### Overstated Benefits
1. **"Less code"** — While Tambo replaces ~280 lines of chat SSE handling, it CANNOT replace:
   - Canvas reducer (26 actions, ~400 lines)
   - autoFixProps (20 rules, 1,055 lines)
   - SimpleCanvasGrid (keyboard nav, drag-to-reorder, split/merge)
   - Sandbox system (heartbeat, bridge API, double-iframe)
   - Error recovery (fix button, rate limiting)
   - Marketplace component resolution
   Total irreplaceable: ~2,200+ lines

2. **"Better developer experience"** — Tambo components must handle `undefined` for ALL props during streaming. This is a significant development burden for 37 components, especially complex ones like `chart`, `data_table`, and `form`.

---

## 4. What Jarble Would Lose

### Critical Losses (No Tambo Equivalent)

| Feature | Lines | Impact |
|---------|-------|--------|
| **autoFixProps** | 1,055 | 20 repair rules + 30 aliases. Jarble's secret sauce. Handles LLM output variability that Tambo does not. |
| **Canvas grid** | ~400 | Detachable cards, drag-to-reorder, split/merge, keyboard nav. Core UX differentiator. |
| **Error cards + Fix button** | ~200 | User-driven error recovery. Tambo has no equivalent. |
| **Fix rate limiting** | ~50 | Prevents error loops. Built into canvasReducer. |
| **Sandbox system** | ~500 | Heartbeat watchdog, bridge API (storage, events, resize), CSP, double-iframe for marketplace. |
| **MCP UI tools** | ~300 | render_ui, define_component, list_components, component_reference. Would need complete redesign. |
| **Server-side validation** | ~140 | Library URL sanitization, block size limits. Security layer. |
| **fenced block types** | ~100 | jarble_ui_update, jarble_ui_define — Tambo has no equivalent to in-place updates or custom definitions. |

**Total at risk: ~2,745 lines of battle-tested, production code.**

### Partial Losses
- **Marketplace sandbox tier** — Tambo has no sandbox/iframe concept. Template tier maps well, but the entire code/sandbox marketplace (double-iframe isolation, CSP, bridge API) would be abandoned.
- **Multi-LLM provider support** — Tambo is OpenAI-centric.

---

## 5. Marketplace Package Impact

### What Maps Well
- **Template components** → Tambo's `TamboComponent` registration is simpler than Jarble's 3-layer manifest. Marketplace template components could export Zod schemas that directly become tool definitions.
- **Schema publishing** → Tambo's Zod-to-JSON-Schema conversion is a good pattern. When a marketplace package is published, its Zod schema could be automatically converted to a tool definition for the LLM.

### What Doesn't Map
- **Sandbox components** — Tambo has no sandbox isolation. Marketplace code-tier components run arbitrary HTML/CSS/JS in double-iframe sandboxes. This entire security model would be lost.
- **Package instructions** — Tambo has no equivalent to soul.md instruction snippets. Package bot instructions would need a different delivery mechanism.
- **Skills** — Tambo's MCP integration is external (HTTP/SSE servers), not internal (stdio in pod). Package skills would need architectural changes.

### The Better Path for Marketplace Schemas
Instead of migrating to Tambo, **adopt Tambo's Zod-to-JSON-Schema pattern**:

```typescript
// Already exists in shared/component-manifest/
export const chartSchema = z.object({
  data: z.array(z.object({ name: z.string(), value: z.number() })),
  type: z.enum(["line", "bar", "pie", "area"]),
});

// NEW: Generate JSON Schema for marketplace publishing
import { zodToJsonSchema } from "zod-to-json-schema";
const chartJsonSchema = zodToJsonSchema(chartSchema);
// → Store in marketplace listing for discoverability
// → Use in MCP tool definitions automatically
```

This gives Jarble the **same schema-driven marketplace** without the migration cost.

---

## 6. Migration Cost Analysis

### If We Migrated (NOT recommended)

| Task | Effort | Risk |
|------|--------|------|
| Replace SSE pipeline with Tambo streaming | 3-5 days | Medium |
| Rebuild canvas grid on top of Tambo | 5-8 days | High — no Tambo concept for this |
| Port autoFixProps to Tambo middleware | 3-5 days | High — Tambo has no middleware hook |
| Update all 37 components for undefined props | 5-7 days | Medium — tedious but straightforward |
| Replace MCP render_ui with Tambo registration | 3-5 days | High — changes bot interaction model |
| Rebuild sandbox system | 5-8 days | Very High — Tambo has nothing like this |
| Rebuild error recovery | 2-3 days | Medium |
| Deploy + maintain Tambo infra in K8s | 2-3 days | Medium — 5 new pods, new auth |
| Rebuild marketplace for Tambo model | 5-8 days | High |
| Fix multi-LLM provider support | 3-5 days | High — Tambo core modification |
| **Total** | **36-57 days** | **Very High** |

### If We Adopt Hybrid (RECOMMENDED)

| Task | Effort | Risk |
|------|--------|------|
| Add `zod-to-json-schema` to shared manifest | 0.5 days | Low |
| Auto-generate JSON Schema for marketplace listings | 1 day | Low |
| Enhance MCP tool definitions with auto-generated schemas | 1 day | Low |
| Add progressive rendering to jarble_ui (optional) | 3-5 days | Medium |
| **Total** | **2.5-7.5 days** | **Low** |

---

## 7. The Hybrid Approach (Recommended)

### What to Adopt from Tambo

1. **Zod-to-JSON-Schema for marketplace** — When creators publish components/packages, auto-generate JSON Schema from their Zod props schema. Store in marketplace listing. Use for:
   - MCP `component_reference` tool (auto-generated, not manual)
   - Marketplace search/filtering by prop types
   - IDE-like autocomplete in the bot's component selection

2. **Schema-first registration pattern** — Tambo's single `TamboComponent` type is simpler than Jarble's 3-layer system. Consider consolidating the manifest → registry → MCP pipeline into a single source that auto-derives everything.

3. **Progressive rendering (optional, Phase 2)** — Add partial prop delivery to jarble_ui. Instead of all-or-nothing, stream props incrementally. This can be done WITHOUT Tambo by modifying `uiBlockParser.ts` to emit partial props as they're parsed. Components would get a `streaming?: boolean` prop.

### What to Keep (jarble_ui)

- **Canvas grid** — Jarble's detachable, rearrangeable cards are a core differentiator
- **autoFixProps** — 20 repair rules are irreplaceable; no other framework has this
- **Error recovery** — Fix button + rate limiting is battle-tested
- **Sandbox system** — Heartbeat, bridge API, double-iframe isolation
- **MCP integration** — render_ui as the primary UI rendering mechanism
- **Multi-LLM support** — OpenRouter, Anthropic, OpenAI, Google, Claude Max
- **fenced block types** — jarble_ui, jarble_ui_update, jarble_ui_define

### Implementation Roadmap

**Phase 1 (1 week)**: Schema Publishing
- Add `zod-to-json-schema` dependency
- Auto-generate JSON Schema from component manifest
- Store JSON Schema in marketplace component listings
- Update MCP `component_reference` to use auto-generated schemas

**Phase 2 (2-3 weeks, optional)**: Progressive Rendering
- Modify `uiBlockParser.ts` to emit partial props during streaming
- Add `streaming` prop to components that benefit from progressive rendering
- Prioritize: `data_table` (rows appear one by one), `list` (items appear), `stat_grid` (stats fill in)

**Phase 3 (1 week)**: Schema Validation for Packages
- Package publishing requires valid Zod schema
- Package install auto-registers component schemas with bot
- Bot MCP tools auto-updated with package component schemas

---

## 8. Decision Matrix

| Criterion | Jarble (Keep) | Tambo (Migrate) | Hybrid (Adopt Patterns) |
|-----------|:---:|:---:|:---:|
| Migration effort | 0 days | 36-57 days | 2.5-7.5 days |
| Risk | None | Very High | Low |
| Canvas grid support | Full | None (rebuild) | Full |
| autoFixProps | Full (1,055 lines) | Lost (rebuild?) | Full |
| Sandbox isolation | Full | Lost | Full |
| Multi-LLM providers | Full (5 providers) | Lost (OpenAI only) | Full |
| Progressive streaming | No | Yes | Optional (Phase 2) |
| Schema-driven marketplace | No | Partial | Yes |
| Error recovery | Full | Lost | Full |
| Infrastructure cost | 0 new pods | 5 new pods | 0 new pods |
| Marketplace template tier | Works | Maps well | Works + schemas |
| Marketplace sandbox tier | Works | Broken | Works |

---

## 9. Final Verdict

**Don't migrate to Tambo.** The architectures are fundamentally incompatible:

1. **Inline vs Detached**: Tambo renders inside messages; Jarble renders in a separate canvas workspace. This is Jarble's core UX and cannot be replicated on top of Tambo.

2. **No autoFixProps**: Tambo has zero tolerance for LLM prop errors. Jarble's 20-rule repair system handles real-world LLM output variability that Tambo simply does not address.

3. **No sandbox**: Tambo has no iframe isolation, heartbeat, bridge API, or CSP system. The entire marketplace code tier would be abandoned.

4. **OpenAI lock-in**: Tambo requires OpenAI-compatible providers. Jarble supports 5 providers via OpenRouter + direct integrations.

5. **Infrastructure bloat**: 5 new K8s pods, a second database, a second auth system — for less functionality than what already exists.

**Instead, adopt the hybrid approach**: Take Tambo's best idea (Zod-to-JSON-Schema for automatic tool definitions) and integrate it into the existing jarble_ui system. This gives marketplace packages schema-driven discoverability at <5% of the migration cost, with zero risk to the existing production system.

---

## Sources

- [Tambo GitHub Repository](https://github.com/tambo-ai/tambo)
- [Tambo Docs: Self-Hosting](https://docs.tambo.co/guides/self-hosting)
- [Tambo Docs: Kubernetes Deployment](https://docs.tambo.co/guides/self-hosting/kubernetes)
- [Tambo Docs: Environment Variables](https://docs.tambo.co/guides/self-hosting/environment-variables)
- [Tambo Docs: Register Components](https://docs.tambo.co/guides/enable-generative-ui/register-components)
- [Tambo 1.0 Hacker News Discussion](https://news.ycombinator.com/item?id=46966182)
- [tambo-cloud GitHub (deprecated)](https://github.com/tambo-ai/tambo-cloud)
- Jarble codebase: `uiBlockParser.ts`, `autoFixProps.ts`, `CanvasRenderer.tsx`, `SimpleCanvasGrid.tsx`, `canvasReducer.ts`, `openclaw.ts`, `configSync.ts`
