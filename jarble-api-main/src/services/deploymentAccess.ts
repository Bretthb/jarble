/**
 * Deployment access helpers.
 *
 * JAR-89 §10: 13+ tRPC procedure call sites across the routers
 * (billing, platformCredentials, skills, deploymentSecrets, subagents)
 * open-coded the same `findFirst` lookup:
 *
 *   ctx.db.query.deployments.findFirst({
 *     where: and(eq(deployments.id, X), eq(deployments.userId, Y)),
 *   })
 *
 * Consolidating here so the lookup contract has one home.
 *
 * ## Why this is separate from `findDeploymentWithAccess` in
 * `trpc/routers/deployment/helpers.ts`
 *
 * That helper is the org-aware version (creator OR org member, with
 * optional role gate). The 5 routers above currently DO NOT consult
 * org membership — they only allow the original creator. Migrating
 * each to org-aware access is a per-route product decision (which
 * roles can manage skills? which can read deploymentSecrets?), so the
 * mechanical refactor here preserves the existing behavior verbatim.
 *
 * Future PRs can swap individual call sites to `findDeploymentWithAccess`
 * once the desired role policy is settled per surface.
 */

import { eq, and } from "drizzle-orm";
import type { db as DbClient } from "../db/index.js";
import { tables } from "../db/index.js";

const { deployments } = tables;

/**
 * Find a deployment created by the given user. Returns null when the
 * deployment doesn't exist or the user isn't the creator.
 *
 * Does NOT check org membership — the deployment must have been created
 * by `userId` (i.e. `deployments.userId === userId`). Use
 * `findDeploymentWithAccess` (in `trpc/routers/deployment/helpers.ts`)
 * when you want the org-aware "creator OR org-member" semantics.
 */
export async function findDeploymentByCreator(
  db: typeof DbClient,
  deploymentId: string,
  userId: string,
): Promise<typeof deployments.$inferSelect | null> {
  const result = await db.query.deployments.findFirst({
    where: and(eq(deployments.id, deploymentId), eq(deployments.userId, userId)),
  });
  return result ?? null;
}
