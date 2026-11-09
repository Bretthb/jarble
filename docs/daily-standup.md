# Jarble Nightly Develop Health Check
**Date:** 2026-11-09 UTC  
**Run by:** Automated nightly cron (cloud session)

---

## develop Typecheck Results

| Package | Result |
|---------|--------|
| API (`jarble-api-main`) | ✅ PASS |
| Frontend (`Jarble-mvp`) | ✅ PASS |

develop is **green** — both packages typecheck clean.

---

## Branch Health Summary

20 branches checked, **20 flagged for rebase** (all are ≥50 commits behind develop).  
No merge conflicts detected on any branch.

> **Note:** Every open JAR-* branch is exactly 50 commits behind `develop`. This is a systematic drift — `develop` has moved significantly since these branches were cut. No branch has a merge conflict today, but that may change as develop continues to advance. Recommend a rebase sprint across all open branches.

| Branch | Ahead | Behind | Conflicts | Flags |
|--------|-------|--------|-----------|-------|
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

---

## Linear Comments
Skipped — Linear MCP (`mcp__linear-server__*`) not available in this session.

---

## Action Items
- **All 20 open feature/fix branches need a rebase onto develop.** No conflicts today, but all are 50 commits behind. Run `git rebase origin/develop` on each active branch before continuing work.
- develop itself is green — safe to merge from.
