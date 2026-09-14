# Jarble Nightly Develop Health Check — 2026-09-14

**Run date:** 2026-09-14 08:11 UTC

---

## Develop Branch Typecheck

| Package | Result |
|---------|--------|
| API (`jarble-api-main`) | ✅ PASS |
| Frontend (`Jarble-mvp`) | ✅ PASS |

Both `tsc --noEmit` passes clean. `develop` is buildable.

---

## Feature Branch Status (20 branches checked)

All 20 open JAR-prefixed branches are **50 commits behind `develop`**. No branches have merge conflicts.

| Branch | Ahead | Behind | Conflicts | Flag |
|--------|-------|--------|-----------|------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-40-org-limits | 620 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-56-org-rbac | 661 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | ⚠ NEEDS_REBASE |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | ⚠ NEEDS_REBASE |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | ⚠ NEEDS_REBASE |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | ⚠ NEEDS_REBASE |

**Summary:** 20 branches checked, **20 flagged for rebase** (all 50 commits behind develop), 0 with merge conflicts.

The uniform "50 behind" count suggests these are all long-lived branches that haven't been rebased recently (likely created before the current wave of develop commits). No conflicts were detected, so rebases should be clean.

---

## Notes

- Linear MCP not available — branch status comments not posted to Linear tickets.
- No changes committed or pushed. Run log is the deliverable.
