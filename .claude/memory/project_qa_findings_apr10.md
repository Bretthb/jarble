---
name: QA Findings April 10, 2026
description: Comprehensive QA session findings - bugs fixed, features tested, remaining issues
type: project
originSessionId: c15213cf-e687-4400-ad85-03c7babc46c4
---
## Session Summary (Apr 10, 2026)

22+ commits on develop. Major features built and tested.

### Features Built
- Jarble-OpenClaw Bridge (4 MCP tools + 3 API routes + 20 tests)
- Active team selection (activeFlowId per deployment)
- Bot teams UX (wider layout 1600px, hierarchy dropdown z-fix, node removal, delete confirmation, prompt-based Run)
- Auto-restart on API key/provider/model/memory change
- Delegation card rendering (blockquote instead of raw JSON)
- 8 QA skills per feature (53 tests via slash commands)
- Visual QA infrastructure (7 DOM health checks + regression persona)

### Critical Bugs Fixed
- P0: collaborates/reports edges silently broken (type vs label field mismatch)
- P0: stat_grid crash on numeric change prop
- P0: stat_grid icons render as text
- P1: Knowledge Base 500 (API pod /data path)
- P1: Raw exec errors leaked to users
- P1: ConfigPanel missing credentials section
- P1: Auto-restart not firing on API key change
- P1: JARBLE_API_URL missing from bot pods (bridge tools fail)

### Remaining Issues
- **HIGH: data_table cells render EMPTY** - headers show, rows exist, but cell content blank
- **MEDIUM: Dashboard auto-redirect** to /d/[id] after 3-5s intermittently
- **MEDIUM: Pipeline execution doesn't chain results** between nodes
- **LOW: Bot sometimes returns text instead of rendering components**

**Why:** These findings came from deep functional testing with real delegation, real components, real team topologies.
**How to apply:** Fix data_table empty cells first (most visible demo-killer). Dashboard redirect needs client-side investigation.
