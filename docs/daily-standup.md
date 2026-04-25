# Jarble Nightly Health Check
**Date**: 2026-04-25 08:09 UTC

---

## develop Branch Status

| Check | Result |
|-------|--------|
| API typecheck (`jarble-api-main`) | **PASS** |
| Frontend typecheck (`Jarble-mvp`) | **PASS** |

develop is green and buildable. Both packages typecheck clean with zero errors.

---

## Feature Branch Summary

20 branches checked, **20 flagged for rebase** (all are ≥20 commits behind develop, none have merge conflicts).

| Branch | Ahead | Behind | Conflicts | Flag |
|--------|------:|-------:|:---------:|------|
| cleanup/jar-99-runtime-native-subagents-env | 1 | 46 | 0 | REBASE |
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

---

## Observations

- **All branches are 46-50 commits behind develop.** Consistent drift pattern, likely from a large recent merge onto develop. No conflicts despite the drift -- clean rebases expected.
- **cleanup/jar-99** is only 1 commit ahead. It is nearly ready to land but needs a rebase first -- prioritize this one.
- **jar-51 family (13 branches)**: The observability epic is split across many long-lived parallel branches (530-796 commits ahead). Coordinate rebases across this family together to minimize conflict risk.
- **Linear MCP not available** -- per-ticket branch status comments not posted. Run with Linear MCP authenticated to enable automated nudges.

---

## Next Actions

1. Rebase all flagged branches on `origin/develop`, starting with `jar-99` (1 commit -- nearly landable).
2. Plan a coordinated rebase window for the JAR-51 observability epic branches.
3. No merge conflicts detected so all rebases should be mechanical.
