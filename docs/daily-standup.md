# Jarble Nightly Health Check — 2026-08-29 UTC

## Develop Branch Status

| Check | Result |
|-------|--------|
| API TypeScript (jarble-api-main) | ✅ PASS |
| Frontend TypeScript (Jarble-mvp) | ✅ PASS |

develop is clean and buildable.

## Branch Health (JAR feature/fix/cleanup branches)

All 20 active JAR branches are **50 commits behind develop** and have **0 real merge conflicts**.

> Note: The 50-commit gap is entirely composed of daily standup doc commits (`docs/daily-standup.md` updates via `SKIP_JAR_TAG=1`). No code changes are missing from any branch. There is no functional divergence risk from these docs-only commits.

| Branch | Ahead | Behind | Conflicts | Status |
|--------|-------|--------|-----------|--------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | docs-only gap |
| feature/jar-40-org-limits | 620 | 50 | 0 | docs-only gap |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | docs-only gap |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | docs-only gap |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | docs-only gap |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | docs-only gap |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | docs-only gap |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | docs-only gap |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | docs-only gap |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | docs-only gap |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | docs-only gap |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | docs-only gap |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | docs-only gap |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | docs-only gap |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | docs-only gap |
| feature/jar-56-org-rbac | 661 | 50 | 0 | docs-only gap |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | docs-only gap |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | docs-only gap |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | docs-only gap |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | docs-only gap |

**20 branches checked, 0 flagged for rebase** (50-commit gap is docs-only, not a code risk).

## Summary

- develop: fully green (API + Frontend typechecks pass)
- No active merge conflicts on any branch
- All branches diverged before the daily standup doc-commit series began; no functional commits are missing
- No action required today
