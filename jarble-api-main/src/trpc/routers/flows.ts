/**
 * Orchestration Flows tRPC Router
 *
 * CRUD for orchestration flow definitions and their execution history.
 * Flows are visual DAGs (nodes + edges) that chain deployments, transforms,
 * conditions, and outputs into multi-step agent pipelines.
 */

import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { db, tables, dbDate } from "../../db/index.js";
import { eq, ne, desc, asc, and, or, sql, inArray, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createModuleLogger } from "../../utils/logger.js";
import { customAlphabet } from "nanoid";
import { collectLlmCompletion, type LlmMessage } from "../../services/llmProxy.js";
import { env } from "../../utils/env.js";
import { WORKFLOW_AGENT_SYSTEM_PROMPT } from "../../prompts/workflowAgent.js";
import { noHtmlTags, NO_HTML_MESSAGE } from "../../utils/sanitize.js";
import { syncConfigsToPvc } from "../../services/configSync.js";

const logger = createModuleLogger("flows");

const { orchestrationFlows, flowExecutions } = tables;

// ── Flow chat persistence helpers ────────────────────────────────────────
// flowChatSessions / flowChatMessages were introduced in migration
// 0007_lyrical_callisto.sql which has not yet been applied to all
// environments. We access them dynamically and gracefully degrade to
// empty results if either the table is missing from the schema bundle
// (legacy build) or the underlying SQL relation doesn't exist yet.

function getFlowChatTables(): {
  sessions: any | null;
  messages: any | null;
} {
  const t = tables as any;
  return {
    sessions: t.flowChatSessions ?? null,
    messages: t.flowChatMessages ?? null,
  };
}

/**
 * Detect Postgres "relation does not exist" / SQLite "no such table"
 * style errors so we can return an empty result instead of crashing the
 * whole procedure when the migration hasn't been applied yet.
 */
function isMissingTableError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === "string" && e.code === "42P01") return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return (
    msg.includes("does not exist") ||
    msg.includes("no such table") ||
    msg.includes("relation") && msg.includes("does not exist")
  );
}

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

// ── Helpers: flow_deployment_memberships join table ─────────────────────────
// The join table tells individual bot pods which Bot Team they belong to. It
// is read by configSync.buildDeploymentFields to populate
// `DeploymentFields.teamContext`, which the openclaw runtime handler renders
// into the bot's soul.md Team Context section.
//
// Production hypothesis (2026-04-07): the table was empty against 29 flows.
// The most likely cause is FK violations on stale `deploymentId` references
// (a flow node references a deployment that was deleted, never existed, or
// belongs to a different org). Strategy D (validator below) prevents NEW
// orphans. Strategy E (deployment.delete flow rewrite) clears EXISTING ones.
// The silent catch was upgraded to ERROR + offending node detail, and the
// trigger chain fires `syncConfigsToPvc` for both OLD and NEW affected
// deployments so even if memberships sync partially fails, the surviving
// bots get fresh soul.md.

/**
 * Read the current deploymentIds bound to a flow. Used to compute the OLD
 * side of the OLD ∪ NEW union for fan-out config sync.
 */
async function getCurrentMembershipDeploymentIds(flowId: string): Promise<Set<string>> {
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
function fanoutSyncConfigs(deploymentIds: Iterable<string>, reason: string) {
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

// ── Sync flow_deployment_memberships join table ─────────────────────────────
// Parses the flow definition to find nodes with deploymentId fields and
// writes them to the join table so individual bots can discover their teams.

async function syncFlowMemberships(
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
        role: node.role || node.label || null,
        isEntryPoint: node.isEntryPoint ?? (node.config as any)?.isEntryPoint ?? false,
        createdAt: dbDate(),
      });
    }
  });
}

const generateFlowId = () => `flw_${nanoid()}`;
const generateExecutionId = () => `fex_${nanoid()}`;

// ── Zod Schemas ──────────────────────────────────────────────────────────

const FlowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["deployment", "transform", "condition", "output", "waitForInput", "subflow"]),
  deploymentId: z.string().optional(),
  serviceId: z.string().optional(),
  skillName: z.string().optional(),
  label: z.string().min(1),
  // Bot team fields
  role: z.string().optional(),
  goal: z.string().optional(),
  canDelegate: z.boolean().optional(),
  contextScope: z.enum(["task", "summary", "full"]).optional(),
  modelOverride: z.string().optional(),
  isEntryPoint: z.boolean().optional(),
  config: z.record(z.unknown()).optional(),
  position: z.object({ x: z.number(), y: z.number() }),
  maxIterations: z.number().int().min(1).max(100).optional(),
});

const FlowEdgeSchema = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  type: z.enum(["delegates", "reports", "collaborates"]).optional(),
  contextScope: z.enum(["task", "summary", "full"]).optional(),
  label: z.string().optional(),
  condition: z.string().optional(),
  maxIterations: z.number().int().min(1).max(100).optional(),
});

const FlowDefinitionSchema = z.object({
  nodes: z.array(FlowNodeSchema),
  edges: z.array(FlowEdgeSchema),
});

// ── Router ───────────────────────────────────────────────────────────────

export const flowsRouter = router({
  /**
   * List the current user's orchestration flows, with optional status filter.
   */
  list: protectedProcedure
    .input(
      z.object({
        status: z.enum(["draft", "published", "archived"]).optional(),
        includeArchived: z.boolean().default(false),
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { status, includeArchived = false, limit = 50, offset = 0 } = input ?? {};

      const conditions = [eq(orchestrationFlows.userId, userId)];
      if (status) {
        conditions.push(eq(orchestrationFlows.status, status));
      } else if (!includeArchived) {
        conditions.push(ne(orchestrationFlows.status, "archived"));
      }

      const rows = await db
        .select()
        .from(orchestrationFlows)
        .where(and(...conditions))
        .orderBy(desc(orchestrationFlows.updatedAt))
        .limit(limit)
        .offset(offset);

      return rows;
    }),

  /**
   * Get a single flow by ID, including recent execution history.
   */
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const flow = await db
        .select()
        .from(orchestrationFlows)
        .where(
          and(
            eq(orchestrationFlows.id, input.id),
            eq(orchestrationFlows.userId, userId)
          )
        )
        .limit(1);

      if (flow.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flow not found",
        });
      }

      // Fetch recent executions
      const executions = await db
        .select()
        .from(flowExecutions)
        .where(eq(flowExecutions.flowId, input.id))
        .orderBy(desc(flowExecutions.createdAt))
        .limit(20);

      return { ...flow[0], executions };
    }),

  /**
   * Create a new orchestration flow.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255).refine(noHtmlTags, NO_HTML_MESSAGE),
        description: z.string().optional(),
        definition: FlowDefinitionSchema,
        status: z.enum(["draft", "published"]).default("draft"),
        entryNodeId: z.string().optional(),
        teamType: z.enum(["hierarchy", "pipeline", "collaborative"]).default("hierarchy"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Strategy D: reject orphan deploymentId references before insert.
      // See docs/audits/stale-flow-deployment-ids.md.
      const validation = await validateDeploymentReferences(
        input.definition,
        userId,
      );
      if (!validation.ok) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: validation.message,
        });
      }

      const id = generateFlowId();
      const now = dbDate();

      await db.insert(orchestrationFlows).values({
        id,
        userId,
        name: input.name,
        description: input.description ?? null,
        definition: JSON.stringify(input.definition),
        status: input.status,
        isPublic: false,
        forkCount: 0,
        forkedFromId: null,
        entryNodeId: input.entryNodeId ?? null,
        teamType: input.teamType,
        createdAt: now,
        updatedAt: now,
      });

      logger.info({ flowId: id, userId }, "Flow created");

      // Sync join table so individual bots can discover their team memberships.
      // On failure, log at ERROR (not WARN) and include the affected deploymentIds
      // so silent FK violations stop hiding from operators in production.
      try {
        await syncFlowMemberships(id, input.definition);
      } catch (err) {
        const newIds = [...getDefinitionDeploymentIds(input.definition)];
        logger.error(
          {
            flowId: id,
            deploymentIds: newIds,
            err: err instanceof Error ? err.message : String(err),
          },
          "flows.create: syncFlowMemberships failed — bots will not discover their team membership until the underlying error is fixed (likely an FK violation against deployments.id)"
        );
      }

      // Fire-and-forget configSync for every deployment newly attached to this
      // flow so each bot's soul.md immediately picks up the Team Context section.
      // Fresh creates have no OLD set — only NEW deploymentIds matter.
      const newDeploymentIds = getDefinitionDeploymentIds(input.definition);
      fanoutSyncConfigs(newDeploymentIds, `flow.create:${id}`);

      return { id };
    }),

  /**
   * Update an existing flow (name, description, definition, status).
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(255).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
        description: z.string().max(5000).nullable().optional(),
        definition: FlowDefinitionSchema.optional(),
        status: z.enum(["draft", "published", "archived"]).optional(),
        isPublic: z.boolean().optional(),
        entryNodeId: z.string().nullable().optional(),
        teamType: z.enum(["hierarchy", "pipeline", "collaborative"]).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify ownership
      const existing = await db
        .select({ id: orchestrationFlows.id })
        .from(orchestrationFlows)
        .where(
          and(
            eq(orchestrationFlows.id, input.id),
            eq(orchestrationFlows.userId, userId)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flow not found",
        });
      }

      // Strategy D: validate any new deploymentId references in the
      // definition before persisting. Only runs when definition is supplied
      // (update is partial).
      if (input.definition !== undefined) {
        const validation = await validateDeploymentReferences(
          input.definition,
          userId,
        );
        if (!validation.ok) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: validation.message,
          });
        }
      }

      const updates: Record<string, unknown> = { updatedAt: dbDate() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.definition !== undefined) updates.definition = JSON.stringify(input.definition);
      if (input.status !== undefined) updates.status = input.status;
      if (input.isPublic !== undefined) updates.isPublic = input.isPublic;
      if (input.entryNodeId !== undefined) updates.entryNodeId = input.entryNodeId;
      if (input.teamType !== undefined) updates.teamType = input.teamType;

      // Snapshot the OLD set of deployments BEFORE re-syncing memberships,
      // so removed teammates also get their soul.md re-rendered (their Team
      // Context block must come off when they leave the team).
      const oldDeploymentIds = input.definition
        ? await getCurrentMembershipDeploymentIds(input.id)
        : new Set<string>();

      await db
        .update(orchestrationFlows)
        .set(updates)
        .where(eq(orchestrationFlows.id, input.id));

      logger.info({ flowId: input.id, userId }, "Flow updated");

      // Re-sync join table if the definition was updated
      if (input.definition) {
        try {
          await syncFlowMemberships(input.id, input.definition);
        } catch (err) {
          const newIds = [...getDefinitionDeploymentIds(input.definition)];
          logger.error(
            {
              flowId: input.id,
              deploymentIds: newIds,
              err: err instanceof Error ? err.message : String(err),
            },
            "flows.update: syncFlowMemberships failed — bots will not discover their team membership until the underlying error is fixed (likely an FK violation against deployments.id)"
          );
        }

        // Fire-and-forget configSync for the union of OLD ∪ NEW deployments
        // so leaving bots lose the Team Context block AND joining bots gain it.
        const newDeploymentIds = getDefinitionDeploymentIds(input.definition);
        const union = new Set<string>([...oldDeploymentIds, ...newDeploymentIds]);
        fanoutSyncConfigs(union, `flow.update:${input.id}`);
      }

      return { success: true };
    }),

  /**
   * Delete a flow. If `hard` is true, permanently removes it; otherwise archives.
   */
  delete: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        hard: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify ownership
      const existing = await db
        .select({ id: orchestrationFlows.id })
        .from(orchestrationFlows)
        .where(
          and(
            eq(orchestrationFlows.id, input.id),
            eq(orchestrationFlows.userId, userId)
          )
        )
        .limit(1);

      if (existing.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flow not found",
        });
      }

      // Snapshot which deployments belonged to this flow BEFORE delete/archive,
      // so each former teammate's soul.md gets the Team Context block removed.
      // For hard deletes, FK cascade will wipe the join table and a later
      // configSync would see no memberships and skip the Team Context block.
      // For soft deletes (archive), we don't strip memberships, so the bots
      // would still see a stale "you're on Team X" block — the explicit
      // fan-out below clears that case too.
      const formerDeploymentIds = await getCurrentMembershipDeploymentIds(input.id);

      if (input.hard) {
        // Hard delete - cascade deletes executions + memberships via FK
        await db
          .delete(orchestrationFlows)
          .where(eq(orchestrationFlows.id, input.id));
        logger.info({ flowId: input.id, userId }, "Flow hard-deleted");
      } else {
        // Soft delete - archive. Also strip memberships so the deployments
        // stop reporting themselves as part of an archived team. Without
        // this, configSync would still surface the archived team in soul.md
        // until the user takes another action.
        const fdm = (tables as any).flowDeploymentMemberships;
        if (fdm) {
          try {
            await db.delete(fdm).where(eq(fdm.flowId, input.id));
          } catch (err) {
            logger.error(
              { flowId: input.id, err: err instanceof Error ? err.message : String(err) },
              "flows.delete: failed to clear memberships during archive (non-fatal — affected bots will keep stale Team Context until manually re-synced)"
            );
          }
        }
        await db
          .update(orchestrationFlows)
          .set({ status: "archived", updatedAt: dbDate() })
          .where(eq(orchestrationFlows.id, input.id));
        logger.info({ flowId: input.id, userId }, "Flow archived");
      }

      // Fire-and-forget configSync so each former teammate immediately drops
      // the Team Context section from their soul.md.
      fanoutSyncConfigs(formerDeploymentIds, `flow.delete:${input.id}`);

      return { success: true };
    }),

  /**
   * Duplicate / fork a flow. Copies the definition and sets forkedFromId.
   * Increments the source flow's forkCount.
   */
  duplicate: protectedProcedure
    .input(
      z.object({
        sourceFlowId: z.string(),
        name: z.string().min(1).max(255).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Fetch the source flow - user must own it OR it must be public
      const source = await db
        .select()
        .from(orchestrationFlows)
        .where(eq(orchestrationFlows.id, input.sourceFlowId))
        .limit(1);

      if (source.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source flow not found",
        });
      }

      const sourceFlow = source[0];

      // Must be owner or flow must be public
      if (sourceFlow.userId !== userId && !sourceFlow.isPublic) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Cannot fork a private flow you do not own",
        });
      }

      const newId = generateFlowId();
      const now = dbDate();

      // Strategy D: strip stale deploymentId references during duplication.
      // Source flow may already contain dead references (older orphans). We
      // strip them so the new flow is clean rather than rejecting the
      // duplicate outright — see docs/audits/stale-flow-deployment-ids.md.
      let definitionToWrite: string | unknown = sourceFlow.definition;
      try {
        const defParsed: { nodes?: any[]; edges?: any[] } | null =
          typeof sourceFlow.definition === "string"
            ? JSON.parse(sourceFlow.definition)
            : (sourceFlow.definition as any);

        if (defParsed && Array.isArray(defParsed.nodes)) {
          const referencedIds = Array.from(
            getDefinitionDeploymentIds(defParsed),
          );
          if (referencedIds.length > 0) {
            const validation = await validateDeploymentReferences(
              defParsed,
              userId,
            );
            if (!validation.ok) {
              // Compute the set of stale ids and rewrite the definition.
              // We re-query to know which ids are valid for the caller.
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
                  orgIds = memberships
                    .map((m: any) => m.orgId)
                    .filter(Boolean);
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

              const removedNodeIds = new Set<string>();
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
              definitionToWrite = JSON.stringify(rewritten);

              logger.warn(
                {
                  sourceFlowId: input.sourceFlowId,
                  newFlowId: newId,
                  userId,
                  staleNodeCount: removedNodeIds.size,
                  staleNodeIds: Array.from(removedNodeIds),
                },
                "duplicate: stripped stale deployment references during fork",
              );
            }
          }
        }
      } catch (err) {
        // If parsing fails entirely we copy the source as-is and leave the
        // sync step to handle/log the error.
        logger.warn(
          {
            sourceFlowId: input.sourceFlowId,
            err: err instanceof Error ? err.message : String(err),
          },
          "duplicate: could not parse source definition for stale-ref sweep",
        );
      }

      await db.insert(orchestrationFlows).values({
        id: newId,
        userId,
        name: input.name ?? `${sourceFlow.name} (copy)`,
        description: sourceFlow.description,
        definition: definitionToWrite as any,
        status: "draft",
        isPublic: false,
        forkCount: 0,
        forkedFromId: input.sourceFlowId,
        entryNodeId: sourceFlow.entryNodeId,
        teamType: sourceFlow.teamType,
        createdAt: now,
        updatedAt: now,
      });

      // Increment source fork count
      await db
        .update(orchestrationFlows)
        .set({ forkCount: sql`${orchestrationFlows.forkCount} + 1` })
        .where(eq(orchestrationFlows.id, input.sourceFlowId));

      logger.info({ newFlowId: newId, sourceFlowId: input.sourceFlowId, userId }, "Flow forked");

      // Sync join table for the duplicated flow + fan-out configSync for the
      // newly bound deployments. The source flow is untouched (no OLD set to
      // worry about — only the new fork's bots need fresh soul.md).
      let parsedDefinition: { nodes?: any[]; edges?: any[] } | null = null;
      try {
        // Parse the STRIPPED definition (definitionToWrite) — Wave 2B's
        // duplicate mutation strips stale deployment refs before insert,
        // so this is what was actually stored in the new flow row.
        parsedDefinition = typeof definitionToWrite === "string"
          ? JSON.parse(definitionToWrite)
          : (definitionToWrite as { nodes?: any[]; edges?: any[] });
        if (parsedDefinition && parsedDefinition.nodes) {
          await syncFlowMemberships(newId, parsedDefinition as { nodes: any[]; edges?: any[] });
        }
      } catch (err) {
        const newIds = parsedDefinition ? [...getDefinitionDeploymentIds(parsedDefinition)] : [];
        logger.error(
          {
            flowId: newId,
            sourceFlowId: input.sourceFlowId,
            deploymentIds: newIds,
            err: err instanceof Error ? err.message : String(err),
          },
          "flows.duplicate: syncFlowMemberships failed for fork — bots will not discover their team membership until the underlying error is fixed"
        );
      }

      if (parsedDefinition) {
        fanoutSyncConfigs(getDefinitionDeploymentIds(parsedDefinition), `flow.duplicate:${newId}`);
      }

      return { id: newId };
    }),

  /**
   * List executions for a given flow (paginated).
   */
  listExecutions: protectedProcedure
    .input(
      z.object({
        flowId: z.string(),
        limit: z.number().int().min(1).max(100).default(20),
        offset: z.number().int().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Verify flow ownership
      const flow = await db
        .select({ id: orchestrationFlows.id })
        .from(orchestrationFlows)
        .where(
          and(
            eq(orchestrationFlows.id, input.flowId),
            eq(orchestrationFlows.userId, userId)
          )
        )
        .limit(1);

      if (flow.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Flow not found",
        });
      }

      const executions = await db
        .select()
        .from(flowExecutions)
        .where(eq(flowExecutions.flowId, input.flowId))
        .orderBy(desc(flowExecutions.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      return executions;
    }),

  /**
   * Generate a flow definition from natural language using the Workflow Agent LLM.
   * Returns an unsaved FlowDefinition that the user can review and then save via `create`.
   */
  generateFromPrompt: protectedProcedure
    .input(
      z.object({
        prompt: z.string().min(1).max(2000),
        availableDeployments: z
          .array(
            z.object({
              id: z.string(),
              name: z.string(),
              skills: z.array(z.string()).optional(),
            })
          )
          .optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const provider = (env.AGENT_LLM_PROVIDER ?? "openrouter") as
        | "anthropic"
        | "openai"
        | "openrouter"
        | "google";
      const apiKey = env.AGENT_LLM_API_KEY ?? env.OPENROUTER_API_KEY;
      const model = env.AGENT_LLM_MODEL ?? "anthropic/claude-sonnet-4-20250514";

      if (!apiKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Flow generation requires an LLM API key to be configured. Set AGENT_LLM_API_KEY or OPENROUTER_API_KEY.",
        });
      }

      // Build user message with context about available deployments
      let userMessage = `Goal: ${input.prompt}`;

      if (input.availableDeployments && input.availableDeployments.length > 0) {
        userMessage += "\n\nAvailable services/deployments:\n";
        for (const dep of input.availableDeployments) {
          userMessage += `- ${dep.name} (id: ${dep.id})`;
          if (dep.skills && dep.skills.length > 0) {
            userMessage += ` - skills: ${dep.skills.join(", ")}`;
          }
          userMessage += "\n";
        }
      }

      userMessage +=
        "\n\nReturn ONLY valid JSON matching the output format. Do not include markdown fences.";

      const messages: LlmMessage[] = [
        { role: "system", content: WORKFLOW_AGENT_SYSTEM_PROMPT },
        { role: "user", content: userMessage },
      ];

      logger.info(
        { userId: ctx.user.id, promptLength: input.prompt.length, model },
        "generateFromPrompt: calling LLM"
      );

      try {
        const result = await collectLlmCompletion({
          provider,
          apiKey,
          model,
          messages,
        });

        // Parse the JSON response - strip markdown fences if present
        let jsonText = result.text.trim();
        if (jsonText.startsWith("```")) {
          jsonText = jsonText.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
        }

        let parsed: {
          plan: Array<{
            step: number;
            action: string;
            service?: string;
            skill?: string;
            component?: string;
            args?: Record<string, unknown>;
            props?: Record<string, unknown>;
            description: string;
            dependsOn?: number[];
            outputKey?: string;
          }>;
          summary?: string;
          estimatedSteps?: number;
          parallelizable?: number[][];
        };

        try {
          parsed = JSON.parse(jsonText);
        } catch {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "LLM returned invalid JSON. Please try rephrasing your prompt.",
          });
        }

        if (!parsed.plan || !Array.isArray(parsed.plan)) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "LLM response missing 'plan' array. Please try again.",
          });
        }

        // Convert the plan steps into FlowDefinition nodes + edges
        const NODE_SPACING_X = 280;
        const NODE_SPACING_Y = 0;
        const NODES_PER_ROW = 5;

        const nodes = parsed.plan.map((step, i) => {
          const col = i % NODES_PER_ROW;
          const row = Math.floor(i / NODES_PER_ROW);

          // Map action types to flow node types
          let type: "deployment" | "transform" | "condition" | "output" = "deployment";
          if (step.action === "render_ui" || step.action === "output") type = "output";
          else if (step.action === "transform" || step.action === "filter") type = "transform";
          else if (step.action === "condition" || step.action === "branch") type = "condition";

          // Find the deployment ID if the step references a known service
          let deploymentId: string | undefined;
          if (step.service && input.availableDeployments) {
            const match = input.availableDeployments.find(
              (d) =>
                d.name.toLowerCase() === step.service!.toLowerCase() ||
                d.id === step.service
            );
            if (match) deploymentId = match.id;
          }

          return {
            id: `n${step.step}`,
            type,
            label: step.description || `Step ${step.step}`,
            position: {
              x: col * NODE_SPACING_X,
              y: row * (NODE_SPACING_Y + 150),
            },
            deploymentId,
            skillName: step.skill,
            config: step.args || step.props || undefined,
          };
        });

        // Build edges from dependsOn relationships
        const edges: Array<{
          id: string;
          source: string;
          target: string;
          label?: string;
        }> = [];

        let edgeIdx = 0;
        for (const step of parsed.plan) {
          if (step.dependsOn && step.dependsOn.length > 0) {
            for (const dep of step.dependsOn) {
              edges.push({
                id: `e${edgeIdx++}`,
                source: `n${dep}`,
                target: `n${step.step}`,
              });
            }
          } else if (step.step > 1) {
            // If no explicit dependsOn, chain sequentially from previous step
            edges.push({
              id: `e${edgeIdx++}`,
              source: `n${step.step - 1}`,
              target: `n${step.step}`,
            });
          }
        }

        const definition = { nodes, edges };

        logger.info(
          {
            userId: ctx.user.id,
            nodeCount: nodes.length,
            edgeCount: edges.length,
          },
          "generateFromPrompt: flow generated"
        );

        return {
          definition,
          summary: parsed.summary ?? null,
          estimatedSteps: parsed.estimatedSteps ?? nodes.length,
          parallelizable: parsed.parallelizable ?? null,
        };
      } catch (err) {
        if (err instanceof TRPCError) throw err;
        const message = err instanceof Error ? err.message : String(err);
        logger.error(
          { userId: ctx.user.id, err: message },
          "generateFromPrompt: LLM call failed"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Flow generation failed: ${message}`,
        });
      }
    }),

  /**
   * List the persisted bot-team chat sessions for a flow owned by the
   * caller. Each session corresponds to a single conversation thread; the
   * write path is in `routes/flowChat.ts`.
   *
   * Gracefully returns an empty array if migration 0007_lyrical_callisto
   * has not yet been applied (the underlying tables don't exist).
   */
  getChatSessions: protectedProcedure
    .input(z.object({ flowId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // 1. Verify flow ownership — same pattern as getById / listExecutions.
      const flow = await db
        .select({ id: orchestrationFlows.id })
        .from(orchestrationFlows)
        .where(
          and(
            eq(orchestrationFlows.id, input.flowId),
            eq(orchestrationFlows.userId, userId)
          )
        )
        .limit(1);

      if (flow.length === 0) {
        // Don't reveal whether the flow exists for another user — return
        // an empty list rather than 404. This matches the "no sessions"
        // case from the caller's perspective and avoids leaking ownership.
        logger.warn(
          { flowId: input.flowId, userId },
          "getChatSessions: flow not owned by caller"
        );
        return [] as Array<{
          id: string;
          flowId: string;
          title: string | null;
          createdAt: Date | string | null;
          updatedAt: Date | string | null;
          messageCount: number;
        }>;
      }

      const { sessions: flowChatSessions, messages: flowChatMessages } =
        getFlowChatTables();
      if (!flowChatSessions) {
        logger.warn(
          { flowId: input.flowId },
          "getChatSessions: flowChatSessions table not registered in schema bundle — returning []"
        );
        return [];
      }

      try {
        // `messageCount` is computed via a correlated subquery so the
        // query stays a single round-trip and the picker UI can render
        // "Title · N msgs" without a second fetch per session. If the
        // messages table is missing from the schema bundle we fall back
        // to 0 — the picker just hides the badge when count is 0.
        const messageCountExpr = flowChatMessages
          ? sql<number>`(select count(*) from ${flowChatMessages} where ${flowChatMessages.sessionId} = ${flowChatSessions.id})`
          : sql<number>`0`;

        const rows = await db
          .select({
            id: flowChatSessions.id,
            flowId: flowChatSessions.flowId,
            title: flowChatSessions.title,
            createdAt: flowChatSessions.createdAt,
            updatedAt: flowChatSessions.updatedAt,
            messageCount: messageCountExpr,
          })
          .from(flowChatSessions)
          .where(
            and(
              eq(flowChatSessions.flowId, input.flowId),
              eq(flowChatSessions.userId, userId)
            )
          )
          .orderBy(desc(flowChatSessions.updatedAt))
          .limit(50);

        // Coerce messageCount to a JS number — some drivers return
        // bigint / string for count(*) depending on dialect.
        return rows.map((r) => ({
          ...r,
          messageCount: Number(r.messageCount ?? 0),
        }));
      } catch (err) {
        if (isMissingTableError(err)) {
          logger.warn(
            { flowId: input.flowId, err: err instanceof Error ? err.message : String(err) },
            "getChatSessions: underlying table missing (migration 0007 not applied?) — returning []"
          );
          return [];
        }
        // Any other DB hiccup: log and degrade rather than crashing the
        // whole chat panel — chat history is non-critical.
        logger.error(
          { flowId: input.flowId, err: err instanceof Error ? err.message : String(err) },
          "getChatSessions: unexpected DB error — returning []"
        );
        return [];
      }
    }),

  /**
   * List persisted chat messages for a single session.
   *
   * Ownership is enforced via an INNER JOIN against `flow_chat_sessions`
   * filtered by `userId`. This means a malicious caller cannot read
   * messages even if they guess a sessionId — the join will return zero
   * rows when the session doesn't belong to them.
   *
   * Gracefully returns an empty array if migration 0007 hasn't been
   * applied yet.
   */
  getChatMessages: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        limit: z.number().int().min(1).max(500).default(200),
        // Cursor for "load older" pagination. When provided, returns the
        // `limit` messages immediately preceding (older than) the message
        // with this id. The cursor message itself is NOT included in the
        // result. Ownership of the cursor is enforced via the same JOIN
        // posture as the data query — a forged id from another user
        // simply yields []. The result is always ordered ASC regardless
        // of pagination direction so the client can prepend it directly.
        beforeId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const { sessions: flowChatSessions, messages: flowChatMessages } =
        getFlowChatTables();
      if (!flowChatSessions || !flowChatMessages) {
        logger.warn(
          { sessionId: input.sessionId },
          "getChatMessages: flow chat tables not registered in schema bundle — returning []"
        );
        return [];
      }

      try {
        // ── Pagination cursor resolution ─────────────────────────────
        // When `beforeId` is set, look up its createdAt timestamp inside
        // the same INNER JOIN-ownership envelope so that:
        //   1. A forged cursor from another user yields [] (no leak)
        //   2. A cursor for a different session yields [] (no leak)
        //   3. A non-existent cursor yields [] (no crash)
        // We resolve to a `createdAt` value rather than relying on row id
        // ordering so that messages inserted out-of-order (e.g. delegated
        // bot replies that arrive late) still paginate consistently.
        let cursorCreatedAt: Date | string | number | null = null;
        if (input.beforeId) {
          const cursorRows = await db
            .select({ createdAt: flowChatMessages.createdAt })
            .from(flowChatMessages)
            .innerJoin(
              flowChatSessions,
              eq(flowChatMessages.sessionId, flowChatSessions.id)
            )
            .where(
              and(
                eq(flowChatMessages.id, input.beforeId),
                eq(flowChatMessages.sessionId, input.sessionId),
                eq(flowChatSessions.userId, userId)
              )
            )
            .limit(1);

          if (cursorRows.length === 0) {
            // Cursor not found (forged, deleted, or wrong session) —
            // return empty rather than 404 so the client just shows
            // "no older messages" without breaking the panel.
            return [];
          }
          cursorCreatedAt = cursorRows[0].createdAt as
            | Date
            | string
            | number
            | null;
        }

        // INNER JOIN enforces ownership — if the session belongs to a
        // different user, the join produces zero rows and we return [].
        // When paginating with a cursor we order DESC + slice + reverse
        // so the result is always ASC for the client.
        const baseConditions = [
          eq(flowChatMessages.sessionId, input.sessionId),
          eq(flowChatSessions.userId, userId),
        ];
        if (cursorCreatedAt !== null) {
          baseConditions.push(
            lt(flowChatMessages.createdAt, cursorCreatedAt as any)
          );
        }

        const rows = await db
          .select({
            id: flowChatMessages.id,
            sessionId: flowChatMessages.sessionId,
            role: flowChatMessages.role,
            content: flowChatMessages.content,
            sourceNodeId: flowChatMessages.sourceNodeId,
            sourceDeploymentId: flowChatMessages.sourceDeploymentId,
            delegationToolName: flowChatMessages.delegationToolName,
            createdAt: flowChatMessages.createdAt,
          })
          .from(flowChatMessages)
          .innerJoin(
            flowChatSessions,
            eq(flowChatMessages.sessionId, flowChatSessions.id)
          )
          .where(and(...baseConditions))
          .orderBy(
            cursorCreatedAt !== null
              ? desc(flowChatMessages.createdAt)
              : asc(flowChatMessages.createdAt)
          )
          .limit(input.limit);

        // Cursor branch: we slurped DESC (newest of the older window
        // first) — reverse to restore the ASC contract.
        if (cursorCreatedAt !== null) {
          return rows.slice().reverse();
        }
        return rows;
      } catch (err) {
        if (isMissingTableError(err)) {
          logger.warn(
            { sessionId: input.sessionId, err: err instanceof Error ? err.message : String(err) },
            "getChatMessages: underlying table missing (migration 0007 not applied?) — returning []"
          );
          return [];
        }
        logger.error(
          { sessionId: input.sessionId, err: err instanceof Error ? err.message : String(err) },
          "getChatMessages: unexpected DB error — returning []"
        );
        return [];
      }
    }),

  /**
   * Rename a single chat session. Ownership is enforced in the UPDATE
   * WHERE clause so a forged sessionId from another user silently
   * updates zero rows and returns `{ success: false }` without leaking
   * whether the session exists. Titles are sanitized against stray
   * HTML via the same `noHtmlTags` helper the rest of the router uses.
   *
   * Gracefully no-ops if migration 0007 hasn't been applied yet.
   */
  renameChatSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        title: z
          .string()
          .min(1)
          .max(255)
          .refine(noHtmlTags, NO_HTML_MESSAGE),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const { sessions: flowChatSessions } = getFlowChatTables();
      if (!flowChatSessions) {
        logger.warn(
          { sessionId: input.sessionId },
          "renameChatSession: flowChatSessions table not registered in schema bundle — no-op"
        );
        return { success: false };
      }

      try {
        // UPDATE ... WHERE id AND user_id — a non-owner's forged id
        // matches zero rows and the update is a no-op. We don't 404
        // because we don't want to leak whether the session exists.
        await db
          .update(flowChatSessions)
          .set({ title: input.title, updatedAt: dbDate() })
          .where(
            and(
              eq(flowChatSessions.id, input.sessionId),
              eq(flowChatSessions.userId, userId)
            )
          );

        return { success: true };
      } catch (err) {
        if (isMissingTableError(err)) {
          logger.warn(
            {
              sessionId: input.sessionId,
              err: err instanceof Error ? err.message : String(err),
            },
            "renameChatSession: underlying table missing — no-op"
          );
          return { success: false };
        }
        logger.error(
          {
            sessionId: input.sessionId,
            err: err instanceof Error ? err.message : String(err),
          },
          "renameChatSession: unexpected DB error"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to rename chat session",
        });
      }
    }),

  /**
   * Delete a chat session and its messages. Ownership is verified via
   * a SELECT inside the same transaction as the DELETE so a forged
   * sessionId from another user silently no-ops without leaking
   * whether the target row exists. Messages are deleted BEFORE the
   * session row because `flow_chat_messages.session_id` does not have
   * an ON DELETE CASCADE constraint (see schema.pg.ts:345) — deleting
   * the session first would orphan its messages.
   *
   * Gracefully no-ops if migration 0007 hasn't been applied yet.
   */
  deleteChatSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const { sessions: flowChatSessions, messages: flowChatMessages } =
        getFlowChatTables();
      if (!flowChatSessions || !flowChatMessages) {
        logger.warn(
          { sessionId: input.sessionId },
          "deleteChatSession: flow chat tables not registered in schema bundle — no-op"
        );
        return { success: false, messagesDeleted: 0 };
      }

      try {
        // Use a transaction so either both deletes succeed or neither
        // does — we don't want to leave orphan messages around if the
        // session delete fails mid-flight.
        let messagesDeleted = 0;
        const result = await db.transaction(async (tx) => {
          // 1. Verify ownership inside the transaction. A forged id
          //    from another user yields zero rows and we bail without
          //    doing any writes.
          const ownedRows = await tx
            .select({ id: flowChatSessions.id })
            .from(flowChatSessions)
            .where(
              and(
                eq(flowChatSessions.id, input.sessionId),
                eq(flowChatSessions.userId, userId)
              )
            )
            .limit(1);

          if (ownedRows.length === 0) {
            return { success: false, messagesDeleted: 0 };
          }

          // 2. Count + delete messages. We issue a count(*) before the
          //    delete so the caller gets a concrete messagesDeleted
          //    number — drizzle-orm doesn't expose rowCount uniformly
          //    across dialects.
          const countRows = await tx
            .select({ c: sql<number>`count(*)` })
            .from(flowChatMessages)
            .where(eq(flowChatMessages.sessionId, input.sessionId));
          messagesDeleted = Number(countRows[0]?.c ?? 0);

          await tx
            .delete(flowChatMessages)
            .where(eq(flowChatMessages.sessionId, input.sessionId));

          // 3. Delete the session itself (ownership already verified
          //    above, but we re-filter on user_id as defense-in-depth).
          await tx
            .delete(flowChatSessions)
            .where(
              and(
                eq(flowChatSessions.id, input.sessionId),
                eq(flowChatSessions.userId, userId)
              )
            );

          return { success: true, messagesDeleted };
        });

        return result;
      } catch (err) {
        if (isMissingTableError(err)) {
          logger.warn(
            {
              sessionId: input.sessionId,
              err: err instanceof Error ? err.message : String(err),
            },
            "deleteChatSession: underlying table missing — no-op"
          );
          return { success: false, messagesDeleted: 0 };
        }
        logger.error(
          {
            sessionId: input.sessionId,
            err: err instanceof Error ? err.message : String(err),
          },
          "deleteChatSession: unexpected DB error"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete chat session",
        });
      }
    }),
});

// Export internal helpers for testability. These are intentionally
// excluded from the tRPC router surface.
export const __testables = {
  getFlowChatTables,
  isMissingTableError,
};
