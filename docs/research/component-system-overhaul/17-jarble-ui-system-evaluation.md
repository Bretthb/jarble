# Jarble UI System Evaluation — Build vs Buy Analysis

**Date**: 2026-02-28
**Scope**: 4-agent parallel research into whether the `jarble_ui` fenced-block system is the best approach
**Agents**: Competitor Research, Alternative Architectures, System Audit, Open-Source Libraries

---

## Executive Summary

All 4 research tracks converge: **Jarble's approach is solid and ahead of the curve. Improve it, don't replace it.** No existing framework replicates the canvas grid with draggable, splittable, mergeable cards. The Zod pre-validation is unique among all platforms studied. The main investments should be in extensibility (single manifest for marketplace) and security (sandbox CSP), not replacing the architecture.

---

## What Jarble Does Better Than Everyone

| Capability | Jarble | Competitors |
|---|---|---|
| **Pre-render validation** | Zod schemas catch bad props before React renders | No one else does this — they all fail at runtime |
| **Error self-healing** | "Fix Component" sends structured `[COMPONENT_ERROR]` back to bot for in-place fix | ChatGPT has a "fix" button but it's unreliable |
| **LLM-aware aliases** | `url`→`src`, `items`→`events`, `canvas`→`sandbox` via Zod `.transform()` | No competitor accommodates LLM output variance |
| **Canvas grid** | Draggable, splittable, mergeable cards in a responsive dashboard layout | Every competitor renders inline in chat — no canvas |
| **Custom component definitions** | `jarble_ui_define` creates reusable templates at runtime with `{{variable}}` placeholders | Only v0/Artifacts can generate new components (via code gen, not templates) |
| **Update mechanism** | `jarble_ui_update` patches existing cards in-place with merge support | Claude Artifacts has create/update/rewrite; others lack this entirely |

---

## System Audit Scorecard

| Dimension | Grade | Summary |
|-----------|-------|---------|
| **Reliability** | B+ | Solid parsing with good fail-safes. Nested backticks are the main risk. |
| **Type Safety** | A- | Excellent Zod schemas with LLM-aware aliases. Triple-copy component list is a maintenance hazard. |
| **Streaming** | B | Reliable but not truly progressive. Blocks appear in a burst after text finishes. |
| **Error Handling** | A- | Strong multi-layer defense. Error boundary + Sentry + bot self-healing is a standout pattern. |
| **Token Efficiency** | B | ~5K tokens per message. Inline component reference could be cut or compressed. |
| **Extensibility** | C+ | 5-8 files to add a component. No single source of truth. Will not scale for marketplace. |
| **Bot Compliance** | B+ | Alias/transform system is excellent. Some prompt inconsistencies (e.g., `header` text/title mismatch — fixed). |
| **Update Mechanism** | B- | Works but lacks feedback. Bot operates on stale canvas state with no success confirmation. |

---

## Competitor Comparison

### How Major Platforms Render Rich UI

| Platform | Architecture | AI Output Format | Validation | Error Handling |
|---|---|---|---|---|
| **Jarble** | Direct React render (same origin) | Fenced JSON blocks in text | Zod schemas (pre-render) | Error card + "Fix"/"Remove" buttons |
| **ChatGPT Canvas/Apps** | Triple-iframe sandbox | MCP tool calls + code gen | CSP enforcement | "Fix this bug" (unreliable) |
| **Claude Artifacts** | Iframe + React Runner | Content-typed React code | None (runtime failures) | Loading/error states |
| **v0.dev** | Vercel Sandbox VM | Generated React/shadcn files | AutoFix post-processor | Mid-stream self-healing |
| **Google A2UI** | Declarative JSON protocol | JSONL messages (flat adjacency list) | Catalog-based type checking | Client error messages to agent |
| **Perplexity** | ECharts + sandboxed code exec | Structured JSON + code | JSON schema | Code interpreter output |
| **CopilotKit** | React SDK with AG-UI protocol | `useCopilotAction` renders | Action parameter types | Per-action error isolation |

### Key Insights from Competitors

1. **Google's A2UI protocol** — Flat adjacency-list model designed specifically for LLM generation. Cross-platform (Web, Flutter). Catalog-based (like Jarble's registry). Worth watching for marketplace/multi-platform.
2. **v0's AutoFix** — Post-processing that validates and repairs LLM output mid-stream. Could complement Zod validation: auto-repair common prop issues instead of showing error cards.
3. **ChatGPT's per-app CSP** — Jarble's sandbox has `default-src *` (wide open). Claude Artifacts whitelists only `cdnjs.cloudflare.com`. Critical security gap.
4. **A2UI's `beginRendering` gate** — Prevents partially-complete multi-component layouts from flashing. Jarble renders blocks as they arrive with no gate.

---

## Alternative Architectures Evaluated

| Approach | Complexity | Streaming | Type Safety | Fit for Jarble | Verdict |
|----------|-----------|-----------|-------------|----------------|---------|
| **Tool-call rendering** | Medium | Good | Excellent | Medium | Worth considering long-term; blocked by OpenClaw architecture |
| **MCP Apps / iframes** | High | Limited | Weak | Low | Only for third-party integrations, not built-in components |
| **RSC streaming** | Very High | Excellent | Good | Very Low | **Paused by Vercel**, architecturally incompatible with pods |
| **Vercel AI SDK UI** | Medium-High | Good | Excellent | Medium | Good patterns to steal; full adoption requires backend rewrite |
| **WebComponents** | High | Good (A2UI) | Weak | Low | Wrong paradigm for a React-first team |
| **Markdown-plus (llm-ui)** | Low-Medium | Excellent | Varies | **High** | Best near-term improvement — replaces fragile regex parsing |
| **CopilotKit** | High | Excellent | Good | Low | Too much overlap with existing infrastructure |

### Most Promising: `llm-ui` Library

The `llm-ui` React library is purpose-built for rendering LLM output with custom blocks. It would replace the fragile regex parsing in `uiBlockParser.ts` with battle-tested block detection that handles:
- Partial JSON during streaming
- Broken markdown edge cases
- Smooth character-level rendering
- Zero backend changes needed

---

## Open-Source Libraries Assessment

| Library | Stars | Can Handle 40+ Components? | Canvas Grid? | Migration Cost | Recommendation |
|---------|-------|---------------------------|-------------|---------------|----------------|
| **assistant-ui** | ~5k+ | Yes (via ToolUI) | No (inline only) | Low | **Already adopted** — deepen ToolUI usage for inline chat tools |
| **Vercel AI SDK** | 22.1k | Yes (tool parts) | No | High | Steal patterns; don't fully adopt |
| **CopilotKit** | 28k | Yes (actions) | No | Very High | Skip — too opinionated, overlaps with existing stack |
| **LangGraph** | High | Yes (GenUI) | No | Very High | Skip — tightly coupled to LangSmith |
| **Mastra** | 19.8k | N/A (backend only) | N/A | Medium-High | Skip — doesn't solve UI rendering |
| **Chainlit** | 12k | Limited | No | Not viable | Skip — Python-based, declining |

**Verdict: Hybrid approach (Build + Buy)**
- **Buy**: assistant-ui for chat layer (already done), consider tool-ui component library
- **Build**: Canvas grid, component registry, fenced-block system — these are the differentiator

---

## Emerging Standards to Watch

### A2UI (Google) — v0.9, December 2025
- Flat JSON protocol for agent→UI rendering
- Catalog-based component model (like Jarble's registry)
- Cross-platform: same JSON renders on Web, Flutter, mobile
- Flat adjacency-list model is easier for LLMs than nested JSON
- **Relevance**: Could be the wire format for marketplace components

### AG-UI (CopilotKit) — Adopted by Google, LangChain, AWS, Microsoft
- 16 SSE event types for agent→frontend communication
- Maps closely to Jarble's existing SSE events
- **Relevance**: Could standardize Jarble's protocol for interop

### MCP Apps (Anthropic) — Launched January 2026
- Iframe-sandboxed tools with interactive UI
- Double-iframe isolation for security
- **Relevance**: Only for third-party integrations, not built-in components

---

## Marketplace Readiness Assessment

For users to sell/share custom components, the system needs:

### Already Have
- `jarble_ui_define` — runtime component templates with `{{variable}}` placeholders (proto-marketplace)
- Zod validation — marketplace submissions would include schemas
- Component catalog provider — already loads custom components from PVC
- Canvas grid — components render identically regardless of source

### Need to Build
1. **Single component manifest** — One JSON file defines a component (schema, description, default props, recommended layout_hint, author, version, tags, pricing). All systems derive from this manifest.
2. **Stronger sandbox isolation** — User-created components should render in sandboxed iframes (like `CanvasSandbox`), not directly in the React tree. ChatGPT's double-iframe approach is the gold standard.
3. **Component metadata** — Extend `jarble_ui_define` with author, version, tags, description, pricing, usage stats.
4. **Discovery/distribution** — API endpoints for browsing, searching, installing components.

---

## Recommended Roadmap

| Phase | Action | Effort | Impact |
|---|---|---|---|
| **Now** | Fix `header` text/title bug in soul.md prompt | Done ✅ | Bot compliance |
| **Now** | Add `[COMPONENT_ERROR]` to `isActionMessage` + error recovery in soul.md | Done ✅ | Fix Component UX |
| **Soon** | Create single component manifest (unblock marketplace) | 2-3 days | Extensibility |
| **Soon** | Tighten sandbox CSP (`default-src 'self'` + CDN whitelist) | 1 day | Security |
| **Medium** | Adopt `llm-ui` for streaming block rendering on frontend | 2-3 days | Streaming UX |
| **Medium** | Trim soul.md inline reference to top 10 components | 1 day | Token savings (~1,500/msg) |
| **Medium** | Add AutoFix-style prop repair before Zod validation | 2 days | Fewer error cards |
| **Later** | Evaluate A2UI as wire format for marketplace components | Research | Future-proofing |
| **Later** | Double-iframe sandbox for user-created components | 1 week | Marketplace security |
| **Later** | Consider native tool-call rendering (when OpenClaw supports it) | Depends on upstream | Type safety at LLM level |
| **Skip** | CopilotKit, RSC streaming, WebComponents, full MCP Apps | — | Not worth the rewrite |

---

## Bottom Line

The `jarble_ui` system is **ahead of the curve**. The Zod validation, LLM-aware aliases, error self-healing, canvas grid, and runtime component definitions are capabilities no competitor or library matches. The main investment should be in **extensibility** (single manifest → marketplace) and **security** (sandbox CSP, iframe isolation for third-party components), not in replacing the architecture.

---

## Sources

### Competitor Platforms
- [ChatGPT Canvas & Apps SDK](https://developers.openai.com/apps-sdk/build/chatgpt-ui/)
- [Reverse-Engineered ChatGPT Iframe Sandbox](https://dev.to/infoxicator/i-reverse-engineered-chatgpt-apps-iframe-sandbox-2ok3)
- [Claude Artifacts Reverse Engineering](https://www.reidbarber.com/blog/reverse-engineering-claude-artifacts)
- [v0.dev Documentation](https://v0.app/docs)
- [Google A2UI Protocol](https://a2ui.org/specification/v0.9-a2ui/)
- [Perplexity Labs & PerplexiGrid](https://docs.perplexity.ai/cookbook/showcase/perplexigrid)

### Frameworks & Libraries
- [assistant-ui ToolUI](https://www.assistant-ui.com/docs/guides/ToolUI)
- [tool-ui Component Library](https://github.com/assistant-ui/tool-ui)
- [Vercel AI SDK 6](https://vercel.com/blog/ai-sdk-6)
- [AI SDK RSC (Paused)](https://github.com/vercel/ai/discussions/3251)
- [CopilotKit Generative UI](https://docs.copilotkit.ai/generative-ui)
- [AG-UI Protocol](https://docs.ag-ui.com/)
- [llm-ui Library](https://llm-ui.com/)
- [MCP Apps Specification](https://modelcontextprotocol.io/docs/extensions/apps)
- [Mastra AI](https://mastra.ai/)
- [LangGraph Generative UI](https://docs.langchain.com/langsmith/generative-ui-react)
