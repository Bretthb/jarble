import { z } from "zod";
import { router, publicProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq } from "drizzle-orm";
import { getHandlerOrNull } from "../../runtimes/index.js";

const { runtimeCatalog } = tables;

/**
 * Strip internal fields before returning a runtime catalog entry on
 * unauthenticated endpoints. Docker image paths, resource limits, and raw
 * timestamps are implementation details — keep them server-side. Display
 * surfaces (landing page, onboarding wizard) only need the public shape.
 */
function toPublicRuntime<T extends {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  category: string;
  monthlyPriceCents: number;
}>(row: T) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    category: row.category,
    monthlyPriceCents: row.monthlyPriceCents,
  };
}

export const runtimeCatalogRouter = router({
  // List all active runtimes (public — returns display-safe fields only)
  list: publicProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.runtimeCatalog.findMany({
      where: eq(runtimeCatalog.isActive, true),
      orderBy: (rc, { asc }) => [asc(rc.name)],
    });
    return rows.map(toPublicRuntime);
  }),

  // Get runtime by ID (public — returns display-safe fields only)
  getById: publicProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.runtimeCatalog.findFirst({
        where: eq(runtimeCatalog.id, input.id),
      });
      return row ? toPublicRuntime(row) : undefined;
    }),

  // Get runtime by slug (public — returns display-safe fields only)
  getBySlug: publicProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const row = await ctx.db.query.runtimeCatalog.findFirst({
        where: eq(runtimeCatalog.slug, input.slug),
      });
      return row ? toPublicRuntime(row) : null;
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
