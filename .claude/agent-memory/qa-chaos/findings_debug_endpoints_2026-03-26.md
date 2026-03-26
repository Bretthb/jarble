---
name: Debug Endpoints Production Exposure 2026-03-26
description: All debug/info endpoints return 404 in production — correctly gated behind dev-only routing
type: project
---

Test run: 2026-03-26 against https://api.jarble.ai

Endpoints tested:
- GET /api/version -> 404 PASS
- GET /api/debug -> 404 PASS
- GET /.env -> 404 PASS
- GET /api/health -> 404 PASS
- GET /debug/db -> 404 PASS (CLAUDE.md documents this as dev-only)

All return plain Express 404 HTML, not any server info or stack traces.
The debug router (/debug/*) is correctly not mounted in the production build.
