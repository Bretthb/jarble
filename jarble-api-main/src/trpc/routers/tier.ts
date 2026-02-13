import { z } from "zod";
import { router, publicProcedure } from "../middleware.js";
import { tiers } from "../../db/schema.js";
import { eq } from "drizzle-orm";

export const tierRouter = router({
  // List all tiers
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.query.tiers.findMany({
      orderBy: (tiers, { asc }) => [asc(tiers.price)],
    });
  }),

  // Get tier by ID
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.tiers.findFirst({
        where: eq(tiers.id, input.id),
      });
    }),
});
