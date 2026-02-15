import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq } from "drizzle-orm";

const { users } = tables;

export const userRouter = router({
  // Get current user from context
  me: publicProcedure.query(({ ctx }) => ctx.user),

  // Get full profile from DB
  getProfile: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.users.findFirst({
      where: eq(users.id, ctx.user.id),
    });
  }),

  // Update profile
  updateProfile: protectedProcedure
    .input(z.object({
      name: z.string().min(1).optional(),
      email: z.string().email().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await (ctx.db as any)
        .update(users)
        .set(input)
        .where(eq(users.id, ctx.user.id));
      return ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
    }),

  // Complete profile — for email/password signups that need to add their name
  // Called after email verification is confirmed
  completeProfile: protectedProcedure
    .input(z.object({
      firstName: z.string().min(1).max(100),
      lastName: z.string().min(1).max(100),
    }))
    .mutation(async ({ ctx, input }) => {
      const fullName = `${input.firstName} ${input.lastName}`;
      await (ctx.db as any)
        .update(users)
        .set({ name: fullName })
        .where(eq(users.id, ctx.user.id));
      return ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
    }),
});
