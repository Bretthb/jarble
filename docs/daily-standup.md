# Jarble Develop Health Check — 2026-11-12

Generated: 2026-11-12 (nightly automated run)

---

## develop typecheck results

| Component | Result |
|-----------|--------|
| API (`jarble-api-main`) | ✅ PASS |
| Frontend (`Jarble-mvp`) | ✅ PASS |

develop is **green**. Both typechecks exited 0 with no errors.

---

## Branch Health (20 branches checked)

All branches are **50 commits behind develop**. This is a large drift — all 20 branches should rebase.

No merge conflicts detected on any branch (0 conflict files each).

| Branch | Ahead | Behind | Conflict Files | Flag |
|--------|-------|--------|----------------|------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | ⚠️ REBASE |
| feature/jar-40-org-limits | 620 | 50 | 0 | ⚠️ REBASE |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | ⚠️ REBASE |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | ⚠️ REBASE |
| feature/jar-56-org-rbac | 661 | 50 | 0 | ⚠️ REBASE |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | ⚠️ REBASE |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | ⚠️ REBASE |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | ⚠️ REBASE |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | ⚠️ REBASE |

**Summary: 20 branches checked, 20 flagged for rebase (all 50 commits behind develop, no conflicts)**

---

## Notes

- Linear MCP not available in this environment — no per-ticket comments posted.
- The uniform 50-behind count across all branches suggests develop had a large batch merge (e.g., a squash/rebase onto main) since these branches were cut. Branches are not in conflict with develop despite the gap, which is a good sign — rebases should be clean.
- JAR-51 has the most sub-branches (12 branches), suggesting active observability work in flight. Consider consolidating or merging completed phases.
