# Nightly Develop Health Check — 2026-10-30

**Generated:** 2026-10-30 08:06 UTC  
**Branch checked:** `develop`

---

## Develop Build Status

| Component | TypeScript | Result |
|-----------|-----------|--------|
| API (`jarble-api-main`) | `tsc --noEmit` | ✅ PASS |
| Frontend (`Jarble-mvp`) | `tsc --noEmit` | ✅ PASS |

**develop is GREEN.** Both API and frontend typecheck clean.

---

## Feature Branch Status (21 branches)

> Note: This session uses a shallow clone (depth=50). `behind` counts are accurate; `ahead` counts (all showing 50) reflect clone depth, not actual branch commits. Conflict detection via `git merge-tree` is limited by shallow depth.

| Branch | Ahead* | Behind | Conflicts | Flag |
|--------|--------|--------|-----------|------|
| cleanup/jar-99-runtime-native-subagents-env | 50* | 963 | 0 | ⚠️ REBASE |
| feature/jar-tos-consent-gate | 50* | 814 | 0 | ⚠️ REBASE |
| feature/jar-63-sse-streaming-thinking-ui | 50* | 796 | 0 | ⚠️ REBASE |
| fix/jar-50-skill-call-topology | 50* | 791 | 0 | ⚠️ REBASE |
| feature/jar-51-observability-phase-2-otel | 50* | 773 | 0 | ⚠️ REBASE |
| feature/jar-59-60-billing-metrics | 50* | 765 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-3-cost-display | 50* | 703 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-3-http-span | 50* | 675 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-5-debug-drawer | 50* | 673 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-6-runaway-breaker | 50* | 674 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-4-llm-spans | 50* | 671 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-3-delegation-span | 50* | 668 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-3-gateway-span | 50* | 669 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-2-langfuse-exporter | 50* | 665 | 0 | ⚠️ REBASE |
| feature/jar-56-org-rbac | 50* | 661 | 0 | ⚠️ REBASE |
| fix/jar-48-block-storage-mount | 50* | 656 | 0 | ⚠️ REBASE |
| feature/jar-47-beta-promo-codes-v2 | 50* | 605 | 0 | ⚠️ REBASE |
| feature/jar-40-org-limits | 50* | 620 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-7-otel-plugin-scaffold | 50* | 678 | 0 | ⚠️ REBASE |
| feature/jar-51-prefer-jarble-memory-tools | 50* | 678 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-7-wire-otel-plugin | 50* | 530 | 0 | ⚠️ REBASE |

*`ahead` values capped at shallow clone depth (50) — not reliable.

---

## Summary

- **develop:** ✅ Green (API typecheck PASS, Frontend typecheck PASS)
- **Branches checked:** 21
- **Flagged for rebase:** 21 / 21 (all branches are ≥ 530 commits behind develop)
- **Merge conflicts detected:** 0 (limited confidence due to shallow clone)

### Notable

All 21 open feature branches are massively behind `develop` — the closest is `feature/jar-51-phase-7-wire-otel-plugin` at 530 behind; the furthest is `cleanup/jar-99-runtime-native-subagents-env` at 963 behind. This suggests these branches have been open for a very long time without rebasing. Recommend auditing which are still active and rebasing or closing stale ones.

The `feature/jar-51-*` family (13 branches) appears to be phased work on JAR-51 (observability). These may be intentionally stacked or sequential rather than independent branches — worth reviewing if some can be merged or pruned.
