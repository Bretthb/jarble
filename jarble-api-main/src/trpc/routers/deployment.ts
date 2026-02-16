import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { createDeployment, deleteDeployment, getDeploymentPodStatus } from "../../k8s/deployment.js";
import { nanoid } from "nanoid";
import { logger } from "../../utils/logger.js";
import { TRPCError } from "@trpc/server";
import { env } from "../../utils/env.js";

const { deployments, users, runtimeCatalog } = tables;

/**
 * Helper: Check free deployment status for a user.
 * Returns whether the user has used their free deployment and if it's expired.
 */
async function checkFreeDeployment(db: any, userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }

  const freeUsed = user.freeDeploymentUsed ?? false;

  // Check if free trial has expired
  let freeExpired = false;
  let freeExpiresAt: string | null = null;

  if (freeUsed) {
    // Find the free deployment to check its expiry
    const freeDeployment = await db.query.deployments.findFirst({
      where: and(eq(deployments.userId, userId), eq(deployments.isFree, true)),
    });

    if (freeDeployment?.freeExpiresAt) {
      freeExpiresAt = freeDeployment.freeExpiresAt;
      freeExpired = new Date(freeDeployment.freeExpiresAt) < new Date();
    }
  }

  return {
    freeUsed,
    freeExpired,
    freeExpiresAt,
  };
}

export const deploymentRouter = router({
  // Check free deployment status (for frontend UI)
  canDeploy: protectedProcedure.query(async ({ ctx }) => {
    return checkFreeDeployment(ctx.db, ctx.user.id);
  }),

  // List user's deployments
  list: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.db.query.deployments.findMany({
      where: eq(deployments.userId, ctx.user.id),
      with: { runtimeCatalogEntry: true },
      orderBy: (d, { desc }) => [desc(d.createdAt)],
    });

    // Enrich with free trial status
    return result.map((d: any) => ({
      ...d,
      freeTrialExpired: d.isFree && d.freeExpiresAt ? new Date(d.freeExpiresAt) < new Date() : false,
    }));
  }),

  // Get single deployment
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.id),
          eq(deployments.userId, ctx.user.id)
        ),
        with: { runtimeCatalogEntry: true },
      });
    }),

  // Create deployment (DB record only, doesn't deploy)
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      runtimeCatalogId: z.number(),
      platform: z.string().optional(),
      image: z.string().optional(),
      llmMode: z.enum(["included", "byok"]).default("byok"),
      llmProvider: z.enum(["openrouter", "openai", "anthropic", "google"]).default("openrouter"),
      llmModel: z.string().optional(), // e.g. "openrouter/auto", "gpt-4o", "claude-sonnet-4-20250514"
      llmApiKey: z.string().optional(),
      systemPrompt: z.string().optional(),
      cpuLimit: z.string().optional(),    // e.g. "2.0" — overrides runtime catalog default
      memoryMb: z.number().int().positive().optional(),   // e.g. 2048 — RAM in MB
      storageMb: z.number().int().positive().optional(),  // e.g. 30 — storage in GB (historical naming)
    }))
    .mutation(async ({ ctx, input }) => {
      // Look up the runtime catalog entry
      const catalogEntry = await ctx.db.query.runtimeCatalog.findFirst({
        where: eq(runtimeCatalog.id, input.runtimeCatalogId),
      });

      if (!catalogEntry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Runtime not found in catalog",
        });
      }

      // Check if this will be a free deployment
      const freeStatus = await checkFreeDeployment(ctx.db, ctx.user.id);
      const isFree = !freeStatus.freeUsed;

      const deploymentId = nanoid(12);
      const now = new Date();
      const freeExpiresAt = isFree
        ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : null;

      // If "included" mode, auto-provision an OpenRouter tenant key
      let resolvedApiKey = input.llmApiKey || null;
      let resolvedProvider: string = input.llmProvider;

      if (input.llmMode === "included") {
        const managementKey = env.OPENROUTER_MANAGEMENT_KEY;
        if (!managementKey) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Included credits are not yet configured. Please use BYOK mode.",
          });
        }

        try {
          const res = await fetch("https://openrouter.ai/api/v1/keys", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${managementKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              name: `jarble-${ctx.user.id}-${deploymentId}`,
              limit: 5, // $5 default monthly limit
            }),
          });

          if (!res.ok) {
            const errorBody = await res.text();
            logger.error({ status: res.status, body: errorBody }, "OpenRouter provisioning failed during deployment create");
            throw new Error(`OpenRouter Management API error: ${res.status}`);
          }

          const data = (await res.json()) as { key?: string; data?: { key?: string } };
          const provisionedKey = data.key || data.data?.key;

          if (!provisionedKey) {
            throw new Error("No key returned from OpenRouter Management API");
          }

          resolvedApiKey = provisionedKey;
          resolvedProvider = "openrouter"; // Included credits always use OpenRouter
          logger.info({ deploymentId, userId: ctx.user.id }, "Auto-provisioned OpenRouter tenant key");
        } catch (err) {
          logger.error({ err, deploymentId, userId: ctx.user.id }, "Failed to auto-provision OpenRouter key");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to provision LLM credits. Please try again or use BYOK mode.",
          });
        }
      }

      // Free tier deployments get minimum specs (except 2GB RAM minimum)
      const FREE_TIER_SPECS = { cpuLimit: "1", memoryMb: 2048, storageMb: 20 };

      // Insert deployment — hardware overrides default from runtime catalog
      await (ctx.db as any).insert(deployments).values({
        id: deploymentId,
        userId: ctx.user.id,
        name: input.name,
        runtime: catalogEntry.slug,
        image: input.image || catalogEntry.dockerImage,
        runtimeCatalogId: input.runtimeCatalogId,
        isFree,
        monthlyPriceCents: isFree ? 0 : catalogEntry.monthlyPriceCents,
        freeExpiresAt,
        cpuLimit: isFree ? FREE_TIER_SPECS.cpuLimit : (input.cpuLimit || catalogEntry.cpuLimit),
        memoryMb: isFree ? FREE_TIER_SPECS.memoryMb : (input.memoryMb || catalogEntry.memoryMb),
        storageMb: isFree ? FREE_TIER_SPECS.storageMb : (input.storageMb || catalogEntry.storageMb),
        llmMode: input.llmMode,
        llmProvider: resolvedProvider,
        llmModel: input.llmModel || (input.llmMode === "included" ? "openrouter/auto" : null),
        llmApiKey: resolvedApiKey,
        systemPrompt: input.systemPrompt || null,
        status: "pending",
      });

      // If this is the free deployment, mark it on the user
      if (isFree) {
        await (ctx.db as any).update(users)
          .set({
            freeDeploymentUsed: true,
            freeTrialExpiresAt: freeExpiresAt,
          })
          .where(eq(users.id, ctx.user.id));
      }

      const deployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, deploymentId),
        with: { runtimeCatalogEntry: true },
      });

      logger.info({
        deploymentId,
        userId: ctx.user.id,
        runtime: catalogEntry.slug,
        isFree,
        llmMode: input.llmMode,
        llmProvider: resolvedProvider,
        cpuLimit: isFree ? FREE_TIER_SPECS.cpuLimit : (input.cpuLimit || catalogEntry.cpuLimit),
        memoryMb: isFree ? FREE_TIER_SPECS.memoryMb : (input.memoryMb || catalogEntry.memoryMb),
        storageMb: isFree ? FREE_TIER_SPECS.storageMb : (input.storageMb || catalogEntry.storageMb),
        monthlyPriceCents: isFree ? 0 : catalogEntry.monthlyPriceCents,
      }, "Deployment created (pending)");

      return deployment;
    }),

  // Deploy (triggers K8s deployment)
  deploy: protectedProcedure
    .input(z.string()) // deploymentId
    .mutation(async ({ ctx, input: deploymentId }) => {
      // Verify ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, deploymentId), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Update status to creating
      await (ctx.db as any).update(deployments)
        .set({ status: "creating" })
        .where(eq(deployments.id, deploymentId));

      // Start K8s deployment (fire-and-forget — don't block the response)
      void (async () => {
        try {
          await createDeployment(deploymentId, ctx.user.id, {
            name: deployment.name,
            runtime: deployment.runtime,
            image: deployment.image || undefined,
            cpuLimit: deployment.cpuLimit || undefined,
            memoryMb: deployment.memoryMb || undefined,
            storageMb: deployment.storageMb || undefined,
          });
          await (ctx.db as any).update(deployments)
            .set({ status: "running" })
            .where(eq(deployments.id, deploymentId));
          logger.info({ deploymentId }, "Deployment succeeded");
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown deployment error";
          await (ctx.db as any).update(deployments)
            .set({ status: "failed", error: message })
            .where(eq(deployments.id, deploymentId));
          logger.error({ deploymentId, err }, "Deployment failed");
        }
      })();

      return { success: true, deploymentId };
    }),

  // Get pod status from K8s
  getStatus: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        return { status: "not_found" };
      }

      return getDeploymentPodStatus(input.id);
    }),

  // Update deployment
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      systemPrompt: z.string().optional(),
      llmMode: z.enum(["included", "byok"]).optional(),
      llmProvider: z.enum(["openrouter", "openai", "anthropic", "google"]).optional(),
      llmModel: z.string().optional(),
      llmApiKey: z.string().optional(),
      cpuLimit: z.string().optional(),
      memoryMb: z.number().int().positive().optional(),
      storageMb: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      await (ctx.db as any).update(deployments)
        .set(updates)
        .where(and(eq(deployments.id, id), eq(deployments.userId, ctx.user.id)));

      return ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, id),
        with: { runtimeCatalogEntry: true },
      });
    }),

  // Delete deployment + K8s resources
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Delete K8s resources first
      await deleteDeployment(input.id);

      // Then delete from DB
      await (ctx.db as any).delete(deployments)
        .where(and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)));

      // Note: We do NOT reset freeDeploymentUsed — the free trial is one-time only

      return { success: true };
    }),
});
