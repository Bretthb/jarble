# QA Chaos Agent Memory

## Security Test Findings

- [Flow Chat Auth Tests (2026-03-26)](findings_flow_chat_auth_2026-03-26.md) — Auth bypass, injection, input validation on /api/flows/:id/chat and flows tRPC router
- [Input Validation Gaps (2026-03-26)](findings_input_validation_2026-03-26.md) — flows.create has no name length enforcement beyond max(255); no message size cap on flow chat; XSS payloads reach flow lookup safely
- [Prototype Pollution tRPC (2026-03-26)](findings_prototype_pollution_2026-03-26.md) — __proto__ key in flows.create input is silently dropped by Zod; SQL injection in name stored as literal (Drizzle parameterized)
- [Path Traversal Express (2026-03-26)](findings_path_traversal_2026-03-26.md) — Express resolves ../../admin/chat to /admin/chat and returns 404 (not bypassed); curl rejects raw '; DROP TABLE' in URL as malformed
- [Debug Endpoints Production (2026-03-26)](findings_debug_endpoints_2026-03-26.md) — /debug/db, /api/version, /.env, /api/health all return 404 in production (correctly gated)
