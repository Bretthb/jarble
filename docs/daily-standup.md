# Nightly Develop Health Check — 2026-10-31 UTC

## develop Branch Status

| Check | Result |
|-------|--------|
| API typecheck (`jarble-api-main`) | ✅ PASS |
| Frontend typecheck (`Jarble-mvp`) | ✅ PASS |

develop is **green** as of 08:05 UTC.

---

## Open Feature Branch Health (20 branches checked)

All 20 branches are currently **50 commits behind develop** and show **1 conflict file** from merge-tree analysis. All are flagged for rebase.

| Branch | Ahead | Behind | Conflicts | Flags |
|--------|-------|--------|-----------|-------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-40-org-limits | 620 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-phase-3-http-span | 675 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-56-org-rbac | 661 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-59-60-billing-metrics | 765 | 50 | 1 | [REBASE][CONFLICT] |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 1 | [REBASE][CONFLICT] |
| fix/jar-48-block-storage-mount | 656 | 50 | 1 | [REBASE][CONFLICT] |
| fix/jar-50-skill-call-topology | 791 | 50 | 1 | [REBASE][CONFLICT] |

**Summary: 20 branches checked, 20 flagged for rebase (all 50 commits behind, 1 conflict file each).**

The consistent 50-commit gap and uniform 1-conflict-file count across all branches suggest these may all share a common ancestor point that predates a significant batch of recent merges to develop. Each branch author should rebase onto the latest develop before merging.

> Note: Linear MCP not invoked (deferred tool schema not loaded). Skipping per-ticket comments.
