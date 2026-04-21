# Nightly Develop Health Report — 2026-04-21

**Run time**: 2026-04-21 08:11 UTC  
**develop HEAD**: `1769575`

---

## develop Typecheck

| Package | Result |
|---------|--------|
| API (`jarble-api-main`) | PASS |
| Frontend (`Jarble-mvp`) | PASS |

develop is **green**. Both packages compile cleanly.

---

## Branch Health (20 branches)

All branches are **77 commits behind develop** with **no merge conflicts**. Since yesterday's run (79 behind), develop gained 2 new commits and all branches uniformly moved to 77 behind. One new branch appeared: `fix/jar-126-dashboard-restart-not-found` (1 ahead / 1 behind — freshly cut, easy merge candidate).

| Branch | Ahead | Behind | Conflicts | Status |
|--------|-------|--------|-----------|--------|
| feature/jar-40-org-limits | 620 | 77 | 0 | REBASE |
| feature/jar-47-beta-promo-codes-v2 | 605 | 77 | 0 | REBASE |
| feature/jar-51-observability-phase-2-otel | 773 | 77 | 0 | REBASE |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 77 | 0 | REBASE |
| feature/jar-51-phase-3-cost-display | 703 | 77 | 0 | REBASE |
| feature/jar-51-phase-3-delegation-span | 668 | 77 | 0 | REBASE |
| feature/jar-51-phase-3-gateway-span | 669 | 77 | 0 | REBASE |
| feature/jar-51-phase-3-http-span | 675 | 77 | 0 | REBASE |
| feature/jar-51-phase-4-llm-spans | 671 | 77 | 0 | REBASE |
| feature/jar-51-phase-5-debug-drawer | 673 | 77 | 0 | REBASE |
| feature/jar-51-phase-6-runaway-breaker | 674 | 77 | 0 | REBASE |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 77 | 0 | REBASE |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 77 | 0 | REBASE |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 77 | 0 | REBASE |
| feature/jar-56-org-rbac | 661 | 77 | 0 | REBASE |
| feature/jar-59-60-billing-metrics | 765 | 77 | 0 | REBASE |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 77 | 0 | REBASE |
| fix/jar-48-block-storage-mount | 656 | 77 | 0 | REBASE |
| fix/jar-50-skill-call-topology | 791 | 77 | 0 | REBASE |
| fix/jar-126-dashboard-restart-not-found | 1 | 1 | 0 | REBASE |

**20 branches checked, 20 flagged for rebase** (all >=1 commit behind develop).
**0 branches with merge conflicts** -- rebases should be clean.

Notable patterns:
- New branch today: `fix/jar-126-dashboard-restart-not-found` (1 commit ahead, 1 behind -- simplest merge candidate).
- JAR-51 observability still has 11 sub-branches (phase-7 wire is shortest at 530 ahead).
- JAR-63 SSE streaming and JAR-59-60 billing remain most diverged (796 and 765 ahead).
- No new commits appeared on any of the 19 carry-over branches since yesterday.

---

## Linear Comments

Linear MCP not available -- skipping comments.

---

## Summary

- develop: GREEN (API + Frontend typecheck both pass)
- Branches: 20 checked, 20 need rebase (77 commits behind, 0 conflict files)
- Action: All open branch owners should `git fetch origin && git rebase origin/develop` before their next session.
- Quick win: `fix/jar-126-dashboard-restart-not-found` is ready to rebase and merge (1 commit each side, no conflicts).
