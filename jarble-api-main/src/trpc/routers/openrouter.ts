import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { env } from "../../utils/env.js";

export const openrouterRouter = router({
  // Health check
  healthCheck: protectedProcedure.query(async () => {
    try {
      const res = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
      });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, error: "Failed to connect to OpenRouter" };
    }
  }),

  // List available models
  models: protectedProcedure.query(async () => {
    const res = await fetch("https://openrouter.ai/api/v1/models", {
      headers: { Authorization: `Bearer ${env.OPENROUTER_API_KEY}` },
    });
    const data = await res.json() as { data?: unknown[] };
    return data.data || [];
  }),

  // Validate an API key
  validateApiKey: protectedProcedure
    .input(z.object({ apiKey: z.string() }))
    .mutation(async ({ input }) => {
      try {
        const res = await fetch("https://openrouter.ai/api/v1/models", {
          headers: { Authorization: `Bearer ${input.apiKey}` },
        });
        return { valid: res.ok };
      } catch {
        return { valid: false };
      }
    }),
});
