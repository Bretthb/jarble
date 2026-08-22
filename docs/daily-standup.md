# Jarble Nightly Health Check — 2026-08-22 UTC

## develop branch status

| Check | Result |
|-------|--------|
| API typecheck (`jarble-api-main`) | **PASS** |
| Frontend typecheck (`Jarble-mvp`) | **PASS** |

develop is green and buildable.

## Feature branch health (JAR-* branches)

All 20 branches are **50 commits behind** develop (threshold: 20). No merge conflicts detected on any branch.

| Branch | Ahead | Behind | Conflicts | Flag |
|--------|-------|--------|-----------|------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | ⚠ rebase |
| feature/jar-40-org-limits | 620 | 50 | 0 | ⚠ rebase |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | ⚠ rebase |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | ⚠ rebase |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | ⚠ rebase |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | ⚠ rebase |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | ⚠ rebase |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | ⚠ rebase |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | ⚠ rebase |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | ⚠ rebase |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | ⚠ rebase |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | ⚠ rebase |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | ⚠ rebase |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | ⚠ rebase |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | ⚠ rebase |
| feature/jar-56-org-rbac | 661 | 50 | 0 | ⚠ rebase |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | ⚠ rebase |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | ⚠ rebase |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | ⚠ rebase |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | ⚠ rebase |

**20 branches checked, 20 flagged for rebase** (all 50 commits behind develop, no conflicts).

The good news: no merge conflicts exist — rebases should be clean. The JAR-51 series (observability/otel) has 10 open branches, suggesting active parallel work on that epic.

## Linear MCP
Not available in this session — skipped per-ticket comment posting.
