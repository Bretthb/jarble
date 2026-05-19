# Jarble Nightly Develop Health Check — 2026-05-19

Generated: 2026-05-19 08:07 UTC

## Develop Typecheck Results

| Package | Result |
|---------|--------|
| API (`jarble-api-main`) | **PASS** — `tsc --noEmit` exit 0 |
| Frontend (`Jarble-mvp`) | **PASS** — `tsc --noEmit` exit 0 |

Develop is green. Safe to merge into.

## Branch Status

All branches measured against `origin/develop`. Flagged if behind >= 20 OR merge conflicts > 0.

| Branch | Ahead | Behind | Conflicts | Status |
|--------|-------|--------|-----------|--------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | REBASE NEEDED |
| feature/jar-40-org-limits | 620 | 50 | 0 | REBASE NEEDED |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | REBASE NEEDED |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | REBASE NEEDED |
| feature/jar-56-org-rbac | 661 | 50 | 0 | REBASE NEEDED |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | REBASE NEEDED |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | REBASE NEEDED |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | REBASE NEEDED |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | REBASE NEEDED |

**20 branches checked, 20 flagged for rebase.**

## Notes

- All 20 branches are uniformly 50 commits behind develop, suggesting a recent batch merge into develop that no open branches have incorporated yet.
- No merge conflicts detected on any branch — rebases should be clean.
- Largest divergences (most ahead): `cleanup/jar-99` (963), `feature/jar-63-sse-streaming-thinking-ui` (796), `fix/jar-50-skill-call-topology` (791), `feature/jar-59-60-billing-metrics` (765). These should be prioritized for merge or rebase.

## Linear Comments

Linear MCP was not available in this run — automated ticket comments were skipped.
