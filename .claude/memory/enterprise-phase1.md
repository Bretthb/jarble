---
name: Enterprise feature — Phase 1 backend
description: Organizations, account types, agent listings, and orgAuth utility added to the Jarble platform backend (2026-03-28)
type: project
---

Enterprise/Business two-sided marketplace - Phase 1 backend complete.

**Why:** Jarble needs to evolve from single-user to a two-sided marketplace where Businesses deploy agents and Builders monetize them.

**What was added:**
- `accountType` column on users table (individual/business/builder)
- `orgId` column on deployments table (nullable — null = personal, set = org deployment)
- `organizations` + `orgMembers` tables (all 3 schema files + init.ts)
- `agentListings` + `agentListingReviews` tables (all 3 schema files + init.ts)
- `orgAuth.ts` utility (assertDeploymentAccess, assertOrgAccess, getAccessibleDeploymentsWhere)
- `org.ts` tRPC router (12 procedures: CRUD, members, invites, transfer, usage stats)
- `setAccountType` mutation on user router
- `getOrgOverview` on billing router
- Deployment router refactored: list, getById, getComponentCatalog, create, update, stop, start, restart, cancel, reactivate now use orgAuth
- ~20 remaining userId checks in deployment router still use old pattern (incremental migration)

**How to apply:** Phase 2 (agent listings router) and Phase 3 (deploy-from-listing flow) are next. Frontend org switcher and agent marketplace pages still needed.
