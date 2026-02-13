import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { createBotDeployment, deleteBotDeployment, getBotPodStatus } from "../../k8s/bot-deployment.js";
import { nanoid } from "nanoid";
import { logger } from "../../utils/logger.js";

const { bots } = tables;

export const botRouter = router({
  // List user's bots
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.bots.findMany({
      where: eq(bots.userId, ctx.user.id),
      orderBy: (b, { desc }) => [desc(b.createdAt)],
    });
  }),

  // Get single bot
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.bots.findFirst({
        where: and(
          eq(bots.id, input.id),
          eq(bots.userId, ctx.user.id)
        ),
      });
    }),

  // Create bot (DB record only, doesn't deploy)
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      template: z.string().optional(),
      platform: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const botId = nanoid(12);

      // Insert into DB with pending status
      await (ctx.db as any).insert(bots).values({
        id: botId,
        userId: ctx.user.id,
        name: input.name,
        template: input.template || null,
        status: "pending",
      });

      const bot = await ctx.db.query.bots.findFirst({
        where: eq(bots.id, botId),
      });

      logger.info({ botId, userId: ctx.user.id }, "Bot created (pending deployment)");
      return bot;
    }),

  // Deploy bot (triggers K8s deployment)
  deploy: protectedProcedure
    .input(z.string()) // botId
    .mutation(async ({ ctx, input: botId }) => {
      // Verify ownership
      const bot = await ctx.db.query.bots.findFirst({
        where: and(eq(bots.id, botId), eq(bots.userId, ctx.user.id)),
      });

      if (!bot) {
        throw new Error("Bot not found");
      }

      // Update status to creating
      await (ctx.db as any).update(bots)
        .set({ status: "creating" })
        .where(eq(bots.id, botId));

      // Start K8s deployment (fire-and-forget — don't block the response)
      void (async () => {
        try {
          await createBotDeployment(botId, ctx.user.id, { name: bot.name, template: bot.template || undefined });
          await (ctx.db as any).update(bots)
            .set({ status: "running" })
            .where(eq(bots.id, botId));
          logger.info({ botId }, "Bot deployment succeeded");
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown deployment error";
          await (ctx.db as any).update(bots)
            .set({ status: "failed", error: message })
            .where(eq(bots.id, botId));
          logger.error({ botId, err }, "Bot deployment failed");
        }
      })();

      return { success: true, botId };
    }),

  // Get pod status from K8s
  getStatus: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const bot = await ctx.db.query.bots.findFirst({
        where: and(eq(bots.id, input.id), eq(bots.userId, ctx.user.id)),
      });
      if (!bot) {
        return { status: "not_found" };
      }

      return getBotPodStatus(input.id);
    }),

  // Update bot
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...updates } = input;
      await (ctx.db as any).update(bots)
        .set(updates)
        .where(and(eq(bots.id, id), eq(bots.userId, ctx.user.id)));

      return ctx.db.query.bots.findFirst({
        where: eq(bots.id, id),
      });
    }),

  // Delete bot + K8s resources
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Delete K8s resources first
      await deleteBotDeployment(input.id);

      // Then delete from DB
      await (ctx.db as any).delete(bots)
        .where(and(eq(bots.id, input.id), eq(bots.userId, ctx.user.id)));

      return { success: true };
    }),
});
