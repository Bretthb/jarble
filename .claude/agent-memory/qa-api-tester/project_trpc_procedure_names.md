---
name: tRPC procedure name corrections
description: Actual procedure names for skills and platformCredentials routers — different from what docs/tests might assume
type: project
---

The skills router has NO `list` procedure. Correct procedure names are:
- `skills.listCatalog` — lists all available skills (protectedProcedure, no input required)
- `skills.listForDeployment` — lists skills installed on a deployment
- `skills.install` / `skills.uninstall` — install/remove skills

The platformCredentials router has NO `list` procedure. Correct procedure names are:
- `platformCredentials.getByDeployment` — requires `{ deploymentId: string }` input
- `platformCredentials.save` / `platformCredentials.delete`
- `platformCredentials.checkWhatsAppStatus`, `markWhatsAppConnected`, `pollTelegramPairing`, `testConnection`

**Why:** These were discovered when test goal 1 returned 404 for `skills.list` and `platformCredentials.list` — those procedures simply do not exist.

**How to apply:** Always verify procedure names by reading the router source before writing test goals. Do not assume `list` is the standard CRUD name for all routers.

Also: `runtimeCatalog.getById` requires a **numeric** `id`, not a string. Passing `"test"` returns 400 BAD_REQUEST.
`services.get` requires `serviceId` field, not `id`.
`benchmarks.leaderboard` requires `domainSlug` field, not `domainId`.
