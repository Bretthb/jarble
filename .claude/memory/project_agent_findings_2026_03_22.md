---
name: agent_findings_2026_03_22
description: Comprehensive agent audit findings — a11y violations, perf issues, SSE bugs, MCP gaps. Reference for future sessions.
type: project
---

## Agent Audit Findings (2026-03-22)

5 specialized agents ran overnight. Key findings by category:

### Accessibility (35 violations found)
- **Critical**: Context menu has no ARIA roles, carousel dots 8px (need 24px), resize handle keyboard-inaccessible, inline chat send button has no aria-label, stat tiles not keyboard accessible
- **Major**: Hover-only controls invisible to keyboard (action bars, delete buttons, card menu), opacity-modified text fails contrast (`/60` and `/70` suffixes), reasoning expand has no `aria-expanded`
- **Priority fix order**: Context menu ARIA → keyboard-inaccessible elements → hover-only controls → send button label → contrast → touch targets

### Performance (14 findings)
- **High**: framer-motion in all statically-imported canvas components (~30KB), useCanvasChat has 12+ useState causing cascading re-renders, unstable renderCard callback
- **Medium**: posthog-js loaded eagerly (~40KB), theme fonts loaded on all pages (~150KB), CanvasCardWrapper + react-rnd unused
- **Unused deps**: @aws-sdk/client-s3, @aws-sdk/s3-request-presigner, html2canvas, react-player, react-rnd, axios (~60KB combined savings)

### SSE Streaming (4 actionable issues — FIXED)
- `jarble_design_context` not suppressed (FIXED)
- Nested backticks break fence suppression (FIXED)
- Frontend stripUIMarkers too narrow (FIXED)
- TOOL_CALL_ARGS overwrite vs accumulate (latent, not yet a bug)

### MCP Server (5 issues — FIXED)
- Runtime copy missing sandbox redirect (FIXED)
- COMPONENT_REFERENCE only 22 of 45 (FIXED — now 46)
- Fallback BUILTIN_COMPONENTS incomplete (FIXED — now 44)
- render_ui phantom component names (FIXED)
- Categories object incomplete (FIXED — now 6 categories)

**Why:** Reference for prioritizing future polish work.
**How to apply:** A11y critical items should be fixed before public beta. Perf items before scaling. SSE/MCP already fixed.
