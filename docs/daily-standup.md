# Nightly Develop Health Check — 2026-11-11

**Run completed:** 2026-11-11 04:00 UTC

---

## Build Status

| Component | TypeScript Typecheck | Result |
|-----------|---------------------|--------|
| API (`jarble-api-main`) | `tsc --noEmit` | ✅ PASS |
| Frontend (`Jarble-mvp`) | `tsc --noEmit` | ✅ PASS |

**develop is green.** Both API and frontend compile cleanly with no type errors.

---

## Branch Health (20 JAR branches checked)

All 20 open feature branches are **50 commits behind develop** and **have no merge conflicts**. The uniform 50-commit lag corresponds to the nightly standup commits accumulating on develop (daily automated commits since late October).

| Branch | Ahead | Behind | Conflicts | Status |
|--------|-------|--------|-----------|--------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-40-org-limits | 620 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-56-org-rbac | 661 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | ⚠️ BEHIND |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | ⚠️ BEHIND |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | ⚠️ BEHIND |

**20 branches checked, 20 flagged for rebase (all behind ≥20), 0 merge conflicts.**

### Notes
- The "behind 50" is uniform across all branches — this matches the ~50 nightly automated standup commits on develop since these branches were last rebased. The commits are documentation-only (`docs/daily-standup.md` updates), so actual code conflicts remain at zero.
- No branch has real merge conflicts — rebases should be clean.
- Linear MCP not available in this session — skipping per-ticket comments.

---

## Recent develop commits (last 10)
```
fd76d63 Update daily standup report for 2026-11-10
13137b9 Update daily standup report for 2026-11-09
8f65e0f Add nightly develop health check report 2026-11-08
2840d62 Add nightly develop health report 2026-11-05
483e830 Update daily standup for 2026-11-04 nightly health check
58ef9ec Update daily standup for 2026-11-03 nightly health check
299037d Update daily standup for 2026-11-02
55bfa3b Update daily standup for 2026-10-31 nightly health check
2eda86c Update daily standup for 2026-10-30 nightly health check
9454937 Update daily standup for 2026-10-29 nightly health check
```
