---
name: tRPC AppRouter type resolution pattern
description: How the frontend resolves AppRouter types from the API via file: dependency and pre-built declarations
type: project
---

The frontend imports `type { AppRouter } from "jarble-api"` in `lib/trpc.ts` and `lib/trpc-vanilla.ts`.

**How it works:**
- `package.json` has `"jarble-api": "file:../jarble-api-main"` (symlink in node_modules)
- API's `package.json` has `"types": "dist/jarble-api-main/src/trpc/index.d.ts"`
- API has `tsconfig.declarations.json` that builds `.d.ts` files into `dist/`
- Frontend has `prebuild` and `precheck` hooks that run `cd ../jarble-api-main && npm run build:types`

**Why:** The Zod version split (frontend v4, API v3) means the frontend cannot directly import API source files. The declaration build runs under the API's own tsconfig with Zod v3 resolution, producing standalone `.d.ts` files that the frontend consumes without Zod conflicts.

**How to apply:** If new tRPC procedures are added or types change, the declarations auto-rebuild via the pre-hooks. If you see "Cannot find module 'jarble-api'" errors, run `cd jarble-api-main && npm run build:types`.

**Key constraint:** The API's `tsconfig.declarations.json` must build cleanly (0 errors) or declarations may contain `never` types that cascade into frontend errors. Arrays built with `const arr = []` pattern must have explicit type annotations in API router procedures.
