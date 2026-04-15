import { TRPCError } from "@trpc/server";
import { eq, and } from "drizzle-orm";
import { tables, type DbClient } from "../../../db/index.js";
import type { OrgRole } from "../org.js";

const { deployments, orgMembers } = tables;

/**
 * Find a deployment and verify the caller has access.
 * - Personal deployments (orgId is null): only the creator (userId) can access
 * - Org deployments: any org member can read; mutations require owner/admin role
 *
 * Returns the deployment + the caller's org role (null for personal deployments).
 * Throws NOT_FOUND if deployment doesn't exist or caller has no access.
 */
export async function findDeploymentWithAccess(
  db: DbClient,
  deploymentId: string,
  userId: string,
  opts?: { requireRole?: OrgRole[] },
): Promise<{ deployment: any; orgRole: OrgRole | null }> {
  // 1. First try to find by userId (personal deployment or user is creator)
  let deployment = await db.query.deployments.findFirst({
    where: and(eq(deployments.id, deploymentId), eq(deployments.userId, userId)),
    with: { runtimeCatalogEntry: true },
  });

  if (deployment) {
    // Personal deployment or user is the creator
    if (!deployment.orgId) {
      return { deployment, orgRole: null };
    }
    // Creator is also an org member — get their role
    const membership = await db.query.orgMembers.findFirst({
      where: and(eq(orgMembers.orgId, deployment.orgId), eq(orgMembers.userId, userId)),
    });
    const role = (membership?.role ?? "member") as OrgRole;
    if (opts?.requireRole && !opts.requireRole.includes(role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Requires ${opts.requireRole.join(" or ")} role` });
    }
    return { deployment, orgRole: role };
  }

  // 2. Not the creator — check if it's an org deployment they have access to
  const dep = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    with: { runtimeCatalogEntry: true },
  });

  if (!dep || !dep.orgId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
  }

  // Verify org membership
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.orgId, dep.orgId), eq(orgMembers.userId, userId)),
  });
  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
  }

  const role = membership.role as OrgRole;

  // Check visibility — members can't see "admin" visibility deployments
  if ((dep as any).visibility === "admin" && role === "member") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
  }

  // Check required role for mutations
  if (opts?.requireRole && !opts.requireRole.includes(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Requires ${opts.requireRole.join(" or ")} role` });
  }

  return { deployment: dep, orgRole: role };
}
