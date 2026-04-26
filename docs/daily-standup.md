# Jarble Nightly Health Check
**Date**: 2026-04-26 08:18 UTC

---

## develop Branch Status

| Check | Result |
|-------|--------|
| API typecheck (`jarble-api-main`) | **PASS** |
| Frontend typecheck (`Jarble-mvp`) | **PASS** |

develop is green and buildable. Both packages typecheck clean with zero errors.

---

## Feature Branch Summary

20 branches checked, **20 flagged for rebase** (all are ≥20 commits behind develop, none have merge conflicts).

| Branch | Ahead | Behind | Conflicts | Flag |
|--------|------:|-------:|:---------:|------|
| cleanup/jar-99-runtime-native-subagents-env | 1 | 47 | 0 | REBASE |
| feature/jar-40-org-limits | 620 | 50 | 0 | REBASE |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | REBASE |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | REBASE |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | REBASE |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | REBASE |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | REBASE |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | REBASE |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | REBASE |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | REBASE |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | REBASE |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | REBASE |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | REBASE |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | REBASE |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | REBASE |
| feature/jar-56-org-rbac | 661 | 50 | 0 | REBASE |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | REBASE |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | REBASE |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | REBASE |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | REBASE |

---

## Observations

- **All branches remain 47-50 commits behind develop.** The drift pattern is unchanged from yesterday — no branches were rebased overnight. All rebases are expected to be clean (zero merge conflicts detected).
- **cleanup/jar-99** is still only 1 commit ahead and now 47 behind. This is the lowest-cost rebase — one commit on top of develop. Prioritize landing this first.
- **jar-51 family (13 branches)**: The observability epic remains split across many long-lived parallel branches (530-796 commits ahead). These have been drifting since yesterday with no reduction. Coordinate a rebase window across the whole family to avoid cascading conflicts when merging.
- **develop gained 1 commit overnight** (yesterday's standup commit `bd6f4c5`), pushing all already-stale branches one step further behind.
- **Linear MCP not available** — per-ticket branch status comments not posted this run.

---

## Next Actions

1. Rebase `cleanup/jar-99-runtime-native-subagents-env` on `origin/develop` — 1 commit, nearly landable.
2. Schedule a coordinated rebase window for the JAR-51 observability epic (13 branches, all stale at 50 behind).
3. No merge conflicts detected — all rebases should be mechanical once scheduled.
