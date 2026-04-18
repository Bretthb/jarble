---
name: merge_branch_2026_03_22
description: Merged UI-Tambo-ALL (121 commits) into main (80 commits) on merge-branch — 100% test pass rate achieved
type: project
---

## Merge Session (2026-03-22)

Merged UI-Tambo-ALL feature branch into main via `merge-branch` (safe staging approach).

**Branch strategy:** Created `merge-branch` from `origin/main`, merged UI-Tambo-ALL into it. This keeps both source branches untouched.

**Merge resolution:**
- 39 files had conflicts; resolved by taking UI-Tambo-ALL for most, main for Stripe
- Added missing main-only features: betaSignups, chatSessions, chatMessages, auditLogs tables, role column, adminProcedure, ip in tRPC context, getRowsAffected utility
- Installed missing packages: @stripe/react-stripe-js, @stripe/stripe-js, resend, @types/archiver
- Added MANAGED_KEY_PLANS to wizardStepConfig.ts (from main's Stripe checkout flow)

**Test fixes:**
- API: Fixed testDb.ts, init.ts, stripe.test.ts, billing.test.ts, openclawGateway.test.ts, serviceProxy.test.ts
- Frontend: Fixed useCanvasChat.test (missing CanvasState fields), canvasComponents.test (graceful degradation), sandbox-csp.test (Auth0 mock), sandboxCore.test (CSS change), simpleCanvasGrid.test (context menu rewrite), useDirectChat (final stripUIMarkers)

**Final state:** 107/107 test files, 3870/3870 tests passing. Zero API source type errors.

**GHCR pull secret:** Rotated 2026-03-22 (old `ghp_1qPO...` expired after 32 days). New token starts `ghp_KQJJ...`.

## Extended Session (overnight 2026-03-22)

**Phase 2 fixes:**
- 5 specialized agents ran (MCP server, env hardening, test writer, accessibility, performance)
- Fixed all admin page build errors (offset→page, field name mismatches, type annotations)
- Fixed Dashboard storageBatchQuery (endpoint not yet implemented — placeholder)
- Added Stripe inline checkout state to OnboardingWizard
- Added component name aliases (map_view, slider, confirm, etc.)
- Added ADMIN_USER_IDS + RESEND_API_KEY to env.ts Zod schema
- MCP server updates: sandbox redirect logic, component references
- New test files: manifest sync test, MANAGED_KEY_PLANS tests

**Final state:** 108/108 test files, 3893/3893 tests, `next build` passes, 0 source type errors.

**Why:** Pre-production merge — bringing all features into a single branch for deployment.
**How to apply:** merge-branch is ready to fast-forward to main once user approves. Run `git checkout main && git merge merge-branch`.
