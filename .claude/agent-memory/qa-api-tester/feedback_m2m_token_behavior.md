---
name: M2M token user provisioning behavior
description: Client-credentials (M2M) Auth0 tokens auto-provision a user row and work for most protected endpoints
type: feedback
---

M2M (client-credentials) tokens are accepted by all `protectedProcedure` endpoints. When a previously-unseen M2M `sub` authenticates, the API auto-provisions a user row in the DB (email set to `{sub}@auth0.user`). Subsequent calls return real data scoped to that user.

**Why:** The auth middleware does a user-upsert on every request, so M2M tokens become a valid "user" with an empty dataset (no deployments, no flows, etc.) rather than returning 401.

**How to apply:** When testing protected endpoints with M2M tokens, expect 200 with empty arrays/null values — not a token rejection. Track which endpoints return user-specific data vs. system data. The distinction matters: `billing.getOverview` and `agentCredits.getBalance` return structured objects with zero values, confirming the data model works even for fresh M2M users.
