# Jarble Nightly Health Check — 2026-09-16

## develop Branch — Typecheck Results

| Package | Result |
|---------|--------|
| **API** (`jarble-api-main`) | ✅ PASS — `tsc --noEmit` clean |
| **Frontend** (`Jarble-mvp`) | ✅ PASS — `tsc --noEmit` clean |

## Feature Branch Status (JAR-numbered branches)

All 20 branches are exactly **50 commits behind** `develop`. However, all 50 missing commits are nightly standup report docs (`docs/daily-standup.md`) — **no code changes** have landed on `develop` since these branches diverged. No merge conflicts detected on any branch.

| Branch | Ahead | Behind | Conflicts | Flag |
|--------|-------|--------|-----------|------|
| `cleanup/jar-99-runtime-native-subagents-env` | 963 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-40-org-limits` | 620 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-47-beta-promo-codes-v2` | 605 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-observability-phase-2-otel` | 773 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-phase-2-langfuse-exporter` | 665 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-phase-3-cost-display` | 703 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-phase-3-delegation-span` | 668 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-phase-3-gateway-span` | 669 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-phase-3-http-span` | 675 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-phase-4-llm-spans` | 671 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-phase-5-debug-drawer` | 673 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-phase-6-runaway-breaker` | 674 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-phase-7-otel-plugin-scaffold` | 678 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-phase-7-wire-otel-plugin` | 530 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-51-prefer-jarble-memory-tools` | 678 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-56-org-rbac` | 661 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-59-60-billing-metrics` | 765 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `feature/jar-63-sse-streaming-thinking-ui` | 796 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `fix/jar-48-block-storage-mount` | 656 | 50 | 0 | ⚠️ behind≥20 (docs only) |
| `fix/jar-50-skill-call-topology` | 791 | 50 | 0 | ⚠️ behind≥20 (docs only) |

## Summary

**20 branches checked, 20 flagged for "behind≥20" — but all 50 missing commits are nightly standup docs only.**

- ✅ `develop` typechecks are clean (API + Frontend)
- ✅ No merge conflicts on any feature branch
- ℹ️ All feature branches diverged before the nightly standup doc commits started landing. A rebase would be low-risk but only pulls in docs files.
- ⚠️ Many branches appear stale (some 963 commits ahead of develop on their own side) — branches like `feature/jar-51-*` have extensive series of commits that may never have been merged. Consider reviewing for merge-readiness.
