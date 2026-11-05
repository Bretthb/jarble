# Develop Health Report — 2026-11-05

## Typecheck Results

| Project | Result |
|---------|--------|
| API (`jarble-api-main`) | **PASS** — no TypeScript errors |
| Frontend (`Jarble-mvp`) | **PASS** — no TypeScript errors |

Develop branch is fully green.

---

## Branch Health (20 JAR branches checked)

All branches are **50 commits behind** `develop`. No merge conflicts detected.

| Branch | Ahead | Behind | Conflicts | Flags |
|--------|-------|--------|-----------|-------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | [BEHIND] |
| feature/jar-40-org-limits | 620 | 50 | 0 | [BEHIND] |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | [BEHIND] |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | [BEHIND] |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | [BEHIND] |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | [BEHIND] |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | [BEHIND] |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | [BEHIND] |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | [BEHIND] |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | [BEHIND] |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | [BEHIND] |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | [BEHIND] |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | [BEHIND] |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | [BEHIND] |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | [BEHIND] |
| feature/jar-56-org-rbac | 661 | 50 | 0 | [BEHIND] |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | [BEHIND] |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | [BEHIND] |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | [BEHIND] |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | [BEHIND] |

**Summary: 20 branches checked, 20 flagged for rebase (all 50 commits behind develop), 0 with merge conflicts.**

---

## Notes

- Linear MCP not available — skipping per-ticket comments.
- No merge conflicts found on any branch; rebases should be clean.
- The `jar-51` family has the most parallel branches (12 sub-branches) — coordinate merge order carefully to avoid stacking issues.
