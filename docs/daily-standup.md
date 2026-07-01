# Nightly Health Check — 2026-07-01

Generated: 2026-07-01 04:00 UTC | Branch: `develop` | Run: nightly health check

---

## develop Health

| Check | Result |
|-------|--------|
| API typecheck (`jarble-api-main`) | **PASS** |
| Frontend typecheck (`Jarble-mvp`) | **PASS** |

develop is green. Latest commit: `b102ac0 Update daily standup report for 2026-06-30`

---

## Branch Status (20 JAR branches checked)

Shallow clone (depth ~50) means "behind" counts are capped and unreliable. Conflict analysis uses `git merge-tree` on file trees and is accurate. All branches show 0 merge conflicts with develop — merging/rebasing is low-risk.

All 20 branches were last updated in **April 2026** (69–85 days ago). `feature/jar-tos-consent-gate` from yesterday is gone (likely merged/deleted).

| Branch | Last Commit | Conflicts | Stale |
|--------|-------------|-----------|-------|
| cleanup/jar-99-runtime-native-subagents-env | 2026-04-23 | none | 69 days |
| feature/jar-40-org-limits | 2026-04-08 | none | 84 days |
| feature/jar-47-beta-promo-codes-v2 | 2026-04-07 | none | 85 days |
| feature/jar-51-observability-phase-2-otel | 2026-04-12 | none | 80 days |
| feature/jar-51-phase-2-langfuse-exporter | 2026-04-08 | none | 84 days |
| feature/jar-51-phase-3-cost-display | 2026-04-09 | none | 83 days |
| feature/jar-51-phase-3-delegation-span | 2026-04-08 | none | 84 days |
| feature/jar-51-phase-3-gateway-span | 2026-04-08 | none | 84 days |
| feature/jar-51-phase-3-http-span | 2026-04-09 | none | 83 days |
| feature/jar-51-phase-4-llm-spans | 2026-04-09 | none | 83 days |
| feature/jar-51-phase-5-debug-drawer | 2026-04-09 | none | 83 days |
| feature/jar-51-phase-6-runaway-breaker | 2026-04-09 | none | 83 days |
| feature/jar-51-phase-7-otel-plugin-scaffold | 2026-04-09 | none | 83 days |
| feature/jar-51-phase-7-wire-otel-plugin | 2026-04-09 | none | 83 days |
| feature/jar-51-prefer-jarble-memory-tools | 2026-04-09 | none | 83 days |
| feature/jar-56-org-rbac | 2026-04-08 | none | 84 days |
| feature/jar-59-60-billing-metrics | 2026-04-09 | none | 83 days |
| feature/jar-63-sse-streaming-thinking-ui | 2026-04-11 | none | 81 days |
| fix/jar-48-block-storage-mount | 2026-04-08 | none | 84 days |
| fix/jar-50-skill-call-topology | 2026-04-11 | none | 81 days |

**20 branches checked, 0 conflict files. All 20 are 69–85 days stale (no activity since April 2026).**

---

## Notes

- Linear MCP unavailable in this run — no per-ticket comments posted.
- `feature/jar-tos-consent-gate` disappeared since yesterday's run (merged or deleted).
- JAR-51 has 13 phase branches open — worth confirming which are merged and pruning remote refs.
- These stale branches have no merge conflicts, so landing them or closing them is low-risk now. The risk grows as develop continues to accumulate commits.
