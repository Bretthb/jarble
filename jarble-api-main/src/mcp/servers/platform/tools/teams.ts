/**
 * Team / delegation platform tools.
 *
 * Exposes the "who is on my team, what do they do, can I hand them a
 * subtask" surface to every OpenClaw pod through the MCP proxy. All heavy
 * lifting is delegated to existing services (`flowDelegation`,
 * `deploymentCapabilities`, `configSync` shape).
 */

import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { tables } from "../../../../db/index.js";
import { registerTool } from "../register.js";
import {
  fetchDeploymentsForUser,
  getFlowWithMembers,
  jsonResult,
  requirePrimaryMembership,
} from "../_helpers.js";
import { NotFoundError, UpstreamError } from "../../../shared/errors.js";
import { executeDelegation, getMaxDelegationDepth } from "../../../../services/flowDelegation.js";
import { getDeploymentCapabilitiesBatch } from "../../../../services/deploymentCapabilities.js";

// ── list_teammates ──────────────────────────────────────────────────────────

registerTool({
  name: "list_teammates",
  description:
    "List the teammates (other deployments) on the same flow as the calling deployment. Returns each teammate's deployment ID, name, role, slug, runtime, and current status. Use this to discover who you can delegate to.",
  server: "platform",
  inputSchema: z.object({}),
  handler: async (_args, ctx) => {
    const primary = await requirePrimaryMembership(ctx);
    const flow = await getFlowWithMembers(ctx, primary.flowId);
    if (!flow) {
      throw new NotFoundError("Flow not found or not owned by caller");
    }

    const teammateIds = flow.memberships
      .filter((m) => m.deploymentId !== ctx.deploymentId)
      .map((m) => m.deploymentId);

    const deployments = await fetchDeploymentsForUser(ctx, teammateIds);
    const capsMap = await getDeploymentCapabilitiesBatch(teammateIds);

    const teammates = flow.memberships
      .filter((m) => m.deploymentId !== ctx.deploymentId)
      .flatMap((m) => {
        const dep = deployments.get(m.deploymentId);
        if (!dep) return [];
        const slugSource = m.role || dep.name;
        const slug = slugSource
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "");
        const caps = capsMap.get(m.deploymentId);
        return [
          {
            deploymentId: m.deploymentId,
            name: dep.name,
            runtime: dep.runtime,
            status: dep.status,
            nodeId: m.nodeId,
            role: m.role,
            slug,
            isEntry: m.isEntryPoint,
            capabilitiesSummary: caps?.llmSummary ?? null,
          },
        ];
      });

    return jsonResult({
      flowId: flow.flow.id,
      flowName: flow.flow.name,
      teammates,
    });
  },
});

// ── list_team_flows ─────────────────────────────────────────────────────────

registerTool({
  name: "list_team_flows",
  description:
    "List every flow (team) the calling deployment is a member of, including its role in each. Most deployments are on a single team but they can be shared across multiple.",
  server: "platform",
  inputSchema: z.object({}),
  handler: async (_args, ctx) => {
    const fdm = (tables as any).flowDeploymentMemberships;
    const orchestrationFlows = (tables as any).orchestrationFlows;
    if (!fdm || !orchestrationFlows) {
      return jsonResult({ flows: [] });
    }

    const rows = await ctx.db
      .select({
        flowId: fdm.flowId,
        nodeId: fdm.nodeId,
        role: fdm.role,
        isEntryPoint: fdm.isEntryPoint,
        flowName: orchestrationFlows.name,
        flowStatus: orchestrationFlows.status,
      })
      .from(fdm)
      .innerJoin(
        orchestrationFlows,
        and(
          eq(fdm.flowId, orchestrationFlows.id),
          eq(orchestrationFlows.userId, ctx.userId),
        ),
      )
      .where(eq(fdm.deploymentId, ctx.deploymentId));

    return jsonResult({
      flows: (rows as any[]).map((r) => ({
        flowId: r.flowId,
        flowName: r.flowName,
        status: r.flowStatus,
        nodeId: r.nodeId,
        role: r.role ?? null,
        isEntry: r.isEntryPoint ?? false,
      })),
    });
  },
});

// ── get_flow_context ────────────────────────────────────────────────────────

registerTool({
  name: "get_flow_context",
  description:
    "Return the team context for the calling deployment: the flow name, the deployment's own role and entry-point status, and the list of teammates. This mirrors the `teamContext` block written into soul.md by configSync.",
  server: "platform",
  inputSchema: z.object({}),
  handler: async (_args, ctx) => {
    const primary = await requirePrimaryMembership(ctx);
    const flow = await getFlowWithMembers(ctx, primary.flowId);
    if (!flow) {
      throw new NotFoundError("Flow not found or not owned by caller");
    }

    const teammateIds = flow.memberships
      .filter((m) => m.deploymentId !== ctx.deploymentId)
      .map((m) => m.deploymentId);
    const deployments = await fetchDeploymentsForUser(ctx, teammateIds);

    const teammates = flow.memberships
      .filter((m) => m.deploymentId !== ctx.deploymentId)
      .flatMap((m) => {
        const dep = deployments.get(m.deploymentId);
        if (!dep) return [];
        const slugSource = m.role || dep.name;
        const slug = slugSource
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_|_$/g, "");
        return [
          {
            deploymentId: m.deploymentId,
            name: dep.name,
            role: m.role,
            slug,
          },
        ];
      });

    return jsonResult({
      flowId: flow.flow.id,
      flowName: flow.flow.name,
      selfRole: primary.role,
      isEntryPoint: primary.isEntryPoint,
      teammates,
    });
  },
});

// ── delegate_to_teammate ────────────────────────────────────────────────────

registerTool({
  name: "delegate_to_teammate",
  description:
    "Delegate a task to a teammate deployment on the same flow. `to` accepts either the teammate's slug (e.g. `cto`) or their deployment ID. Returns the teammate's response text. Delegation depth is limited to prevent infinite recursion.",
  server: "platform",
  inputSchema: z.object({
    to: z.string().min(1),
    task: z.string().min(1),
    context: z.string().optional(),
    contextScope: z.enum(["task", "summary", "full"]).optional(),
  }),
  handler: async (args, ctx) => {
    const primary = await requirePrimaryMembership(ctx);
    const flow = await getFlowWithMembers(ctx, primary.flowId);
    if (!flow) {
      throw new NotFoundError("Flow not found or not owned by caller");
    }

    // Resolve `to` against (a) deployment IDs on this flow, (b) slugs
    // derived from role or name.
    const teammates = flow.memberships.filter((m) => m.deploymentId !== ctx.deploymentId);
    const deployments = await fetchDeploymentsForUser(
      ctx,
      teammates.map((m) => m.deploymentId),
    );

    const target = teammates.find((m) => {
      if (m.deploymentId === args.to) return true;
      const dep = deployments.get(m.deploymentId);
      if (!dep) return false;
      const slugSource = m.role || dep.name;
      const slug = slugSource
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_|_$/g, "");
      return slug === args.to.toLowerCase();
    });

    if (!target) {
      throw new NotFoundError(
        `Teammate "${args.to}" not found on flow "${flow.flow.name}". Use list_teammates to see valid slugs and deployment IDs.`,
      );
    }

    try {
      const result = await executeDelegation({
        targetDeploymentId: target.deploymentId,
        targetNodeId: target.nodeId,
        task: args.task,
        context: args.context,
        contextScope: args.contextScope ?? (args.context ? "summary" : "task"),
        sourceDeploymentId: ctx.deploymentId,
        userId: ctx.userId,
        flowId: flow.flow.id,
        toolName: `delegate_to_${args.to}`,
        ancestorDeploymentIds: [ctx.deploymentId],
        depth: 1,
      });

      return jsonResult({
        response: result.response,
        creditsUsed: result.creditsUsed,
        durationMs: result.durationMs,
        targetDeploymentId: result.targetDeploymentId,
        targetNodeId: result.targetNodeId,
        uiBlocks: result.uiBlocks ?? [],
        suggestions: result.suggestions ?? [],
        depth: result.depth ?? 1,
        maxDepth: getMaxDelegationDepth(),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new UpstreamError(`Delegation failed: ${message}`);
    }
  },
});
