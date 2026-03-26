---
description: "Run both typechecks and test suites (API + frontend) before deploying. Catches cross-project breakage from the Zod v3/v4 split."
---

Run the full verification suite for both projects. This catches issues from the Zod v3/v4 split and cross-project dependencies.

Run all 4 checks, reporting results for each:

```bash
# 1. API typecheck
cd jarble-api-main && npx tsc --noEmit 2>&1 | tail -20

# 2. Frontend typecheck
cd Jarble-mvp && npx tsc --noEmit 2>&1 | tail -20

# 3. API tests
cd jarble-api-main && npx vitest run 2>&1 | tail -20

# 4. Frontend tests
cd Jarble-mvp && npx vitest run 2>&1 | tail -20
```

Report a clear pass/fail summary:
- ✓ API typecheck
- ✓ Frontend typecheck
- ✓ API tests (X passed)
- ✓ Frontend tests (X passed)

If ANY check fails, warn the user and show the errors. Do NOT proceed with deployment until all 4 pass.
