/**
 * Helpers for platform-server tools.
 *
 * Keeps shared logic (primary flow resolution, result wrapping) out of
 * individual tool files.
 */

import { eq, and, inArray } from "drizzle-orm";
import { tables } from "../../../db/index.js";
import type { McpResult, ToolContext } from "../../shared/types.js";
import { NotFoundError } from "../../shared/errors.js";

/**
 * Resolve the flow membership this deployment should act in.
 *
 * Prefers the deployment's `activeFlowId` if it matches a membership;
 * otherwise returns the first membership by insertion order. Returns
 * `null` if the deployment is not on any team. Mirrors the precedence
 * used by `configSync.buildDeploymentFields`.
 */
export async function resolvePrimaryMembership(ctx: ToolContext): Promise<
  | {
      flowId: string;
      nodeId: string;
      role: string | null;
      isEntryPoint: boolean;
    }
  | null
> {
  const fdm = (tables as any).flowDeploymentMemberships;
  if (!fdm) return null;

  const memberships = await ctx.db.query.flowDeploymentMemberships?.findMany?.({
    where: eq(fdm.deploymentId, ctx.deploymentId),
  });
  if (!memberships?.length) return null;

  const activeFlowId = (ctx.deployment as any).activeFlowId as
    | string
    | null
    | undefined;
  const primary =
    (activeFlowId ? memberships.find((m: any) => m.flowId === activeFlowId) : null) ||
    memberships[0];

  return {
    flowId: primary.flowId,
    nodeId: primary.nodeId,
    role: primary.role ?? null,
    isEntryPoint: primary.isEntryPoint ?? false,
  };
}

/**
 * Fetch full membership rows for a flow, with ownership verification.
 * Returns null if the flow is not owned by the caller.
 */
export async function getFlowWithMembers(
  ctx: ToolContext,
  flowId: string,
): Promise<
  | {
      flow: { id: string; name: string; status: string; entryNodeId: string | null };
      memberships: Array<{ deploymentId: string; nodeId: string; role: string | null; isEntryPoint: boolean }>;
    }
  | null
> {
  const flows = (tables as any).orchestrationFlows;
  const fdm = (tables as any).flowDeploymentMemberships;
  if (!flows || !fdm) return null;

  const flow = await ctx.db.query.orchestrationFlows?.findFirst?.({
    where: and(eq(flows.id, flowId), eq(flows.userId, ctx.userId)),
    columns: { id: true, name: true, status: true, entryNodeId: true },
  });
  if (!flow) return null;

  const memberships = await ctx.db.query.flowDeploymentMemberships?.findMany?.({
    where: eq(fdm.flowId, flowId),
  });

  return {
    flow: {
      id: flow.id,
      name: flow.name,
      status: flow.status,
      entryNodeId: flow.entryNodeId ?? null,
    },
    memberships: (memberships ?? []).map((m: any) => ({
      deploymentId: m.deploymentId,
      nodeId: m.nodeId,
      role: m.role ?? null,
      isEntryPoint: m.isEntryPoint ?? false,
    })),
  };
}

/**
 * Batch-fetch deployment rows (id, name, runtime, status) scoped to the caller.
 * Non-owned deployment IDs are silently dropped.
 */
export async function fetchDeploymentsForUser(
  ctx: ToolContext,
  deploymentIds: string[],
): Promise<Map<string, { id: string; name: string; runtime: string; status: string }>> {
  const result = new Map<string, { id: string; name: string; runtime: string; status: string }>();
  if (deploymentIds.length === 0) return result;

  const rows = await ctx.db
    .select({
      id: tables.deployments.id,
      name: tables.deployments.name,
      runtime: tables.deployments.runtime,
      status: tables.deployments.status,
    })
    .from(tables.deployments)
    .where(
      and(
        inArray(tables.deployments.id, deploymentIds),
        eq(tables.deployments.userId, ctx.userId),
      ),
    );

  for (const r of rows as Array<{ id: string; name: string; runtime: string; status: string }>) {
    result.set(r.id, r);
  }
  return result;
}

/** Wrap a JSON-serializable result object into the standard MCP text response. */
export function jsonResult(data: unknown): McpResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    structuredContent: (data && typeof data === "object" && !Array.isArray(data)
      ? (data as Record<string, unknown>)
      : { result: data }) as Record<string, unknown>,
  };
}

/** Throws if the deployment is not part of any flow. */
export async function requirePrimaryMembership(ctx: ToolContext) {
  const m = await resolvePrimaryMembership(ctx);
  if (!m) {
    throw new NotFoundError(
      "This deployment is not a member of any team flow. Add it to a flow in the canvas first.",
    );
  }
  return m;
}
