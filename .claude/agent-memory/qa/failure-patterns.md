# Failure Patterns

Recurring issues discovered by QA agents and their root causes.

---

### FP-001: tRPC SuperJSON input format requires wrapped objects

- **Pattern**: Calling tRPC endpoints with bare values (e.g., `?input="openclaw"`) returns 400
- **Root cause**: tRPC + SuperJSON requires `{"json": {...}}` wrapping for all inputs
- **Classification**: EXPECTED_CHANGE
- **First seen**: 2026-03-24
- **Frequency**: Deterministic
- **Resolution**: Use `?input={"json":{"key":"value"}}` format always

### FP-002: Auth0 SPA SDK session injection — RESOLVED

- **Pattern** (original): Authenticated pages cleared session after first navigation
- **Root cause** (original): ROPG-granted refresh_token was single-use, Auth0 SPA SDK consumed it on first background refresh
- **Status**: RESOLVED as of 2026-03-26 by switching to real Auth0 UI login via Playwright
- **New approach**: QA browser agents log in through the real Auth0 UI (email/password on Auth0 page) — this creates a proper SDK-managed session that handles token refresh correctly
- **Note**: Do NOT inject localStorage tokens. Always use real Auth0 login flow.

### FP-003: Stale tRPC procedure names in test goals

- **Pattern**: `skills.list` and `platformCredentials.list` return 404
- **Root cause**: Procedure names don't match actual router exports
- **Classification**: EXPECTED_CHANGE (test documentation issue)
- **First seen**: 2026-03-24
- **Frequency**: Deterministic
- **Resolution**: Correct names: `skills.listCatalog`, `platformCredentials.getByDeployment`. See `qa-api-tester/project_trpc_procedure_names.md`.

### FP-004: flows.create requires label+position on nodes

- **Pattern**: flows.create returns 400 when node objects lack `label` and `position` fields
- **Root cause**: Zod schema requires `label: z.string().min(1)` and `position: {x: number, y: number}` on every node
- **Classification**: EXPECTED_CHANGE (documentation gap)
- **First seen**: 2026-03-26
- **Frequency**: Deterministic
- **Resolution**: Always include `label` and `position` on node objects in flows.create input

### FP-005: deployment.getPublicProfile uses `id` field not `deploymentId`

- **Pattern**: Passing `deploymentId` as the input key returns 400 BAD_REQUEST "Required"
- **Root cause**: The Zod schema for this endpoint uses field name `id`, not `deploymentId`
- **Classification**: EXPECTED_CHANGE (documentation mismatch)
- **First seen**: 2026-03-26
- **Frequency**: Deterministic
- **Resolution**: Use `?input={"json":{"id":"..."}}` format

### FP-006: React #418 hydration mismatch (pre-existing)

- **Pattern**: Console shows `React #418` hydration mismatch on every page
- **Root cause**: SSR HTML differs from client HTML (pre-existing issue, not from recent changes)
- **Classification**: ENVIRONMENT (pre-existing, not a regression)
- **First seen**: 2026-03-26
- **Frequency**: Deterministic (every page)
- **Impact**: No functional impact — pages render correctly. Not related to any specific PR.
- **Resolution**: Known issue, skip in reports unless it causes actual rendering problems.
