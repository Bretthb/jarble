import { z } from "zod";
import { router, publicProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { getHandlerOrNull } from "../../runtimes/index.js";

const { runtimeCatalog } = tables;

export const runtimeCatalogRouter = router({
  // List all active runtimes
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.query.runtimeCatalog.findMany({
      where: eq(runtimeCatalog.isActive, true),
      orderBy: (rc, { asc }) => [asc(rc.name)],
    });
  }),

  // Get runtime by ID
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.runtimeCatalog.findFirst({
        where: eq(runtimeCatalog.id, input.id),
      });
    }),

  // Get runtime by slug
  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.runtimeCatalog.findFirst({
        where: eq(runtimeCatalog.slug, input.slug),
      });
    }),

  // Get runtime capabilities from the handler registry
  getCapabilities: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(({ input }) => {
      const handler = getHandlerOrNull(input.slug);
      if (!handler) {
        return null;
      }
      return {
        slug: handler.slug,
        name: handler.name,
        capabilities: handler.capabilities,
        configFiles: handler.configFiles,
      };
    }),
});
