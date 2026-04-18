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
import {
  getCurrentMembershipDeploymentIds,
  getDefinitionDeploymentIds,
  fanoutSyncConfigs,
  syncFlowMemberships,
  validateDeploymentReferences,
  stripStaleDeploymentRefs,
} from "../../services/flowMemberships.js";
import {
  flowsChatProcedures,
  getFlowChatTables,
  isMissingTableError,
} from "./flows/chat.js";

// Re-exports for tests that import these helpers from flows.ts
export { getDefinitionDeploymentIds, validateDeploymentReferences } from "../../services/flowMemberships.js";
export { getFlowChatTables, isMissingTableError } from "./flows/chat.js";

const logger = createModuleLogger("flows");

const { orchestrationFlows, flowExecutions } = tables;

// Flow chat persistence helpers (getFlowChatTables, isMissingTableError)
// and the 4 chat procedures (getChatSessions, getChatMessages,
// renameChatSession, deleteChatSession) have been extracted to
// src/trpc/routers/flows/chat.ts — see imports at top of this file.

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

// Flow membership helpers (getCurrentMembershipDeploymentIds, getDefinitionDeploymentIds,
// fanoutSyncConfigs, syncFlowMemberships, validateDeploymentReferences) have been
// extracted to src/services/flowMemberships.ts — see the import at the top of this file.

const generateFlowId = () => `flw_${nanoid()}`;
const generateExecutionId = () => `fex_${nanoid()}`;

// ── Zod Schemas ──────────────────────────────────────────────────────────

const FlowNodeSchema = z.object({
  id: z.string().min(1),
  type: z.enum(["deployment", "transform", "condition", "output", "waitForInput", "subflow"]),
  deploymentId: z.string().optional(),
  serviceId: z.string().optional(),
  skillName: z.string().optional(),
  label: z.string().min(1).max(255).refine(noHtmlTags, NO_HTML_MESSAGE),
  // Bot team fields — text shown in the canvas UI and rendered into
  // bot system prompts. All user-visible text is HTML-rejected.
  role: z.string().max(500).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
  goal: z.string().max(2000).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
  canDelegate: z.boolean().optional(),
  contextScope: z.enum(["task", "summary", "full"]).optional(),
  modelOverride: z.string().max(200).optional(),
  isEntryPoint: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
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
  label: z.string().max(255).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
  // Condition expressions are JS-like comparisons like "stepN.result > 10".
  // Reject HTML tags to prevent stored XSS through this field.
  condition: z.string().max(1000).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
  maxIterations: z.number().int().min(1).max(100).optional(),
});

// MAX_FLOW_NODES matches the runtime enforcement in flowExecution.ts.
// Kept here at the Zod layer so invalid flows are rejected at create/update
// time rather than silently stored and failing only at execution.
const MAX_FLOW_NODES = 50;
const MAX_FLOW_EDGES = 200;

const FlowDefinitionSchema = z.object({
  nodes: z.array(FlowNodeSchema).max(MAX_FLOW_NODES, `Flow cannot have more than ${MAX_FLOW_NODES} nodes`),
  edges: z.array(FlowEdgeSchema).max(MAX_FLOW_EDGES, `Flow cannot have more than ${MAX_FLOW_EDGES} edges`),
}).refine(
  (def) => {
    // Reject dangling edges: every edge.source and edge.target must reference
    // an existing node id. Without this check the executor produces confusing
    // results when it encounters references to nodes that were never defined.
    const nodeIds = new Set(def.nodes.map((n) => n.id));
    return def.edges.every((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
  },
  { message: "Flow contains edges that reference unknown node ids" },
);

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
   * List every team (flow) a given deployment belongs to, plus its
   * teammates within each team.
   *
   * Used by the per-deployment `/d/[id]` page to surface a "Team
   * Memberships" panel — closes the "Per-deployment team membership
   * visibility" gap from `docs/audits/fractal-vision-gap-audit.md`.
   *
   * Returns:
   *   [
   *     {
   *       flowId, flowName, status, entryNodeId,
   *       nodeId,                    // this deployment's node id within the flow
   *       isEntry,                   // true if this deployment is the entry point
   *       roleLabel,                 // node.role || node.label || "Member"
   *       teammates: [
   *         { deploymentId, name, runtime, status, nodeId, isEntry, roleLabel }
   *       ],
   *     },
   *     ...
   *   ]
   *
   * Ownership: filters by `ctx.user.id` so a caller can never see a
   * flow they don't own (no IDOR — even if they guess a real deployment
   * id, the join is scoped to flows owned by them).
   *
   * Empty result is normal — most solo deployments aren't on any team.
   */
  listForDeployment: protectedProcedure
    .input(z.object({ deploymentId: z.string().min(1).max(255) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const fdm = (tables as any).flowDeploymentMemberships;
      if (!fdm) return [];

      // Step 1: find every membership row for this deployment, joined to
      // the flow row, with ownership filter.
      const memberships = await db
        .select({
          flowId: fdm.flowId,
          nodeId: fdm.nodeId,
          flowName: orchestrationFlows.name,
          flowStatus: orchestrationFlows.status,
          flowDefinition: orchestrationFlows.definition,
          flowEntryNodeId: orchestrationFlows.entryNodeId,
        })
        .from(fdm)
        .innerJoin(
          orchestrationFlows,
          and(
            eq(fdm.flowId, orchestrationFlows.id),
            eq(orchestrationFlows.userId, userId), // IDOR guard
          ),
        )
        .where(eq(fdm.deploymentId, input.deploymentId));

      if (memberships.length === 0) return [];

      // Step 2: for each flow, walk the definition to extract the
      // teammate node list. Then fetch the deployment metadata in one
      // batch.
      const allTeammateIds = new Set<string>();
      const flowsParsed = memberships.map((m: any) => {
        let definition: { nodes?: any[]; edges?: any[] } = {};
        try {
          definition = typeof m.flowDefinition === "string"
            ? JSON.parse(m.flowDefinition)
            : (m.flowDefinition || {});
        } catch {
          definition = {};
        }
        const nodes = definition.nodes || [];
        const teammateNodes = nodes.filter(
          (n: any) =>
            n?.deploymentId &&
            typeof n.deploymentId === "string" &&
            n.id !== m.nodeId, // exclude self
        );
        for (const n of teammateNodes) allTeammateIds.add(n.deploymentId);
        const selfNode = nodes.find((n: any) => n.id === m.nodeId);
        // Entry point: check membership table first, then fall back to node config
        const derivedEntryNodeId = m.flowEntryNodeId
          ?? nodes.find((n: any) => n?.config?.isEntryPoint || n?.isEntryPoint)?.id
          ?? null;
        const isEntry = derivedEntryNodeId === m.nodeId;
        // Role: check config.role first (canvas stores role inside config object)
        const roleLabel =
          selfNode?.config?.role || selfNode?.role || selfNode?.label || (isEntry ? "Entry" : "Member");
        // Extract edges connecting nodes in this flow for the mini topology viz.
        // Only include edges whose source AND target are known node IDs.
        const nodeIds = new Set(nodes.map((n: any) => n?.id).filter(Boolean));
        const flowEdges = (definition.edges || [])
          .filter((e: any) => e?.source && e?.target && nodeIds.has(e.source) && nodeIds.has(e.target) && e.source !== e.target)
          .map((e: any) => ({
            sourceNodeId: e.source as string,
            targetNodeId: e.target as string,
            type: (e.type || e.label || "delegates") as string,
          }));
        return {
          flowId: m.flowId,
          flowName: m.flowName,
          status: m.flowStatus,
          entryNodeId: derivedEntryNodeId,
          nodeId: m.nodeId,
          isEntry,
          roleLabel,
          teammateNodes,
          flowEdges,
        };
      });

      // Step 3: batch-fetch teammate deployment metadata in one query.
      // Must be filtered by user ownership (defense in depth — the
      // memberships query already enforced it via the flow join).
      const deploymentsTable = (tables as any).deployments;
      let teammateDeployments: Map<
        string,
        { id: string; name: string; runtime: string; status: string }
      > = new Map();
      if (allTeammateIds.size > 0 && deploymentsTable) {
        const rows = await db
          .select({
            id: deploymentsTable.id,
            name: deploymentsTable.name,
            runtime: deploymentsTable.runtime,
            status: deploymentsTable.status,
          })
          .from(deploymentsTable)
          .where(
            and(
              inArray(deploymentsTable.id, Array.from(allTeammateIds)),
              eq(deploymentsTable.userId, userId),
            ),
          );
        teammateDeployments = new Map(rows.map((r: any) => [r.id, r]));
      }

      // Step 4: assemble final response shape with strictly-typed
      // teammates (no nulls — unowned deployments are dropped via
      // flatMap rather than map+filter so the TS type is non-nullable).
      return flowsParsed.map((f) => {
        const teammates = f.teammateNodes.flatMap((tn: any) => {
          const dep = teammateDeployments.get(tn.deploymentId);
          if (!dep) return [];
          const tnIsEntry = f.entryNodeId === tn.id
            || !!(tn.config?.isEntryPoint || tn.isEntryPoint);
          return [
            {
              deploymentId: tn.deploymentId as string,
              name: dep.name,
              runtime: dep.runtime,
              status: dep.status,
              nodeId: tn.id as string,
              isEntry: tnIsEntry,
              roleLabel: (tn.config?.role || tn.role || tn.label || (tnIsEntry ? "Entry" : "Member")) as string,
            },
          ];
        });
        return {
          flowId: f.flowId,
          flowName: f.flowName,
          status: f.status,
          entryNodeId: f.entryNodeId,
          nodeId: f.nodeId,
          isEntry: f.isEntry,
          roleLabel: f.roleLabel,
          teammates,
          // Mini topology edges for the team visualization on /d/[id]
          edges: f.flowEdges,
        };
      });
    }),

  /**
   * Create a new orchestration flow.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255).refine(noHtmlTags, NO_HTML_MESSAGE),
        description: z.string().max(5000).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
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
        description: z.string().max(5000).refine((v) => v === null || noHtmlTags(v), NO_HTML_MESSAGE).nullable().optional(),
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

        // Clear `activeFlowId` on deployments that WERE members but are no
        // longer in the new definition. Without this, a removed bot keeps
        // its stale active-team selection and tamboAgent silently falls
        // back to `memberships[0]` (or no membership) — the same silent
        // mis-routing pattern the delete path had. See Cycle 10 of the
        // 2026-04-11 bot teams QA marathon.
        const newDeploymentIds = getDefinitionDeploymentIds(input.definition);
        const removed = [...oldDeploymentIds].filter((id) => !newDeploymentIds.has(id));
        if (removed.length > 0) {
          const deploymentsTableUpd = (tables as any).deployments;
          if (deploymentsTableUpd?.activeFlowId) {
            try {
              await db
                .update(deploymentsTableUpd)
                .set({ activeFlowId: null })
                .where(
                  and(
                    eq(deploymentsTableUpd.activeFlowId, input.id),
                    inArray(deploymentsTableUpd.id, removed),
                  ),
                );
            } catch (err) {
              logger.error(
                { flowId: input.id, removed, err: err instanceof Error ? err.message : String(err) },
                "flows.update: failed to clear stale activeFlowId on removed members (non-fatal)",
              );
            }
          }
        }

        // Fire-and-forget configSync for the union of OLD ∪ NEW deployments
        // so leaving bots lose the Team Context block AND joining bots gain it.
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

      // Clear any dangling `activeFlowId` references BEFORE the delete.
      // The column is a plain varchar with no FK to orchestrationFlows, so
      // a delete / archive would otherwise leave deployments pointing at a
      // flow that no longer exists. At runtime tamboAgent would silently
      // fall back to `memberships[0]` without telling the user — the UI
      // could display "active: Engineering Squad" while the bot actually
      // routes via whichever membership happens to be first. See Cycle 10
      // of the 2026-04-11 bot teams QA marathon for the diagnosis.
      const deploymentsTableDel = (tables as any).deployments;
      if (deploymentsTableDel?.activeFlowId) {
        try {
          await db
            .update(deploymentsTableDel)
            .set({ activeFlowId: null })
            .where(eq(deploymentsTableDel.activeFlowId, input.id));
        } catch (err) {
          logger.error(
            { flowId: input.id, err: err instanceof Error ? err.message : String(err) },
            "flows.delete: failed to clear stale activeFlowId references (non-fatal — affected deployments will silently fall back to memberships[0])",
          );
        }
      }

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
      const stripResult = await stripStaleDeploymentRefs(
        sourceFlow.definition,
        userId,
      );
      const definitionToWrite = stripResult.definitionToWrite;
      if (stripResult.parseError) {
        logger.warn(
          {
            sourceFlowId: input.sourceFlowId,
            err: stripResult.parseError.message,
          },
          "duplicate: could not parse source definition for stale-ref sweep",
        );
      } else if (stripResult.removedNodeIds.size > 0) {
        logger.warn(
          {
            sourceFlowId: input.sourceFlowId,
            newFlowId: newId,
            userId,
            staleNodeCount: stripResult.removedNodeIds.size,
            staleNodeIds: Array.from(stripResult.removedNodeIds),
          },
          "duplicate: stripped stale deployment references during fork",
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
        // Detect LLM provider auth failures and surface as PRECONDITION_FAILED
        // so the client can prompt the user to configure their API key instead
        // of showing a generic 500 error.
        if (
          /\b401\b/.test(message) ||
          /unauthorized/i.test(message) ||
          /missing\s+authentication/i.test(message) ||
          /invalid\s+api\s+key/i.test(message)
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Flow generation requires a valid LLM API key. The configured " +
              "key was rejected by the provider — please check your OpenRouter " +
              "or Anthropic key in Settings.",
          });
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Flow generation failed: ${message}`,
        });
      }
    }),

  ...flowsChatProcedures,
});

// Export internal helpers for testability. These are intentionally
// excluded from the tRPC router surface.
export const __testables = {
  getFlowChatTables,
  isMissingTableError,
};
