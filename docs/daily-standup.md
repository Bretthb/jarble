# Nightly Health Check — 2026-06-30

Generated: 2026-06-30 08:09 UTC | Branch: `develop` | Run: nightly health check

---

## develop Health

| Check | Result |
|-------|--------|
| API typecheck (`jarble-api-main`) | **PASS** |
| Frontend typecheck (`Jarble-mvp`) | **PASS** |

develop is green. Latest commit: `6dd9d51 Update daily standup report for 2026-06-29`

---

## Branch Status (21 JAR branches checked)

All 21 branches are **50 commits behind develop** (develop has accumulated ~50 nightly standup commits since these branches last synced). No merge conflicts detected on any branch — rebasing is safe.

| Branch | Behind | Ahead | Conflicts | Flag |
|--------|--------|-------|-----------|------|
| cleanup/jar-99-runtime-native-subagents-env | 50 | 963 | none | REBASE |
| feature/jar-40-org-limits | 50 | 620 | none | REBASE |
| feature/jar-47-beta-promo-codes-v2 | 50 | 605 | none | REBASE |
| feature/jar-51-observability-phase-2-otel | 50 | 773 | none | REBASE |
| feature/jar-51-phase-2-langfuse-exporter | 50 | 665 | none | REBASE |
| feature/jar-51-phase-3-cost-display | 50 | 703 | none | REBASE |
| feature/jar-51-phase-3-delegation-span | 50 | 668 | none | REBASE |
| feature/jar-51-phase-3-gateway-span | 50 | 669 | none | REBASE |
| feature/jar-51-phase-3-http-span | 50 | 675 | none | REBASE |
| feature/jar-51-phase-4-llm-spans | 50 | 671 | none | REBASE |
| feature/jar-51-phase-5-debug-drawer | 50 | 673 | none | REBASE |
| feature/jar-51-phase-6-runaway-breaker | 50 | 674 | none | REBASE |
| feature/jar-51-phase-7-otel-plugin-scaffold | 50 | 678 | none | REBASE |
| feature/jar-51-phase-7-wire-otel-plugin | 50 | 530 | none | REBASE |
| feature/jar-51-prefer-jarble-memory-tools | 50 | 678 | none | REBASE |
| feature/jar-56-org-rbac | 50 | 661 | none | REBASE |
| feature/jar-59-60-billing-metrics | 50 | 765 | none | REBASE |
| feature/jar-63-sse-streaming-thinking-ui | 50 | 796 | none | REBASE |
| feature/jar-tos-consent-gate | 50 | 814 | none | REBASE |
| fix/jar-48-block-storage-mount | 50 | 656 | none | REBASE |
| fix/jar-50-skill-call-topology | 50 | 791 | none | REBASE |

**21 branches checked, 21 flagged for rebase** (all are 50 commits behind develop, >= 20 threshold)

---

## Notes

- Linear MCP unavailable in this run — no per-ticket comments posted.
- The "50 behind" is the nightly standup commits on develop; no code changes to develop itself in 24h.
- High "ahead" counts (530-963) suggest long-lived or possibly already-squash-merged branches. Consider pruning remote branches whose work has already landed in develop.
