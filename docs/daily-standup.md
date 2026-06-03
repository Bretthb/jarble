# Nightly Develop Health Check — 2026-06-03

*Generated: 2026-06-03 08:15 UTC*

---

## Develop Typecheck

| Package | Result |
|---------|--------|
| `jarble-api-main` (tsc --noEmit) | ✅ PASS |
| `Jarble-mvp` (tsc --noEmit) | ✅ PASS |

No type errors on `develop`. Both packages clean.

---

## Feature Branch Status (JAR-numbered branches)

> **Note:** The working clone has a shallow history of 50 commits on `develop`. All branches diverged before the shallowest visible commit, so "50 behind" means *at least* 50 commits behind. The last 50 commits on `develop` are daily nightly-standup chore commits, so the real code divergence is primarily from functional work merged post-branch-creation.

| Branch | Ahead | Behind | Conflicts | Flagged? |
|--------|-------|--------|-----------|----------|
| `cleanup/jar-99-runtime-native-subagents-env` | 963 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-40-org-limits` | 620 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-47-beta-promo-codes-v2` | 605 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-observability-phase-2-otel` | 773 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-phase-2-langfuse-exporter` | 665 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-phase-3-cost-display` | 703 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-phase-3-delegation-span` | 668 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-phase-3-gateway-span` | 669 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-phase-3-http-span` | 675 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-phase-4-llm-spans` | 671 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-phase-5-debug-drawer` | 673 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-phase-6-runaway-breaker` | 674 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-phase-7-otel-plugin-scaffold` | 678 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-phase-7-wire-otel-plugin` | 530 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-51-prefer-jarble-memory-tools` | 678 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-56-org-rbac` | 661 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-59-60-billing-metrics` | 765 | ≥50 | 0 | ⚠️ rebase |
| `feature/jar-63-sse-streaming-thinking-ui` | 796 | ≥50 | 0 | ⚠️ rebase |
| `fix/jar-48-block-storage-mount` | 656 | ≥50 | 0 | ⚠️ rebase |
| `fix/jar-50-skill-call-topology` | 791 | ≥50 | 0 | ⚠️ rebase |

**Summary: 20 branches checked, 20 flagged for rebase (all ≥50 commits behind develop), 0 merge conflicts.**

The good news: no branch has a detected merge conflict with develop. Rebase flags are driven entirely by the behind count exceeding the 20-commit threshold. The trailing 50 commits on develop are all `chore: nightly health check standup` commits — rebasing should be low-risk for branches whose functional code has not conflicted.

---

## Linear MCP

Linear MCP server (`mcp__linear-server__*`) was not available in this session. Branch status comments were not posted to tickets.

---

## Recommended Actions

1. **Develop is green** — safe to merge PRs.
2. All 20 open JAR branches need a `git rebase origin/develop` before merge. Highest-priority by unique commit count (most active work):
   - `cleanup/jar-99` (963 unique commits)
   - `feature/jar-63-sse-streaming-thinking-ui` (796 ahead)
   - `fix/jar-50-skill-call-topology` (791 ahead)
   - `feature/jar-51-observability-phase-2-otel` (773 ahead)
   - `feature/jar-59-60-billing-metrics` (765 ahead)
3. No merge conflicts detected — rebases should be clean.
