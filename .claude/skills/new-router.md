---
description: "Scaffold a new tRPC router with proper auth, Zod v3 validation, and registration in the app router."
---

Create a new tRPC router. Ask the user for the router name and what procedures it needs if not provided.

Follow these steps:

### Step 1: Read an existing router for reference
Read `jarble-api-main/src/trpc/routers/apiKeys.ts` as a reference for the pattern (imports, protectedProcedure, Zod v3 schemas).

### Step 2: Create the router file
Create `jarble-api-main/src/trpc/routers/{name}.ts`:

```typescript
import { z } from "zod";
import { router, protectedProcedure, publicProcedure } from "../trpc";
import { db, tables } from "../../db";
import { eq } from "drizzle-orm";
import { logger } from "../../utils/logger";

const log = logger.child({ module: "{name}" });

export const {name}Router = router({
  // Add procedures here
});
```

**CRITICAL**: Use Zod v3 syntax (the API uses Zod v3, NOT v4). Do NOT use `z.object().parse()` patterns from Zod v4.

### Step 3: Register in app router
Add the import and router entry in `jarble-api-main/src/trpc/routers/index.ts` (or wherever the app router merges all routers).

### Step 4: Verify
Run `cd jarble-api-main && npx tsc --noEmit` to verify types are correct.

### Step 5: Update docs
Mention the new router in the tRPC Router Structure section context if appropriate.
