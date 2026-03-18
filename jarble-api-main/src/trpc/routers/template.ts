import { z } from "zod";
import { router, publicProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq, asc } from "drizzle-orm";

const { personaTemplates } = tables;

export const templateRouter = router({
  // List all active persona templates, sorted by sortOrder
  list: publicProcedure.query(async ({ ctx }) => {
    const results = await ctx.db.query.personaTemplates.findMany({
      where: eq(personaTemplates.isActive, true),
      orderBy: [asc(personaTemplates.sortOrder)],
    });

    return results.map(parsePersonaFields);
  }),

  // Get a single persona template by id
  getById: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const result = await ctx.db.query.personaTemplates.findFirst({
        where: eq(personaTemplates.id, input.id),
      });

      if (!result) return null;
      return parsePersonaFields(result);
    }),

  // List persona templates filtered by category
  listByCategory: publicProcedure
    .input(z.object({ category: z.string() }))
    .query(async ({ ctx, input }) => {
      const results = await ctx.db.query.personaTemplates.findMany({
        where: (t, { and }) =>
          and(
            eq(t.isActive, true),
            eq(t.category, input.category),
          ),
        orderBy: [asc(personaTemplates.sortOrder)],
      });

      return results.map(parsePersonaFields);
    }),

  // Get distinct categories with counts
  getCategories: publicProcedure.query(async ({ ctx }) => {
    // Use raw query approach since Drizzle doesn't have built-in groupBy for this
    const allActive = await ctx.db.query.personaTemplates.findMany({
      where: eq(personaTemplates.isActive, true),
    });

    const categoryMap = new Map<string, number>();
    for (const persona of allActive) {
      categoryMap.set(persona.category, (categoryMap.get(persona.category) || 0) + 1);
    }

    return Array.from(categoryMap.entries()).map(([category, count]) => ({
      category,
      count,
    }));
  }),
});

/**
 * Parse JSON string fields into their proper types for the frontend.
 */
function parsePersonaFields(persona: any) {
  return {
    ...persona,
    recommendedTools: safeJsonParse(persona.recommendedTools, []),
    defaultTheme: safeJsonParse(persona.defaultTheme, null),
    exampleConversation: safeJsonParse(persona.exampleConversation, []),
    showcasePrompts: safeJsonParse(persona.showcasePrompts, []),
  };
}

function safeJsonParse(value: string | null | undefined, fallback: any): any {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
