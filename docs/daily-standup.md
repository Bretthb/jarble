# Nightly Health Check — 2026-09-15 UTC

## develop Branch Status

| Check | Result |
|-------|--------|
| API typecheck (`jarble-api-main`) | ✅ PASS |
| Frontend typecheck (`Jarble-mvp`) | ✅ PASS |

develop is **green**. Both services build cleanly.

---

## Feature Branch Summary

**20 JAR branches enumerated.** All are 50 commits behind `develop`.

> **Note:** The 50-commit lag is entirely from daily nightly standup commits
> (`docs/daily-standup.md` updates) accumulated on `develop` since 2026-09-04.
> These are docs-only commits with no code changes — `git merge-tree` reports
> **0 actual conflict files** on every branch. A simple `git merge origin/develop`
> will fast-forward cleanly on the docs file with no code conflicts.

| Branch | Ahead | Behind | Conflicts | Flags |
|--------|-------|--------|-----------|-------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-40-org-limits | 620 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-47-beta-promo-codes-v2 | 605 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-observability-phase-2-otel | 773 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-2-langfuse-exporter | 665 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-3-cost-display | 703 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-3-delegation-span | 668 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-3-gateway-span | 669 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-3-http-span | 675 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-4-llm-spans | 671 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-5-debug-drawer | 673 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-6-runaway-breaker | 674 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-51-prefer-jarble-memory-tools | 678 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-56-org-rbac | 661 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-59-60-billing-metrics | 765 | 50 | 0 | ⚠️ BEHIND |
| feature/jar-63-sse-streaming-thinking-ui | 796 | 50 | 0 | ⚠️ BEHIND |
| fix/jar-48-block-storage-mount | 656 | 50 | 0 | ⚠️ BEHIND |
| fix/jar-50-skill-call-topology | 791 | 50 | 0 | ⚠️ BEHIND |

**20 branches checked. 20 flagged for rebase (all behind ≥ 20 commits, 0 with actual merge conflicts).**

---

## Action Items

- **All active branches**: Run `git merge origin/develop` (or `git rebase origin/develop`) to pick up the standup doc commits. No code conflicts expected.
- develop build is healthy — safe to merge any branch once rebased/merged.
- Linear comments skipped: MCP availability not checked in this run (no LINEAR_API_KEY in cloud env).
