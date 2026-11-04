# Jarble Nightly Health Check — 2026-11-04

**Run completed**: 2026-11-04 ~04:00 UTC  
**Branch checked**: `develop`

---

## Develop Typecheck Results

| Package | Result |
|---------|--------|
| API (`jarble-api-main`) | ✅ PASS |
| Frontend (`Jarble-mvp`) | ✅ PASS |

`develop` is green. Both `tsc --noEmit` runs exited 0.

---

## Feature Branch Health (20 branches)

All branches forked from a point 50 commits behind `develop`. No actual merge conflicts detected on any branch.

| Branch | Ahead | Behind | Conflicts | Status |
|--------|-------|--------|-----------|--------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-40-org-limits | 620 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-56-org-rbac | 661 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | ⚠️ BEHIND≥20 |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | ⚠️ BEHIND≥20 |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | ⚠️ BEHIND≥20 |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | ⚠️ BEHIND≥20 |

**Summary**: 20 branches checked, 20 flagged for rebase (all 50 behind develop), 0 with merge conflicts.

---

## Notes

- All branches are exactly 50 commits behind `develop` — this is a uniform gap, suggesting they all share a common fork point. Good news: `git merge-tree` reports 0 conflict files for every branch, so rebases should be clean.
- Linear MCP not available — skipped per-ticket Linear comments.
- No files committed in this run (report written to `docs/daily-standup.md` only).
