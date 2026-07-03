# Nightly Health Check — 2026-07-03

Generated: 2026-07-03 04:00 ET | Branch: `develop` | Run: nightly health check

---

## develop Branch Health

| Check | Result |
|-------|--------|
| API typecheck (`jarble-api-main`) | ✅ PASS |
| Frontend typecheck (`Jarble-mvp`) | ✅ PASS |

develop is **green**. No type errors in either package.

---

## Feature Branch Status (JAR-numbered branches)

20 branches checked. **All 20 are 50 commits behind develop.** No merge conflicts on any branch.

> Note: develop has been receiving daily automated standup commits (`SKIP_JAR_TAG=1`). The uniform 50-behind figure suggests all branches were cut before this automation started and have not been rebased since. The good news: zero conflict files — rebases should be clean.

| Branch | Ahead | Behind | Conflicts | Flag |
|--------|-------|--------|-----------|------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-40-org-limits | 620 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-56-org-rbac | 661 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | ⚠️ rebase needed |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | ⚠️ rebase needed |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | ⚠️ rebase needed |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | ⚠️ rebase needed |

**Summary: 20 branches checked, 20 flagged for rebase (all 50 commits behind develop), 0 with merge conflicts.**

---

## Standouts

- `cleanup/jar-99-runtime-native-subagents-env` — 963 commits ahead of develop. Most diverged branch by far.
- `feature/jar-63-sse-streaming-thinking-ui` and `fix/jar-50-skill-call-topology` — 796 and 791 commits ahead respectively.
- All branches are conflict-free on merge-tree probe — rebasing onto develop should succeed without manual resolution.

---

## Notes

- Linear MCP was not available in this session; per-ticket branch comments were skipped.
- The 50-commit gap is uniform and consistent with daily nightly-standup commits on develop that have not been pulled into any active branch.
