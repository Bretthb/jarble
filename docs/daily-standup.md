# Nightly Develop Health Check — 2026-08-28

**Run date:** 2026-08-28 UTC  
**Branch:** `develop`  
**Triggered by:** Scheduled nightly check (04:00 America/New_York)

---

## Develop Typecheck Results

| Layer | Status |
|-------|--------|
| API (`jarble-api-main`) | ✅ PASS — `tsc --noEmit` clean |
| Frontend (`Jarble-mvp`) | ✅ PASS — `tsc --noEmit` clean |

`develop` is green and buildable.

---

## Branch Health: JAR Feature Branches (20 total)

> **Note:** Linear MCP not available — skipping per-ticket comments.

All 20 branches are **50 commits behind `develop`** with **0 merge conflicts**. The behind-count continues to accumulate from automated nightly standup commits on `develop` — no actual merge conflicts detected via `git merge-tree`. Clean rebases expected.

| Branch | Ahead | Behind | Conflicts | Flag |
|--------|-------|--------|-----------|------|
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

**Summary: 20 branches checked, 20 flagged for rebase (all 50 behind develop, 0 merge conflicts)**

### Context

The 50-commit delta is almost entirely from automated `docs: update daily standup` commits accumulating on `develop`. The most recent develop commits confirm this pattern:

```
f35ed29 docs: update daily standup for 2026-08-27 (SKIP_JAR_TAG=1)
ff73683 docs: update daily standup for 2026-08-26 (SKIP_JAR_TAG=1)
5a5caf7 Update daily standup with nightly health check 2026-08-25 (SKIP_JAR_TAG=1)
9ad733c Update daily standup with nightly health check 2026-08-23
a901e98 Update daily standup with nightly health check 2026-08-22
```

No actionable conflicts — rebases on any of these branches should be clean.

---

## Action Items

- None blocking. `develop` is clean.
- All 20 open branches are rebasing targets but no conflicts to resolve manually.
