# Jarble Nightly Develop Health Check
**Date:** 2026-05-20 08:12 UTC
**Branch:** develop

---

## Build Health

| Target | Status |
|--------|--------|
| API typecheck (`jarble-api-main`) | **PASS** |
| Frontend typecheck (`Jarble-mvp`) | **PASS** |

Both `tsc --noEmit` exits 0 on develop. No blocking type errors.

---

## Branch Health — JAR-* Feature Branches

All 20 branches are **50 commits behind develop** and have **0 merge conflicts**. The uniform 50-commit lag means they all predate the same develop push wave; merges should be clean but each branch needs a rebase before review.

| Branch | Ahead | Behind | Conflicts | Flag |
|--------|------:|-------:|:---------:|------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | BEHIND≥20 |
| feature/jar-40-org-limits | 620 | 50 | 0 | BEHIND≥20 |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | BEHIND≥20 |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | BEHIND≥20 |
| feature/jar-56-org-rbac | 661 | 50 | 0 | BEHIND≥20 |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | BEHIND≥20 |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | BEHIND≥20 |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | BEHIND≥20 |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | BEHIND≥20 |

---

## Summary

**20 branches checked, 20 flagged for rebase (all 50 commits behind develop, 0 merge conflicts).**

- develop is fully green (API + Frontend typechecks pass).
- No branch has text conflicts against develop — rebases should land cleanly.
- Branches are quite far ahead (530-963 commits) of develop, suggesting substantial in-progress work. Priority rebase candidates by commit volume: `cleanup/jar-99` (963 ahead), `feature/jar-63` (796 ahead), `fix/jar-50` (791 ahead).
- Linear MCP was not available in this run — no per-ticket comments posted.
