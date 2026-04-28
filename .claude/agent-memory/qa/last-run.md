# Last QA Run

## Run Details
- **Timestamp**: 2026-04-28T04:08:25.837Z
- **Git SHA**: 9d19c18
- **Duration**: ~12 minutes
- **Pass rate**: 100% (7 pass, 0 warn, 0 fail, 0 skip out of 7 goals)
- **Unit tests**: 3223 pass, 10 fail (beta-promo.test.ts pre-existing), 67 skip
- **New tests added**: deploymentSecrets.test.ts — 38/38 PASS
- **Real bugs found**: 0 new
- **UX gaps found**: 0 new (billing $27.40/$0 subscriptions is known FP-007)

## Goals Tested

| # | Goal | Type | Status | Notes |
|---|------|------|--------|-------|
| 1 | deploymentSecrets auth enforcement | API | PASS | 401 on all 3 procedures without auth |
| 2 | deploymentSecrets.getByDeployment — list secrets | API | PASS | Returns masked secrets; shared="dev-*******y-qa", user="[client-encrypted]" |
| 3 | deploymentSecrets.save — create/update secret | API | PASS | Validation works: reserved keys rejected, lowercase key rejected, empty value rejected |
| 4 | deploymentSecrets.delete — delete secret | API | PASS | Idempotent (delete non-existent key -> 200 success, not 404) |
| 5 | /orgs page UI | UI | PASS | Empty state renders correctly; "Create your first organization" CTA present |
| 6 | Visual regression — dashboard | UI | PASS | Running deployment card, workspace banner, no overflow |
| 7 | Visual regression — billing | UI | PASS | All sections present; $27.40 spend vs 0 subscriptions (known FP-007) |

## Key Findings

### Code Change Verified: deploymentSecrets Router (9d19c18)
- New test file `deploymentSecrets.test.ts` (531 lines) — 38/38 pass in unit tests
- Live production endpoints all work correctly
- Procedure name is `deploymentSecrets.getByDeployment` (not `.list` as docs might say)
- Secret values are masked in API response: shared scope shows partial mask, user scope shows "[client-encrypted]"
- Reserved key validation works (ANTHROPIC_API_KEY rejected with descriptive message)
- Key format validation works: must match `/^[A-Z][A-Z0-9_]{0,127}$/`
- Delete is idempotent — consistent with unit test expectations

### /orgs Page First Browser Test
- Page renders correctly with empty state for users with no orgs
- Two CTA paths: header "Create Organization" button + main "Create your first organization" button
- No console errors, no layout issues

### Pre-existing Unit Test Failure: beta-promo.test.ts
- 10 tests fail with `SqliteError: table promo_codes has no column named discount_type`
- CONTRADICTS: both testDb.ts and testSchema.sqlite.ts have this column defined in CREATE TABLE SQL
- Failure occurs only in "expiration + usage caps" and "success response shape" describe blocks
- Likely a Vitest worker isolation or DB state issue — NOT introduced by current PR (#246)
- Was last touched in commit 27e3b8f (2026-04-22); current PR (#246) only adds deploymentSecrets test file
- NEEDS INVESTIGATION: healer should investigate why SQLite reports missing column despite schema definition

## Healer Actions
None dispatched — all QA goals passed. beta-promo failures are pre-existing unit test issue.

## Next Run Priorities
1. **INVESTIGATE beta-promo failures** — 10 unit tests failing despite schema having the columns; possible Vitest isolation bug
2. **Test /d/[id] with existing deployment** — QA-BYOK-Test-0425 is still Running; test chat UX (FP-009 repro)
3. **Test /orgs/[orgId] page** — never tested; needs creating an org first
4. **Test deploymentSecrets.save per-deployment limit** — unit tests cover a 20-secret limit; verify limit enforced in prod
5. **Test org.create flow in UI** — create an org via the /orgs page CTA
