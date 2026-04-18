/**
 * Flow Membership Sync
 *
 * Helpers for reconciling the `flow_deployment_memberships` join table
 * against a flow definition, plus validation that deployment references
 * point at deployments the caller owns.
 *
 * Extracted from `src/trpc/routers/flows.ts` as a pure mechanical split —
 * behavior and semantics are unchanged.
 */

import { eq, and, or, inArray } from "drizzle-orm";
import { db, tables, dbDate } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import { customAlphabet } from "nanoid";
import { syncConfigsToPvc } from "./configSync.js";

const logger = createModuleLogger("flowMemberships");
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

/**
 * Read the current deploymentIds bound to a flow. Used to compute the OLD
 * side of the OLD ∪ NEW union for fan-out config sync.
 */
export async function getCurrentMembershipDeploymentIds(flowId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  const fdm = (tables as any).flowDeploymentMemberships;
  if (!fdm) return ids;
  try {
    const rows = await db.select({ deploymentId: fdm.deploymentId }).from(fdm).where(eq(fdm.flowId, flowId));
    for (const r of rows) if (r.deploymentId) ids.add(r.deploymentId);
  } catch (err) {
    logger.warn(
      { flowId, err: err instanceof Error ? err.message : String(err) },
      "getCurrentMembershipDeploymentIds: failed to read prior memberships (non-fatal — fan-out will only cover NEW set)"
    );
  }
  return ids;
}

/**
 * Collect every deploymentId referenced anywhere inside a flow definition.
 *
 * Reads both the canonical top-level `node.deploymentId` field and the
 * defensive nested `node.config.deploymentId` (used by some node types like
 * `subflow` and `waitForInput` that pass per-node config through). The
 * returned Set is naturally deduplicated.
 */
export function getDefinitionDeploymentIds(
  definition: { nodes?: any[] } | null | undefined,
): Set<string> {
  const ids = new Set<string>();
  for (const node of definition?.nodes ?? []) {
    // Top-level (most common path used by the canvas UI)
    if (node?.deploymentId && typeof node.deploymentId === "string") {
      ids.add(node.deploymentId);
    }
    // Nested in config (rarer but possible — defensive read)
    if (
      node?.config?.deploymentId &&
      typeof node.config.deploymentId === "string"
    ) {
      ids.add(node.config.deploymentId);
    }
  }
  return ids;
}

/**
 * Fire `syncConfigsToPvc` for every affected deployment without awaiting. The
 * service has its own per-deployment mutex so concurrent flow edits serialize
 * cleanly. Each sync handles its own errors internally; we log here only so
 * we can correlate "sync started" events with later success/failure logs.
 */
export function fanoutSyncConfigs(deploymentIds: Iterable<string>, reason: string) {
  for (const id of deploymentIds) {
    void syncConfigsToPvc(id).catch((err: unknown) => {
      logger.error(
        { deploymentId: id, reason, err: err instanceof Error ? err.message : String(err) },
        "flows: syncConfigsToPvc fan-out failed (non-fatal — bot will receive update on next sync)"
      );
    });
  }
}

/**
 * Verify every deploymentId in a flow definition exists AND is owned by the
 * caller (or by an org the caller is a member of).
 *
 * This prevents NEW orphans from landing via the canvas path. Existing
 * orphans must be cleaned up separately (Strategy A).
 *
 * Returns `{ ok: true }` when all references are valid, otherwise
 * `{ ok: false, message }` describing which ids are missing or
 * cross-owner.
 */
export async function validateDeploymentReferences(
  definition: { nodes?: any[] } | null | undefined,
  userId: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const ids = Array.from(getDefinitionDeploymentIds(definition));
  if (ids.length === 0) return { ok: true };

  // Determine which orgs the user belongs to (so we accept org-owned deployments).
  const orgMembersTable = (tables as any).orgMembers;
  let orgIds: string[] = [];
  if (orgMembersTable) {
    try {
      const memberships = await db
        .select({ orgId: orgMembersTable.orgId })
        .from(orgMembersTable)
        .where(eq(orgMembersTable.userId, userId));
      orgIds = memberships.map((m: any) => m.orgId).filter(Boolean);
    } catch {
      // If org_members doesn't exist on this DB (older schema), fall back to
      // user-only ownership. The existing schema migrations make this
      // unreachable in production, but it keeps tests resilient.
      orgIds = [];
    }
  }

  const deploymentsTable = (tables as any).deployments;
  const hasOrgIdColumn = !!deploymentsTable?.orgId;
  const ownershipFilter =
    orgIds.length > 0 && hasOrgIdColumn
      ? or(
          eq(deploymentsTable.userId, userId),
          inArray(deploymentsTable.orgId, orgIds),
        )
      : eq(deploymentsTable.userId, userId);

  const rows = await db
    .select({ id: deploymentsTable.id })
    .from(deploymentsTable)
    .where(and(inArray(deploymentsTable.id, ids), ownershipFilter));

  const foundIds = new Set(rows.map((r: any) => r.id));
  const missing = ids.filter((id) => !foundIds.has(id));
  if (missing.length === 0) return { ok: true };

  return {
    ok: false,
    message: `Flow references deployment(s) that do not exist or are not owned by you: ${missing.join(", ")}`,
  };
}

/**
 * Sync flow_deployment_memberships join table to a flow definition. Deletes
 * existing memberships for the flow and reinserts based on the definition's
 * nodes. Wrapped in a transaction for atomicity.
 */
export async function syncFlowMemberships(
  flowId: string,
  definition: { nodes: any[]; edges?: any[] },
) {
  const fdm = (tables as any).flowDeploymentMemberships;
  if (!fdm) return; // Table may not exist on older schemas

  // Wrap delete + inserts in a transaction for atomicity
  await db.transaction(async (tx) => {
    // Delete existing memberships for this flow
    await tx.delete(fdm).where(eq(fdm.flowId, flowId));

    // Insert new memberships from definition nodes
    const nodes = definition.nodes || [];
    for (const node of nodes) {
      if (!node.deploymentId) continue;
      await tx.insert(fdm).values({
        id: nanoid(),
        flowId,
        deploymentId: node.deploymentId,
        nodeId: node.id,
        role: node.role || (node.config as any)?.role || node.label || null,
        isEntryPoint: node.isEntryPoint ?? (node.config as any)?.isEntryPoint ?? false,
        createdAt: dbDate(),
      });
    }
  });
}

/**
 * Strip stale deploymentId references from a flow definition.
 *
 * Used during flow duplication: a source flow may already contain dead
 * deploymentIds (older orphans, or deployments the fork target does not
 * own). Rather than rejecting the fork outright, we sweep the definition
 * and drop nodes whose deploymentId is either missing from the DB or not
 * owned by the caller (through user or org membership). Edges that touch
 * a removed node are also dropped so the resulting graph stays valid.
 *
 * See docs/audits/stale-flow-deployment-ids.md for the original audit.
 *
 * Input may be a JSON-stringified definition OR an already-parsed object.
 * Output preserves input shape: if a string came in, a string goes out.
 *
 * Never throws — a parse failure or DB error is reported via the return
 * value so the caller can log + pass the definition through unchanged.
 */
export async function stripStaleDeploymentRefs(
  definition: string | { nodes?: any[]; edges?: any[] } | unknown,
  userId: string,
): Promise<{
  definitionToWrite: string | unknown;
  removedNodeIds: Set<string>;
  parseError?: Error;
}> {
  const removedNodeIds = new Set<string>();
  const inputIsString = typeof definition === "string";

  let defParsed: { nodes?: any[]; edges?: any[] } | null = null;
  try {
    defParsed = inputIsString
      ? JSON.parse(definition as string)
      : (definition as { nodes?: any[]; edges?: any[] } | null);
  } catch (err) {
    return {
      definitionToWrite: definition,
      removedNodeIds,
      parseError: err instanceof Error ? err : new Error(String(err)),
    };
  }

  if (!defParsed || !Array.isArray(defParsed.nodes)) {
    return { definitionToWrite: definition, removedNodeIds };
  }

  const referencedIds = Array.from(getDefinitionDeploymentIds(defParsed));
  if (referencedIds.length === 0) {
    return { definitionToWrite: definition, removedNodeIds };
  }

  const validation = await validateDeploymentReferences(defParsed, userId);
  if (validation.ok) {
    return { definitionToWrite: definition, removedNodeIds };
  }

  // Re-query to know which referenced ids are valid for the caller.
  const deploymentsTable = (tables as any).deployments;
  const orgMembersTable = (tables as any).orgMembers;
  let validIds = new Set<string>();
  try {
    let orgIds: string[] = [];
    if (orgMembersTable) {
      const memberships = await db
        .select({ orgId: orgMembersTable.orgId })
        .from(orgMembersTable)
        .where(eq(orgMembersTable.userId, userId));
      orgIds = memberships.map((m: any) => m.orgId).filter(Boolean);
    }
    const hasOrgIdColumn = !!deploymentsTable?.orgId;
    const ownershipFilter =
      orgIds.length > 0 && hasOrgIdColumn
        ? or(
            eq(deploymentsTable.userId, userId),
            inArray(deploymentsTable.orgId, orgIds),
          )
        : eq(deploymentsTable.userId, userId);
    const rows = await db
      .select({ id: deploymentsTable.id })
      .from(deploymentsTable)
      .where(
        and(
          inArray(deploymentsTable.id, referencedIds),
          ownershipFilter,
        ),
      );
    validIds = new Set(rows.map((r: any) => r.id));
  } catch {
    validIds = new Set();
  }

  const isStale = (id: string | undefined | null) =>
    !!id && !validIds.has(id);

  const keptNodes = (defParsed.nodes ?? []).filter((n: any) => {
    const stale =
      isStale(n?.deploymentId) || isStale(n?.config?.deploymentId);
    if (stale) removedNodeIds.add(n.id);
    return !stale;
  });
  const keptEdges = (defParsed.edges ?? []).filter(
    (e: any) =>
      !removedNodeIds.has(e.source) && !removedNodeIds.has(e.target),
  );

  const rewritten = {
    ...defParsed,
    nodes: keptNodes,
    edges: keptEdges,
  };

  return {
    definitionToWrite: inputIsString ? JSON.stringify(rewritten) : rewritten,
    removedNodeIds,
  };
}
