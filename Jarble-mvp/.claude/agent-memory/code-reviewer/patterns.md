---
name: Recurring code review patterns
description: Patterns that recur across Jarble codebase reviews and deserve consistent flagging
type: feedback
---

## Patterns to flag in every review

**Credit ledger operations must be in a DB transaction.**
`marketplaceHub.ts` balance-check → debit → HTTP call → record is not atomic. Any new credit-affecting code must use `db.transaction()` to prevent double-debit under concurrent requests.
**Why:** Two concurrent callers can both pass balance check before either debit lands.
**How to apply:** Flag any code that reads a balance and then writes a debit/credit in separate awaits.

**New env vars must go in `env.ts` Zod schema.**
`JARBLE_API_URL`, `API_BASE_URL`, `DEFAULT_POD_IMAGE`, `POD_PROXY_URL` bypass `env.ts`. Any new env var accessed via bare `process.env.X` instead of `env.X` is unvalidated and untyped.
**Why:** Silent fallback to wrong defaults causes prod failures that don't show up locally.
**How to apply:** Flag every `process.env.X` that isn't in `env.ts`.

**New REST routes need ownership checks AND JWT verification.**
Many route files (tamboAgent, knowledge, canvasFiles, files, diagnose) inline their own auth. They don't always match each other's pattern. Flag any new route that calls `verifyToken` without also checking `deployment.userId === user.id`.

**Test DB drift: new tables must be added to `testDb.ts`.**
After any schema addition, `src/__tests__/helpers/testDb.ts` must get the corresponding `CREATE TABLE` statement. As of Mar 2026, ~19 tables from Track B/C features are missing.
**Why:** Tests that touch missing tables fail with "no such table", silently hiding coverage gaps.

**`as any` in DB inserts is expected (schema union type issue).**
The `as any` casts on `.values({...} as any)` in insert calls are a known Drizzle limitation from the three-database schema union. Do not flag these as type safety issues unless the cast is on business logic, not schema types.

**MCP server changes are high-risk.**
`jarble-ui-server.js` is 7,110 lines of CJS with no module boundaries. Any change to tool dispatch or the `executeTool` switch can silently break other tools. Treat all MCP server PRs as requiring extra scrutiny.
