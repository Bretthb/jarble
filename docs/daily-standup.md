# Nightly Develop Health Report — 2026-04-22

**Run time**: 2026-04-22 08:32 UTC  
**develop HEAD**: `26a43b4`

---

## develop Typecheck

| Package | Result |
|---------|--------|
| API (`jarble-api-main`) | PASS |
| Frontend (`Jarble-mvp`) | PASS |

develop is **green**. Both packages compile cleanly.

---

## Branch Health (19 branches)

All 19 branches are **67 commits behind develop** with **no merge conflicts**. Since yesterday's run (77 behind), develop has moved forward 10 commits and one branch (`fix/jar-126-dashboard-restart-not-found`) is no longer visible in remote — likely merged.

| Branch | Ahead | Behind | Conflicts | Status |
|--------|-------|--------|-----------|--------|
| feature/jar-40-org-limits | 620 | 67 | 0 | REBASE |
| feature/jar-47-beta-promo-codes-v2 | 605 | 67 | 0 | REBASE |
| feature/jar-51-observability-phase-2-otel | 773 | 67 | 0 | REBASE |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 67 | 0 | REBASE |
| feature/jar-51-phase-3-cost-display | 703 | 67 | 0 | REBASE |
| feature/jar-51-phase-3-delegation-span | 668 | 67 | 0 | REBASE |
| feature/jar-51-phase-3-gateway-span | 669 | 67 | 0 | REBASE |
| feature/jar-51-phase-3-http-span | 675 | 67 | 0 | REBASE |
| feature/jar-51-phase-4-llm-spans | 671 | 67 | 0 | REBASE |
| feature/jar-51-phase-5-debug-drawer | 673 | 67 | 0 | REBASE |
| feature/jar-51-phase-6-runaway-breaker | 674 | 67 | 0 | REBASE |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 67 | 0 | REBASE |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 67 | 0 | REBASE |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 67 | 0 | REBASE |
| feature/jar-56-org-rbac | 661 | 67 | 0 | REBASE |
| feature/jar-59-60-billing-metrics | 765 | 67 | 0 | REBASE |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 67 | 0 | REBASE |
| fix/jar-48-block-storage-mount | 656 | 67 | 0 | REBASE |
| fix/jar-50-skill-call-topology | 791 | 67 | 0 | REBASE |

**19 branches checked, 19 flagged for rebase** (all 67 commits behind develop).  
**0 branches with merge conflicts** -- rebases should be clean.

Notable patterns:
- `fix/jar-126-dashboard-restart-not-found` dropped off the remote -- likely merged since yesterday.
- develop gained ~10 commits overnight (77 behind -> 67 behind for all branches).
- JAR-51 observability still has 11 sub-branches in flight; phase-7-wire-otel-plugin is the shortest (530 ahead).
- JAR-63 SSE streaming and JAR-59-60 billing remain most diverged (796 and 765 ahead).
- No new commits appeared on any carry-over branch since yesterday.

---

## Linear Comments

Linear MCP not available -- skipping comments.

---

## Summary

- develop: **GREEN** (API + Frontend typecheck both pass)
- Branches: 19 checked, 19 need rebase (67 commits behind, 0 conflict files)
- Action: All open branch owners should `git fetch origin && git rebase origin/develop` before their next session.
- Good news: develop moved forward ~10 commits and one branch merged -- momentum is positive.
