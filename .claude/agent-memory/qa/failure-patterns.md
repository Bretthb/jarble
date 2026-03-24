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

### FP-002: Auth0 SPA SDK session injection — refresh_token rotation

- **Pattern**: Authenticated pages show content on first load, then clear to "Please log in" on subsequent navigations
- **Root cause**: Auth0 has refresh token rotation enabled. The ROPG-granted refresh_token is single-use. The Auth0 SPA SDK consumes it on the first background refresh, then subsequent refreshes fail because the original injected token is invalidated.
- **Classification**: ENVIRONMENT (Auth0 tenant config issue)
- **First seen**: 2026-03-24 (evolved from original FP-002 which was missing refresh_token entirely)
- **Frequency**: Deterministic — first navigation works, all subsequent fail
- **Console signature**: `[Auth] Token refresh failed: a: Unknown or invalid refresh token.` + HTTP 403 from `jarble-dev.us.auth0.com/oauth/token`
- **Resolution options**:
  1. Disable refresh token rotation in Auth0 dev tenant
  2. Block the SDK's refresh attempt in test mode (intercept network)
  3. Accept first-load testing as sufficient proof of page functionality
- **Note**: The ORIGINAL FP-002 (missing refresh_token entirely) is now FIXED — injection format with refresh_token IS correct and works for initial page load

### FP-003: Stale tRPC procedure names in test goals

- **Pattern**: `skills.list` and `platformCredentials.list` return 404
- **Root cause**: Procedure names don't match actual router exports
- **Classification**: EXPECTED_CHANGE (test documentation issue)
- **First seen**: 2026-03-24
- **Frequency**: Deterministic
- **Resolution**: Correct names: `skills.listCatalog`, `platformCredentials.getByDeployment`. See `qa-api-tester/project_trpc_procedure_names.md`.
