import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { env } from "../../utils/env.js";
import { logger } from "../../utils/logger.js";
import {
  provisionOpenRouterKey,
  revokeOpenRouterKey,
  getOpenRouterKeyUsage,
  updateOpenRouterKeyLimit,
} from "../../utils/openrouter.js";
import { encryptApiKey } from "../../utils/encryption.js";

const { deployments } = tables;

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
  // Now uses the shared utility and stores the key hash for revocation
  provisionKey: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string(),
        limitDollars: z.number().default(5),
      })
    )
    .mutation(async ({ ctx, input }) => {
      if (!env.OPENROUTER_MANAGEMENT_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Included credits are not yet configured. Please use BYOK mode.",
        });
      }

      // Verify the deployment belongs to the user
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.userId, ctx.user.id)
        ),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      try {
        const provisioned = await provisionOpenRouterKey({
          userId: ctx.user.id,
          deploymentId: input.deploymentId,
          limitDollars: input.limitDollars,
        });

        // Encrypt and store the key + hash in the deployment record
        await (ctx.db as any).update(deployments)
          .set({
            llmApiKey: encryptApiKey(provisioned.key),
            llmApiKeyId: provisioned.hash,
            llmMode: "included",
            llmProvider: "openrouter",
          })
          .where(eq(deployments.id, input.deploymentId));

        return { success: true, hash: provisioned.hash };
      } catch (err) {
        logger.error({ err, userId: ctx.user.id }, "Failed to provision OpenRouter key");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to provision LLM credits. Please try again or use BYOK mode.",
        });
      }
    }),

  // Get LLM credit usage for a deployment (Included Credits only)
  getKeyUsage: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!env.OPENROUTER_MANAGEMENT_KEY) {
        return null; // Management API not configured
      }

      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.userId, ctx.user.id)
        ),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // If this deployment is linked, resolve to the owner's key
      let keyId = (deployment as any).llmApiKeyId;
      const sourceId = (deployment as any).llmApiKeySourceDeploymentId;
      if (sourceId) {
        const owner = await ctx.db.query.deployments.findFirst({
          where: and(
            eq(deployments.id, sourceId),
            eq(deployments.userId, ctx.user.id)
          ),
        });
        keyId = (owner as any)?.llmApiKeyId || keyId;
      }

      if (!keyId || (deployment as any).llmMode !== "included") {
        return null; // Not an included-credits deployment or no key hash stored
      }

      return getOpenRouterKeyUsage(keyId);
    }),

  // Update the credit limit for an included-credits deployment
  updateKeyLimit: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      limitDollars: z.number().min(1).max(1000),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!env.OPENROUTER_MANAGEMENT_KEY) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Management API not configured.",
        });
      }

      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.userId, ctx.user.id)
        ),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Block linked deployments — must update the owner instead
      if ((deployment as any).llmApiKeySourceDeploymentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This deployment is linked to a credit pool. Update the pool owner instead.",
        });
      }

      const keyId = (deployment as any).llmApiKeyId;
      if (!keyId || (deployment as any).llmMode !== "included") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This deployment does not use included credits.",
        });
      }

      const ok = await updateOpenRouterKeyLimit(keyId, input.limitDollars);
      if (!ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update credit limit.",
        });
      }

      return { success: true };
    }),

  // Revoke (disable) an OpenRouter key — admin/cleanup utility
  revokeKey: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.userId, ctx.user.id)
        ),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const keyId = (deployment as any).llmApiKeyId;
      if (!keyId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No OpenRouter key associated with this deployment.",
        });
      }

      const ok = await revokeOpenRouterKey(keyId);
      if (!ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to revoke the OpenRouter key.",
        });
      }

      // Clear the key from the DB
      await (ctx.db as any).update(deployments)
        .set({
          llmApiKey: null,
          llmApiKeyId: null,
          llmMode: "byok",
        })
        .where(eq(deployments.id, input.deploymentId));

      return { success: true };
    }),
});
