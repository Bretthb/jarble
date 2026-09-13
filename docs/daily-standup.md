# Jarble Nightly Health Check — 2026-09-13

**Run time**: 2026-09-13 UTC (scheduled 04:00 America/New_York)

---

## develop Branch Status

| Check | Result |
|-------|--------|
| API typecheck (`jarble-api-main`) | ✅ PASS |
| Frontend typecheck (`Jarble-mvp`) | ✅ PASS |

**develop is green.** Both the API (`jarble-api-main`) and frontend (`Jarble-mvp`) pass TypeScript compilation with zero errors.

---

## Feature Branch Health (21 branches)

> **Note**: Repo was cloned shallow; deepened to ~1,041 commits for this analysis. Some `behind` counts may still be conservative underestimates for very old branches.

| Branch | Ahead | Behind | Flags |
|--------|-------|--------|-------|
| cleanup/jar-99-runtime-native-subagents-env | +1 | -198 | ⚠️ NEEDS REBASE |
| feature/jar-40-org-limits | +4 | -544 | ⚠️ NEEDS REBASE |
| feature/jar-47-beta-promo-codes-v2 | **+0** | -555 | ⚠️ NEEDS REBASE (no unique commits — may be merged/abandoned) |
| feature/jar-51-observability-phase-2-otel | +7 | -394 | ⚠️ NEEDS REBASE |
| feature/jar-51-phase-2-langfuse-exporter | +1 | -496 | ⚠️ NEEDS REBASE |
| feature/jar-51-phase-3-cost-display | +5 | -462 | ⚠️ NEEDS REBASE |
| feature/jar-51-phase-3-delegation-span | +1 | -493 | ⚠️ NEEDS REBASE |
| feature/jar-51-phase-3-gateway-span | +2 | -493 | ⚠️ NEEDS REBASE |
| feature/jar-51-phase-3-http-span | +1 | -486 | ⚠️ NEEDS REBASE |
| feature/jar-51-phase-4-llm-spans | +1 | -490 | ⚠️ NEEDS REBASE |
| feature/jar-51-phase-5-debug-drawer | +1 | -488 | ⚠️ NEEDS REBASE |
| feature/jar-51-phase-6-runaway-breaker | +1 | -487 | ⚠️ NEEDS REBASE |
| feature/jar-51-phase-7-otel-plugin-scaffold | +1 | -483 | ⚠️ NEEDS REBASE |
| feature/jar-51-phase-7-wire-otel-plugin | +1 | -631 | ⚠️ NEEDS REBASE |
| feature/jar-51-prefer-jarble-memory-tools | +1 | -483 | ⚠️ NEEDS REBASE |
| feature/jar-56-org-rbac | **+0** | -499 | ⚠️ NEEDS REBASE (no unique commits — may be merged/abandoned) |
| feature/jar-59-60-billing-metrics | **+0** | -395 | ⚠️ NEEDS REBASE (no unique commits — may be merged/abandoned) |
| feature/jar-63-sse-streaming-thinking-ui | +1 | -365 | ⚠️ NEEDS REBASE |
| feature/jar-tos-consent-gate | +1 | -347 | ⚠️ NEEDS REBASE |
| fix/jar-48-block-storage-mount | +1 | -505 | ⚠️ NEEDS REBASE |
| fix/jar-50-skill-call-topology | +3 | -372 | ⚠️ NEEDS REBASE |

**Summary: 21 branches checked, 21 flagged for rebase.**

### Notable findings

- **3 branches with 0 commits ahead of develop** (`jar-47-beta-promo-codes-v2`, `jar-56-org-rbac`, `jar-59-60-billing-metrics`): these are pure subsets of develop. Their work is likely already merged — consider deleting them.
- **All jar-51 observability sub-branches** (9 branches) are 400-630 commits behind. This large family of branches may need coordinated rebase or squash-merge if they are still active.
- The **most behind branch** is `feature/jar-51-phase-7-wire-otel-plugin` at 631 commits behind develop.
- The **least behind** is `cleanup/jar-99-runtime-native-subagents-env` at 198 commits behind (still well past the ≥20 rebase threshold).

---

## Recommendations

1. **Delete stale zero-ahead branches**: `jar-47`, `jar-56`, `jar-59-60` appear to have no unreachable work — confirm and delete.
2. **Rebase or close all active branches**: Every active branch needs a rebase onto develop before it can be safely merged. With 350-600 commit gaps, merge conflicts are likely.
3. **Coordinate jar-51 family**: 9 branches share the same JAR-51 ticket prefix. Consider which are still relevant and consolidate before rebasing.
4. **develop itself is healthy**: no action needed on the main branch.

---

*Linear MCP not invoked in this session — no comment posting performed.*
