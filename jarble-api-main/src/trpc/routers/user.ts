import { z } from "zod";
import { router, publicProcedure, protectedProcedure } from "../middleware.js";
import { users } from "../../db/schema.js";
import { eq } from "drizzle-orm";

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
      await ctx.db
        .update(users)
        .set(input)
        .where(eq(users.id, ctx.user.id));
      // MySQL doesn't support returning, fetch updated record
      return ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });
    }),
});
