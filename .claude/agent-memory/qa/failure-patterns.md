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

### FP-002: Auth0 SPA SDK session injection fails with useRefreshTokens

- **Pattern**: All authenticated frontend pages show "Please log in to view..." despite valid access_token in localStorage
- **Root cause**: `Auth0Provider.tsx` uses `useRefreshTokens={true}`. SDK's `_getTokenUsingRefreshToken()` needs `refresh_token` in cache body. Injection only provides `access_token`.
- **Classification**: ENVIRONMENT (QA infrastructure issue)
- **First seen**: 2026-03-24
- **Frequency**: Deterministic — blocks ALL authenticated UI tests
- **Resolution**: Fix `scripts/nightly-qa/lib/auth.mjs` to capture refresh_token from Auth0 ROPG response and include it in injection payload
- **Console signature**: `[Auth] Token refresh failed: Missing Refresh Token (audience: 'https://api.jarble.ai')`

### FP-003: Stale tRPC procedure names in test goals

- **Pattern**: `skills.list` and `platformCredentials.list` return 404
- **Root cause**: Procedure names don't match actual router exports
- **Classification**: EXPECTED_CHANGE (test documentation issue)
- **First seen**: 2026-03-24
- **Frequency**: Deterministic
- **Resolution**: Correct names: `skills.listCatalog`, `platformCredentials.getByDeployment`. See `qa-api-tester/project_trpc_procedure_names.md`.
