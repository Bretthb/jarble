import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { tables, dbDate } from "../../db/index.js";
import { eq, and, asc, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import { logger } from "../../utils/logger.js";
import { TRPCError } from "@trpc/server";
import { syncConfigsToPvc } from "../../services/configSync.js";
import { safeFireAndForget } from "../../utils/safeAsync.js";
import { noHtmlTags, NO_HTML_MESSAGE, noDangerousHtml, NO_DANGEROUS_HTML_MESSAGE } from "../../utils/sanitize.js";

const { deployments, deploymentSubagents } = tables;

const MAX_SUBAGENTS_PER_DEPLOYMENT = 10;

/** Derive a URL/config-safe slug from a human-readable name. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 50);
}

/** Verify the caller owns the deployment and return it, or throw NOT_FOUND. */
async function verifyDeploymentOwnership(
  db: any,
  deploymentId: string,
  userId: string,
) {
  const deployment = await db.query.deployments.findFirst({
    where: and(
      eq(deployments.id, deploymentId),
      eq(deployments.userId, userId),
    ),
  });
  if (!deployment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Deployment not found",
    });
  }
  return deployment;
}

/** Fire-and-forget config sync when the deployment is running. */
function syncIfRunning(
  deployment: { status: string | null },
  deploymentId: string,
) {
  if (deployment.status === "running") {
    safeFireAndForget(syncConfigsToPvc(deploymentId), {
      operation: "syncConfigsToPvc",
      deploymentId,
    });
  }
}

export const subagentsRouter = router({
  // ── List subagents for a deployment ─────────────────────────────────────
  list: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      await verifyDeploymentOwnership(ctx.db, input.deploymentId, ctx.user.id);

      return ctx.db.query.deploymentSubagents.findMany({
        where: eq(deploymentSubagents.deploymentId, input.deploymentId),
        orderBy: [asc(deploymentSubagents.sortOrder)],
      });
    }),

  // ── Get a single subagent by ID ─────────────────────────────────────────
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const subagent = await ctx.db.query.deploymentSubagents.findFirst({
        where: eq(deploymentSubagents.id, input.id),
      });

      if (!subagent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subagent not found",
        });
      }

      // Verify ownership via the parent deployment
      await verifyDeploymentOwnership(
        ctx.db,
        subagent.deploymentId,
        ctx.user.id,
      );

      return subagent;
    }),

  // ── Create a new subagent ───────────────────────────────────────────────
  create: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
        name: z.string().min(1).max(100).refine(noHtmlTags, NO_HTML_MESSAGE),
        description: z.string().max(2000).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
        systemPrompt: z.string().min(1).max(50_000).refine(noDangerousHtml, NO_DANGEROUS_HTML_MESSAGE),
        model: z.string().max(100).optional(),
        triggerType: z.enum(["manual", "auto", "conditional"]).default("manual"),
        triggerConfig: z.string().optional(),
        tools: z.string().optional(),
        enabled: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const deployment = await verifyDeploymentOwnership(
        ctx.db,
        input.deploymentId,
        ctx.user.id,
      );

      // Enforce max subagents per deployment
      const existing = await ctx.db.query.deploymentSubagents.findMany({
        where: eq(deploymentSubagents.deploymentId, input.deploymentId),
      });

      if (existing.length >= MAX_SUBAGENTS_PER_DEPLOYMENT) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Maximum of ${MAX_SUBAGENTS_PER_DEPLOYMENT} subagents per deployment`,
        });
      }

      const slug = slugify(input.name);

      // Check slug uniqueness within deployment
      const slugConflict = existing.find((s) => s.slug === slug);
      if (slugConflict) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A subagent with slug "${slug}" already exists on this deployment`,
        });
      }

      const id = nanoid(12);
      const now = dbDate();
      const sortOrder = existing.length; // append at end

      await ctx.db.insert(deploymentSubagents).values({
        id,
        deploymentId: input.deploymentId,
        name: input.name,
        slug,
        description: input.description ?? null,
        systemPrompt: input.systemPrompt,
        model: input.model ?? null,
        triggerType: input.triggerType,
        triggerConfig: input.triggerConfig ?? null,
        tools: input.tools ?? null,
        enabled: input.enabled,
        sortOrder,
        isPublic: false,
        forkedFromId: null,
        forkCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      logger.info(
        { deploymentId: input.deploymentId, subagentId: id, slug },
        "Subagent created",
      );

      syncIfRunning(deployment, input.deploymentId);

      return { id, slug };
    }),

  // ── Update a subagent ───────────────────────────────────────────────────
  update: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(100).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
        description: z.string().max(2000).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
        systemPrompt: z.string().min(1).refine(noDangerousHtml, NO_DANGEROUS_HTML_MESSAGE).optional(),
        model: z.string().max(100).nullable().optional(),
        triggerType: z.enum(["manual", "auto", "conditional"]).optional(),
        triggerConfig: z.string().nullable().optional(),
        tools: z.string().nullable().optional(),
        enabled: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subagent = await ctx.db.query.deploymentSubagents.findFirst({
        where: eq(deploymentSubagents.id, input.id),
      });

      if (!subagent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subagent not found",
        });
      }

      const deployment = await verifyDeploymentOwnership(
        ctx.db,
        subagent.deploymentId,
        ctx.user.id,
      );

      const updates: Record<string, unknown> = { updatedAt: dbDate() };

      if (input.name !== undefined) {
        updates.name = input.name;
        const newSlug = slugify(input.name);

        // Check slug uniqueness (excluding self)
        const conflict = await ctx.db.query.deploymentSubagents.findFirst({
          where: and(
            eq(deploymentSubagents.deploymentId, subagent.deploymentId),
            eq(deploymentSubagents.slug, newSlug),
          ),
        });
        if (conflict && conflict.id !== input.id) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `A subagent with slug "${newSlug}" already exists on this deployment`,
          });
        }

        updates.slug = newSlug;
      }
      if (input.description !== undefined) updates.description = input.description;
      if (input.systemPrompt !== undefined) updates.systemPrompt = input.systemPrompt;
      if (input.model !== undefined) updates.model = input.model;
      if (input.triggerType !== undefined) updates.triggerType = input.triggerType;
      if (input.triggerConfig !== undefined) updates.triggerConfig = input.triggerConfig;
      if (input.tools !== undefined) updates.tools = input.tools;
      if (input.enabled !== undefined) updates.enabled = input.enabled;

      await ctx.db
        .update(deploymentSubagents)
        .set(updates)
        .where(eq(deploymentSubagents.id, input.id));

      logger.info(
        { subagentId: input.id, deploymentId: subagent.deploymentId },
        "Subagent updated",
      );

      syncIfRunning(deployment, subagent.deploymentId);

      return { success: true };
    }),

  // ── Delete a subagent ───────────────────────────────────────────────────
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const subagent = await ctx.db.query.deploymentSubagents.findFirst({
        where: eq(deploymentSubagents.id, input.id),
      });

      if (!subagent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subagent not found",
        });
      }

      const deployment = await verifyDeploymentOwnership(
        ctx.db,
        subagent.deploymentId,
        ctx.user.id,
      );

      await ctx.db
        .delete(deploymentSubagents)
        .where(eq(deploymentSubagents.id, input.id));

      logger.info(
        { subagentId: input.id, deploymentId: subagent.deploymentId },
        "Subagent deleted",
      );

      syncIfRunning(deployment, subagent.deploymentId);

      return { success: true };
    }),

  // ── Reorder subagents ───────────────────────────────────────────────────
  reorder: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
        orderedIds: z.array(z.string()),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await verifyDeploymentOwnership(
        ctx.db,
        input.deploymentId,
        ctx.user.id,
      );

      // Update sortOrder for each subagent in the given order
      for (let i = 0; i < input.orderedIds.length; i++) {
        await ctx.db
          .update(deploymentSubagents)
          .set({ sortOrder: i, updatedAt: dbDate() })
          .where(
            and(
              eq(deploymentSubagents.id, input.orderedIds[i]),
              eq(deploymentSubagents.deploymentId, input.deploymentId),
            ),
          );
      }

      logger.info(
        { deploymentId: input.deploymentId, count: input.orderedIds.length },
        "Subagents reordered",
      );

      return { success: true };
    }),

  // ── Fork a public subagent to own deployment ────────────────────────────
  fork: protectedProcedure
    .input(
      z.object({
        sourceSubagentId: z.string(),
        targetDeploymentId: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Verify target deployment ownership
      const deployment = await verifyDeploymentOwnership(
        ctx.db,
        input.targetDeploymentId,
        ctx.user.id,
      );

      // Load source subagent - must be public
      const source = await ctx.db.query.deploymentSubagents.findFirst({
        where: eq(deploymentSubagents.id, input.sourceSubagentId),
      });

      if (!source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source subagent not found",
        });
      }

      if (!source.isPublic) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Source subagent is not public",
        });
      }

      // Enforce max subagents on target
      const existing = await ctx.db.query.deploymentSubagents.findMany({
        where: eq(
          deploymentSubagents.deploymentId,
          input.targetDeploymentId,
        ),
      });

      if (existing.length >= MAX_SUBAGENTS_PER_DEPLOYMENT) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Maximum of ${MAX_SUBAGENTS_PER_DEPLOYMENT} subagents per deployment`,
        });
      }

      // Derive slug, handle conflicts by appending suffix
      let slug = slugify(source.name);
      const existingSlugs = new Set(existing.map((s) => s.slug));
      if (existingSlugs.has(slug)) {
        let suffix = 2;
        while (existingSlugs.has(`${slug}_${suffix}`)) suffix++;
        slug = `${slug}_${suffix}`.slice(0, 50);
      }

      const id = nanoid(12);
      const now = dbDate();

      // Copy fields from source (excluding id, deploymentId, isPublic)
      await ctx.db.insert(deploymentSubagents).values({
        id,
        deploymentId: input.targetDeploymentId,
        name: source.name,
        slug,
        description: source.description,
        systemPrompt: source.systemPrompt,
        model: source.model,
        triggerType: source.triggerType,
        triggerConfig: source.triggerConfig,
        tools: source.tools,
        enabled: true,
        sortOrder: existing.length,
        isPublic: false,
        forkedFromId: source.id,
        forkCount: 0,
        createdAt: now,
        updatedAt: now,
      });

      // Increment forkCount on the source
      await ctx.db
        .update(deploymentSubagents)
        .set({ forkCount: sql`${deploymentSubagents.forkCount} + 1` })
        .where(eq(deploymentSubagents.id, source.id));

      logger.info(
        {
          sourceId: source.id,
          forkedId: id,
          targetDeploymentId: input.targetDeploymentId,
        },
        "Subagent forked",
      );

      syncIfRunning(deployment, input.targetDeploymentId);

      return { id, slug };
    }),

  // ── Toggle public visibility ────────────────────────────────────────────
  togglePublic: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        isPublic: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const subagent = await ctx.db.query.deploymentSubagents.findFirst({
        where: eq(deploymentSubagents.id, input.id),
      });

      if (!subagent) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Subagent not found",
        });
      }

      await verifyDeploymentOwnership(
        ctx.db,
        subagent.deploymentId,
        ctx.user.id,
      );

      await ctx.db
        .update(deploymentSubagents)
        .set({ isPublic: input.isPublic, updatedAt: dbDate() })
        .where(eq(deploymentSubagents.id, input.id));

      logger.info(
        { subagentId: input.id, isPublic: input.isPublic },
        "Subagent visibility toggled",
      );

      return { success: true };
    }),

  // ── List public subagents (marketplace browse) ──────────────────────────
  listPublic: protectedProcedure
    .input(
      z
        .object({
          limit: z.number().min(1).max(50).default(20),
          offset: z.number().min(0).default(0),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const offset = input?.offset ?? 0;

      const items = await ctx.db.query.deploymentSubagents.findMany({
        where: eq(deploymentSubagents.isPublic, true),
        orderBy: [asc(deploymentSubagents.name)],
        limit: limit + 1, // fetch one extra to detect hasMore
        offset,
      });

      const hasMore = items.length > limit;
      if (hasMore) items.pop();

      return { items, hasMore };
    }),
});
