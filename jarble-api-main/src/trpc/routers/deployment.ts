import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { createDeployment, deleteDeployment, getDeploymentPodStatus } from "../../k8s/deployment.js";
import { nanoid } from "nanoid";
import { logger } from "../../utils/logger.js";
import { TRPCError } from "@trpc/server";

const { deployments, users, tiers } = tables;

/**
 * Helper: Check if a user can create more deployments based on their tier limits.
 * Returns { allowed, current, max, tierName, tierId } for the frontend to display.
 */
async function checkDeploymentLimits(db: any, userId: string) {
  // Get user with tier info
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    with: { tier: true },
  });

  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }

  // If no tier assigned, default to Free limits (1 deployment)
  const tier = user.tier;
  const maxDeployments = tier?.maxDeployments ?? 1;
  const tierName = tier?.name ?? "Free";

  // Count current deployments
  const currentDeployments = await db.query.deployments.findMany({
    where: eq(deployments.userId, userId),
  });
  // Count active deployments (exclude "failed" — they aren't using resources)
  const activeCount = currentDeployments.filter(
    (d: any) => d.status !== "failed"
  ).length;

  return {
    allowed: activeCount < maxDeployments,
    current: activeCount,
    max: maxDeployments,
    tierName,
    tierId: user.tierId,
  };
}

export const deploymentRouter = router({
  // Check if user can create more deployments (for frontend UI)
  canDeploy: protectedProcedure.query(async ({ ctx }) => {
    return checkDeploymentLimits(ctx.db, ctx.user.id);
  }),

  // List user's deployments
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.deployments.findMany({
      where: eq(deployments.userId, ctx.user.id),
      orderBy: (d, { desc }) => [desc(d.createdAt)],
    });
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
      });
    }),

  // Create deployment (DB record only, doesn't deploy)
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      template: z.string().optional(),
      platform: z.string().optional(),
      runtime: z.string().default("openclaw"),
      image: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // ─── Deploy Gate: check tier limits ───
      const limits = await checkDeploymentLimits(ctx.db, ctx.user.id);
      if (!limits.allowed) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: `You've reached the maximum of ${limits.max} deployment${limits.max === 1 ? '' : 's'} for the ${limits.tierName} tier. Upgrade your plan to create more.`,
        });
      }

      const deploymentId = nanoid(12);

      // Insert into DB with pending status
      await (ctx.db as any).insert(deployments).values({
        id: deploymentId,
        userId: ctx.user.id,
        name: input.name,
        template: input.template || null,
        runtime: input.runtime,
        image: input.image || null,
        status: "pending",
      });

      const deployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, deploymentId),
      });

      logger.info({ deploymentId, userId: ctx.user.id, tier: limits.tierName }, "Deployment created (pending)");
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
            template: deployment.template || undefined,
            runtime: deployment.runtime,
            image: deployment.image || undefined,
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
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      await (ctx.db as any).update(deployments)
        .set(updates)
        .where(and(eq(deployments.id, id), eq(deployments.userId, ctx.user.id)));

      return ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, id),
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

      return { success: true };
    }),
});
