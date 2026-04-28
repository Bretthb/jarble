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

**org router** (tested 2026-04-23):
- `org.create` requires `{ name: string, slug: string }` — slug must be lowercase alphanumeric with hyphens (min 2 chars). `description` is NOT a valid field (schema does not include it).
- `org.getById` requires `{ orgId: string }` (NOT `id`).
- `org.delete` requires `{ orgId: string }` — returns `{ success: true }` on success.
- `org.list` — no input required, returns array.

**subagents router** (tested 2026-04-23):
- `subagents.list` requires `{ deploymentId: string }` — NOT a no-input procedure. Returns 404 for unknown deploymentId.

**deploymentSecrets router** (tested 2026-04-28, full live suite):
- `deploymentSecrets.list` does NOT exist — the test goal name is wrong. Correct procedure is `deploymentSecrets.getByDeployment`.
- `deploymentSecrets.getByDeployment` — GET query, requires `{ deploymentId: string }`, returns 404 for unknown/unowned deploymentId. Returns array of `{ id, key, maskedValue, source, scope, createdAt, updatedAt }` — no plaintext values ever exposed.
- `deploymentSecrets.save` — POST mutation, requires `{ deploymentId, key, value, scope? }`. scope defaults to "shared". Returns `{ success: true }`.
- `deploymentSecrets.delete` — POST mutation, idempotent (deleting a non-existent key returns 200 `{ success: true }`, not 404).
- Reserved env var keys (e.g. `ANTHROPIC_API_KEY`) return 400 BAD_REQUEST with a descriptive message.
- Invalid key format (lowercase, starts with digit, etc.) returns 400. Key regex: `^[A-Z][A-Z0-9_]{0,127}$`.
- User-scope secrets show `[client-encrypted]` as maskedValue instead of a partial reveal.
- All three procedures require auth — unauthenticated requests return 401.

**flows router** (tested 2026-04-23):
- `flows.create` requires `{ name, definition: { nodes: [], edges: [] }, description?, status?, entryNodeId?, teamType? }` — `definition` is a top-level required field (NOT `nodes`/`edges` at the root level).
- `flows.create` with `deployment` type nodes performs FK validation — use `output` type nodes in tests to avoid FK errors against non-existent deployments.
- `flows.listExecutions` requires `{ flowId: string }` — returns empty array when no executions exist.
- `flows.delete` with `{ id, hard: true }` performs a permanent hard delete — `getById` returns 404 afterward.

Admin router procedure names (NOT `getUsers`/`getMetrics` — those return 404):
- `admin.listUsers` — list all users (adminProcedure, returns 403 for non-admin)
- `admin.getStats` — platform stats / metrics (adminProcedure, returns 403 for non-admin)
- `admin.getRevenueStats`, `admin.getSystemHealth`, `admin.getClusterMetrics` — other admin queries
- `admin.listAllDeployments`, `admin.getUserById`, `admin.updateUserRole` — other admin procedures

`marketplace.getReviews` requires `{ componentId: string }` input, returns paginated reviews with summary.
`services.listByCreator` requires `{ creatorId: string }` input, is a public procedure.
`benchmarks.getPublicProfile` requires `{ deploymentId: string }`, returns 404 for unknown deployments.
`benchmarks.serviceLeaderboard` requires `{ serviceId: string }`, returns 200 with empty entries for unknown IDs.
`benchmarks.getServiceReviews` requires `{ serviceId: string }`, returns 200 with empty array for unknown IDs.
