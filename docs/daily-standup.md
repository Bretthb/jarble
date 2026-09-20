# Jarble Nightly Health Check — 2026-09-20

**Generated**: 2026-09-20T08:10 UTC  
**Branch**: `develop` (tip: `a851285` — 2026-09-19)

---

## Develop Typecheck Results

| Package | Result |
|---------|--------|
| `jarble-api-main` (API) | ✅ PASS |
| `Jarble-mvp` (Frontend) | ✅ PASS |

**develop is GREEN and buildable.**

---

## Branch Health (21 open branches checked)

> **Note**: This session runs as a shallow clone — `git merge-base` could not find common ancestors between develop and feature branches. Conflict counts are not reliable. Staleness is assessed from last-commit date.

All 21 open branches last saw activity in **April 2026** (~5 months ago). Develop has advanced 50+ commits since then.

### All branches flagged for staleness (last commit > 4 months before develop tip)

| Branch | Last Commit | Status |
|--------|-------------|--------|
| `cleanup/jar-99-runtime-native-subagents-env` | 2026-04-23 | ⚠️ STALE |
| `feature/jar-40-org-limits` | 2026-04-08 | ⚠️ STALE |
| `feature/jar-47-beta-promo-codes-v2` | 2026-04-07 | ⚠️ STALE |
| `feature/jar-51-observability-phase-2-otel` | 2026-04-12 | ⚠️ STALE |
| `feature/jar-51-phase-2-langfuse-exporter` | 2026-04-08 | ⚠️ STALE |
| `feature/jar-51-phase-3-cost-display` | 2026-04-09 | ⚠️ STALE |
| `feature/jar-51-phase-3-delegation-span` | 2026-04-08 | ⚠️ STALE |
| `feature/jar-51-phase-3-gateway-span` | 2026-04-08 | ⚠️ STALE |
| `feature/jar-51-phase-3-http-span` | 2026-04-09 | ⚠️ STALE |
| `feature/jar-51-phase-4-llm-spans` | 2026-04-09 | ⚠️ STALE |
| `feature/jar-51-phase-5-debug-drawer` | 2026-04-09 | ⚠️ STALE |
| `feature/jar-51-phase-6-runaway-breaker` | 2026-04-09 | ⚠️ STALE |
| `feature/jar-51-phase-7-otel-plugin-scaffold` | 2026-04-09 | ⚠️ STALE |
| `feature/jar-51-phase-7-wire-otel-plugin` | 2026-04-09 | ⚠️ STALE |
| `feature/jar-51-prefer-jarble-memory-tools` | 2026-04-09 | ⚠️ STALE |
| `feature/jar-56-org-rbac` | 2026-04-08 | ⚠️ STALE |
| `feature/jar-59-60-billing-metrics` | 2026-04-09 | ⚠️ STALE |
| `feature/jar-63-sse-streaming-thinking-ui` | 2026-04-11 | ⚠️ STALE |
| `feature/jar-tos-consent-gate` | 2026-04-11 | ⚠️ STALE |
| `fix/jar-48-block-storage-mount` | 2026-04-08 | ⚠️ STALE |
| `fix/jar-50-skill-call-topology` | 2026-04-11 | ⚠️ STALE |

---

## Summary

- **develop**: ✅ TypeScript clean (API + Frontend)
- **Branches checked**: 21
- **Flagged (stale, >4 months behind develop)**: 21 of 21
- **Conflict detection**: Skipped — shallow clone, no common ancestors resolvable
- **Linear comments**: Skipped — Linear MCP OAuth not available in cloud session

### Recommended actions

1. **Audit stale branches**: All 21 branches have been dormant since April 2026. Confirm which Linear tickets are still In Progress/In Review and either close abandoned branches or rebase them onto develop.
2. **JAR-51 branch explosion**: 12 branches prefixed `feature/jar-51-*` suggest a large phased epic that may need consolidation or closure.
3. **Shallow clone**: The cloud session checks out with `--depth 50`. Conflict detection across branches with old history requires an unshallowed clone — run `git fetch --unshallow` locally for reliable merge-tree analysis.
