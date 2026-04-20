# Nightly Develop Health Report — 2026-04-20

**Run time**: 2026-04-20 04:00 UTC  
**develop HEAD**: `97be1c9` — "feat: JAR-123 offline scaffolding — ZeroClaw README + seed description (#159)"

---

## develop Typecheck

| Package | Result |
|---------|--------|
| API (`jarble-api-main`) | PASS |
| Frontend (`Jarble-mvp`) | PASS |

develop is **green**. Both packages compile cleanly.

---

## Branch Health (19 branches)

All branches are exactly **79 commits behind develop** with **no merge conflicts**. The uniform lag suggests all were cut from the same base point before a burst of develop activity. Clean rebases should be possible on all of them.

| Branch | Ahead | Behind | Conflicts | Status |
|--------|-------|--------|-----------|--------|
| feature/jar-40-org-limits | 620 | 79 | 0 | REBASE |
| feature/jar-47-beta-promo-codes-v2 | 605 | 79 | 0 | REBASE |
| feature/jar-51-observability-phase-2-otel | 773 | 79 | 0 | REBASE |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 79 | 0 | REBASE |
| feature/jar-51-phase-3-cost-display | 703 | 79 | 0 | REBASE |
| feature/jar-51-phase-3-delegation-span | 668 | 79 | 0 | REBASE |
| feature/jar-51-phase-3-gateway-span | 669 | 79 | 0 | REBASE |
| feature/jar-51-phase-3-http-span | 675 | 79 | 0 | REBASE |
| feature/jar-51-phase-4-llm-spans | 671 | 79 | 0 | REBASE |
| feature/jar-51-phase-5-debug-drawer | 673 | 79 | 0 | REBASE |
| feature/jar-51-phase-6-runaway-breaker | 674 | 79 | 0 | REBASE |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 79 | 0 | REBASE |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 79 | 0 | REBASE |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 79 | 0 | REBASE |
| feature/jar-56-org-rbac | 661 | 79 | 0 | REBASE |
| feature/jar-59-60-billing-metrics | 765 | 79 | 0 | REBASE |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 79 | 0 | REBASE |
| fix/jar-48-block-storage-mount | 656 | 79 | 0 | REBASE |
| fix/jar-50-skill-call-topology | 791 | 79 | 0 | REBASE |

**19 branches checked, 19 flagged for rebase** (all >=20 commits behind develop).
**0 branches with merge conflicts** -- rebases should be clean.

Notable patterns:
- JAR-51 observability has 11 sub-branches; phase-7 wire-otel-plugin is shortest at 530 ahead.
- JAR-63 SSE streaming and JAR-59-60 billing are most diverged (796 and 765 ahead).
- JAR-40 org limits and JAR-47 promo codes are lightest (620, 605 ahead).

---

## Linear Comments

Linear MCP not available -- skipping comments.

---

## Summary

- develop: GREEN (API + Frontend typecheck both pass)
- Branches: 19 checked, 19 need rebase (79 commits behind, 0 conflict files)
- Action: All open branch owners should `git fetch origin && git rebase origin/develop` before their next session.
