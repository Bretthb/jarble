# Testing Reference

## Quick Commands

```bash
# Run all tests
cd jarble-api-main && npm test           # 934 backend tests
cd Jarble-mvp && npm test                # 367 frontend tests

# Single file
npx vitest run path/to/file.test.ts

# With coverage
npm run test:coverage

# Type checking (no emit)
cd jarble-api-main && npm run typecheck
cd Jarble-mvp && npm run check
```

## E2E Tests (Playwright)

```bash
cd Jarble-mvp

# First time: fetch Auth0 tokens + seed deployment
npm run test:e2e:auth

# Run all E2E
npm run test:e2e

# Specific suites
npm run test:e2e:browse
npm run test:e2e:chat
npm run test:e2e:edit

# Single spec
npx playwright test e2e/smoke.spec.ts

# View report
npm run test:e2e:report
```

Requires `e2e/.env.test` with Auth0 ROPC credentials (see `e2e/.env.test.example`).

## Test Patterns

### Backend Integration Tests
Use in-memory SQLite with fresh DB per test:
```ts
import { createTestDb } from "../helpers/testDb.js";
import { createTestCaller } from "../helpers/testCaller.js";

let db, caller;
beforeEach(() => {
  db = createTestDb();
  caller = createTestCaller(db, { userId: "test-user" });
});
```

### Common Mocks
- **K8s**: `vi.mock("./client.js")` — avoids KubeConfig init
- **Encryption**: `vi.mock("./env.js")` — controls encryption key
- **Frontend hooks**: Mock `EventSource`, `window.matchMedia`, `localStorage`
- **Stripe/fetch**: Mock in router tests

### Writing New Tests
- Backend unit: `{name}.test.ts` next to source
- Backend integration: `src/__tests__/routers/`
- Frontend unit: `__tests__/` subdirectory next to source
