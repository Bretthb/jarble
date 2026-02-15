import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../middleware.js";
import { env } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";

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
    const data = (await res.json()) as { data?: unknown[] };
    return data.data || [];
  }),

  // Validate an OpenRouter API key (legacy — use validateProviderKey for multi-provider)
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

  // Validate any LLM provider's API key
  validateProviderKey: protectedProcedure
    .input(
      z.object({
        provider: z.enum(["openrouter", "openai", "anthropic", "google"]),
        apiKey: z.string().min(1),
      })
    )
    .mutation(async ({ input }) => {
      try {
        let url: string;
        let fetchOptions: RequestInit;

        switch (input.provider) {
          case "openrouter":
            url = "https://openrouter.ai/api/v1/models";
            fetchOptions = {
              method: "GET",
              headers: { Authorization: `Bearer ${input.apiKey}` },
            };
            break;

          case "openai":
            url = "https://api.openai.com/v1/models";
            fetchOptions = {
              method: "GET",
              headers: { Authorization: `Bearer ${input.apiKey}` },
            };
            break;

          case "anthropic":
            url = "https://api.anthropic.com/v1/models";
            fetchOptions = {
              method: "GET",
              headers: {
                "x-api-key": input.apiKey,
                "anthropic-version": "2023-06-01",
              },
            };
            break;

          case "google":
            url = `https://generativelanguage.googleapis.com/v1/models?key=${input.apiKey}`;
            fetchOptions = { method: "GET" };
            break;

          default:
            return { valid: false };
        }

        const res = await fetch(url, fetchOptions);

        // For Anthropic, 401/403 = invalid key; other errors may mean key is valid
        if (input.provider === "anthropic") {
          return { valid: res.status !== 401 && res.status !== 403 };
        }

        return { valid: res.ok };
      } catch {
        return { valid: false };
      }
    }),

  // Provision an OpenRouter tenant API key (for "Included Credits" mode)
  provisionKey: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
        limitDollars: z.number().default(5), // $5 monthly limit default
      })
    )
    .mutation(async ({ ctx, input }) => {
      const managementKey = env.OPENROUTER_MANAGEMENT_KEY;
      if (!managementKey) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "Included credits are not yet configured. Please use BYOK mode.",
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
            name: `jarble-${ctx.user.id}-${input.deploymentId}`,
            limit: input.limitDollars,
          }),
        });

        if (!res.ok) {
          const errorBody = await res.text();
          logger.error(
            { status: res.status, body: errorBody },
            "OpenRouter Management API error"
          );
          throw new Error(
            `OpenRouter Management API error: ${res.status}`
          );
        }

        const data = (await res.json()) as {
          key?: string;
          data?: { key?: string };
        };
        const provisionedKey = data.key || data.data?.key;

        if (!provisionedKey) {
          throw new Error("No key returned from OpenRouter Management API");
        }

        logger.info(
          { userId: ctx.user.id, deploymentId: input.deploymentId },
          "Provisioned OpenRouter tenant key"
        );

        return { success: true, key: provisionedKey };
      } catch (err) {
        logger.error(
          { err, userId: ctx.user.id },
          "Failed to provision OpenRouter key"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message:
            "Failed to provision LLM credits. Please try again or use BYOK mode.",
        });
      }
    }),
});
