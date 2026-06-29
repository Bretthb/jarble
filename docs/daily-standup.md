# Nightly Health Check — 2026-06-29

Generated: 2026-06-29 04:00 UTC | Branch: `develop` | Run: nightly health check

---

## Typecheck Results

| Project | Result |
|---------|--------|
| API (`jarble-api-main`) | PASS |
| Frontend (`Jarble-mvp`) | PASS |

`develop` is fully buildable. No type errors.

---

## Branch Health (20 branches checked, 20 flagged for rebase)

All 20 open JAR branches are at least 50 commits behind develop (shallow clone caps the exact count at 50). The visible develop history is entirely automated nightly standup commits — no new real code was merged to develop today.

**Real code changes on develop since branches diverged (carried forward from 2026-06-28):**
- `a727fc3` Simplify Research page to honest placeholder
- `ef12527` Add public Research page and nav link (#257)
- `c64bdd2` Phase 0 dashboard design foundation + plan (JAR-136) (#256)
- `04a57e5` docs: reconcile to Agent Infrastructure Platform + harness-owns-chat

**No branches have merge conflicts** — all would merge cleanly if rebased today.

### Per-Branch Rows

| Branch | Ahead | Behind | Conflicts | Flag |
|--------|-------|--------|-----------|------|
| cleanup/jar-99-runtime-native-subagents-env | 963 | ≥50 | 0 | REBASE |
| feature/jar-40-org-limits | 620 | ≥50 | 0 | REBASE |
| feature/jar-47-beta-promo-codes-v2 | 605 | ≥50 | 0 | REBASE |
| feature/jar-51-observability-phase-2-otel | 773 | ≥50 | 0 | REBASE |
| feature/jar-51-phase-2-langfuse-exporter | 665 | ≥50 | 0 | REBASE |
| feature/jar-51-phase-3-cost-display | 703 | ≥50 | 0 | REBASE |
| feature/jar-51-phase-3-delegation-span | 668 | ≥50 | 0 | REBASE |
| feature/jar-51-phase-3-gateway-span | 669 | ≥50 | 0 | REBASE |
| feature/jar-51-phase-3-http-span | 675 | ≥50 | 0 | REBASE |
| feature/jar-51-phase-4-llm-spans | 671 | ≥50 | 0 | REBASE |
| feature/jar-51-phase-5-debug-drawer | 673 | ≥50 | 0 | REBASE |
| feature/jar-51-phase-6-runaway-breaker | 674 | ≥50 | 0 | REBASE |
| feature/jar-51-phase-7-otel-plugin-scaffold | 678 | ≥50 | 0 | REBASE |
| feature/jar-51-phase-7-wire-otel-plugin | 530 | ≥50 | 0 | REBASE |
| feature/jar-51-prefer-jarble-memory-tools | 678 | ≥50 | 0 | REBASE |
| feature/jar-56-org-rbac | 661 | ≥50 | 0 | REBASE |
| feature/jar-59-60-billing-metrics | 765 | ≥50 | 0 | REBASE |
| feature/jar-63-sse-streaming-thinking-ui | 796 | ≥50 | 0 | REBASE |
| fix/jar-48-block-storage-mount | 656 | ≥50 | 0 | REBASE |
| fix/jar-50-skill-call-topology | 791 | ≥50 | 0 | REBASE |

Note: Shallow clone (depth 50) caps the behind count. The gap is mostly automated nightly standup commits, not real code drift. No branch needs an urgent rebase — all would merge cleanly today.

JAR-51 has 10 open sub-phase branches (observability epic) — consider pruning stale sub-phases that have been superseded.

---

## Linear Comments

Linear MCP not available in this session — skipping automated comments.

---

## Summary

`develop` is green (API + Frontend typechecks pass). No real code landed on develop today. 20 branches open, all flagged as ≥50 behind with 0 merge conflicts. No action required.
