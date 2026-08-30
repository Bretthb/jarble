# Jarble Nightly Develop Health Check
**Date**: 2026-08-30 UTC  
**Branch**: develop  

---

## Typecheck Results

| Package | Result |
|---------|--------|
| API (`jarble-api-main`) | ✅ PASS |
| Frontend (`Jarble-mvp`) | ✅ PASS |

Both packages typecheck clean with zero errors.

---

## Feature Branch Health

All 20 open feature branches are **50 commits behind develop**. No branch has a merge conflict -- all would merge cleanly if rebased first.

The behind-count is almost entirely from automated nightly standup commits accumulating on develop -- rebases on any of these branches should be clean.

| Branch | Ahead | Behind | Conflicts | Flags |
|--------|-------|--------|-----------|-------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | REBASE |
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

**Summary: 20 branches checked, 20 flagged for rebase (all 50 behind develop, 0 merge conflicts)**

---

## Notes

- Linear MCP not available -- branch status comments were not posted to tickets.
- The `jar-51-*` cluster has 12 branches covering observability phases -- all behind by the same 50 commits, suggesting they forked before the same block of develop commits landed.
- `cleanup/jar-99` is unusually far ahead (963 commits) -- may be a long-running branch worth reviewing for splitting.
