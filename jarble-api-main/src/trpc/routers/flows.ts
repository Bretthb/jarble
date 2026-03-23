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
import { eq, desc, and, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createModuleLogger } from "../../utils/logger.js";
import { customAlphabet } from "nanoid";

const logger = createModuleLogger("flows");

const { orchestrationFlows, flowExecutions } = tables;

const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const generateFlowId = () => `flw_${nanoid()}`;
const generateExecutionId = () => `fex_${nanoid()}`;

// ── Zod Schemas ──────────────────────────────────────────────────────────

const FlowNodeSchema = z.object({
  id: z.string(),
  type: z.enum(["deployment", "transform", "condition", "output"]),
  deploymentId: z.string().optional(),
  serviceId: z.string().optional(),
  skillName: z.string().optional(),
  label: z.string(),
  config: z.record(z.unknown()).optional(),
  position: z.object({ x: z.number(), y: z.number() }),
});

const FlowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  sourceHandle: z.string().optional(),
  targetHandle: z.string().optional(),
  label: z.string().optional(),
  condition: z.string().optional(),
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
        limit: z.number().int().min(1).max(100).default(50),
        offset: z.number().int().min(0).default(0),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const { status, limit = 50, offset = 0 } = input ?? {};

      const conditions = [eq(orchestrationFlows.userId, userId)];
      if (status) {
        conditions.push(eq(orchestrationFlows.status, status));
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
        name: z.string().min(1).max(255),
        description: z.string().optional(),
        definition: FlowDefinitionSchema,
        status: z.enum(["draft", "published"]).default("draft"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
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
        createdAt: now,
        updatedAt: now,
      });

      logger.info({ flowId: id, userId }, "Flow created");

      return { id };
    }),

  /**
   * Update an existing flow (name, description, definition, status).
   */
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().nullable().optional(),
        definition: FlowDefinitionSchema.optional(),
        status: z.enum(["draft", "published", "archived"]).optional(),
        isPublic: z.boolean().optional(),
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

      const updates: Record<string, unknown> = { updatedAt: dbDate() };
      if (input.name !== undefined) updates.name = input.name;
      if (input.description !== undefined) updates.description = input.description;
      if (input.definition !== undefined) updates.definition = JSON.stringify(input.definition);
      if (input.status !== undefined) updates.status = input.status;
      if (input.isPublic !== undefined) updates.isPublic = input.isPublic;

      await db
        .update(orchestrationFlows)
        .set(updates)
        .where(eq(orchestrationFlows.id, input.id));

      logger.info({ flowId: input.id, userId }, "Flow updated");

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

      if (input.hard) {
        // Hard delete — cascade deletes executions via FK
        await db
          .delete(orchestrationFlows)
          .where(eq(orchestrationFlows.id, input.id));
        logger.info({ flowId: input.id, userId }, "Flow hard-deleted");
      } else {
        // Soft delete — archive
        await db
          .update(orchestrationFlows)
          .set({ status: "archived", updatedAt: dbDate() })
          .where(eq(orchestrationFlows.id, input.id));
        logger.info({ flowId: input.id, userId }, "Flow archived");
      }

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
        name: z.string().min(1).max(255).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // Fetch the source flow — user must own it OR it must be public
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

      await db.insert(orchestrationFlows).values({
        id: newId,
        userId,
        name: input.name ?? `${sourceFlow.name} (copy)`,
        description: sourceFlow.description,
        definition: sourceFlow.definition,
        status: "draft",
        isPublic: false,
        forkCount: 0,
        forkedFromId: input.sourceFlowId,
        createdAt: now,
        updatedAt: now,
      });

      // Increment source fork count
      await db
        .update(orchestrationFlows)
        .set({ forkCount: sql`${orchestrationFlows.forkCount} + 1` })
        .where(eq(orchestrationFlows.id, input.sourceFlowId));

      logger.info({ newFlowId: newId, sourceFlowId: input.sourceFlowId, userId }, "Flow forked");

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
});
