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
import {
  findManagedKeyItem,
  updateManagedKeyLineItem,
  removeManagedKeyLineItem,
  addManagedKeyLineItem,
} from "../../services/stripe.js";

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
      // Dev bypass: accept any "dev-*" key when running in SQLite/dev mode
      const isDevMode = env.USE_SQLITE === "true" || env.USE_SQLITE === "1" || env.DB_PROVIDER === "sqlite";
      if (isDevMode && input.apiKey.startsWith("dev-")) {
        return { valid: true };
      }

      // Claude Max OAuth tokens (sk-ant-oat*) can't be validated via the
      // standard API — accept them based on prefix format
      if (input.provider === "anthropic" && input.apiKey.startsWith("sk-ant-oat")) {
        return { valid: true };
      }

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
            // Claude Max OAuth tokens (sk-ant-oat*) use Bearer auth;
            // standard API keys (sk-ant-api*) use x-api-key header
            fetchOptions = {
              method: "GET",
              headers: input.apiKey.startsWith("sk-ant-oat")
                ? {
                    Authorization: `Bearer ${input.apiKey}`,
                    "anthropic-version": "2023-06-01",
                  }
                : {
                    "x-api-key": input.apiKey,
                    "anthropic-version": "2023-06-01",
                  },
            };
            break;

          case "google":
            url = `https://generativelanguage.googleapis.com/v1/models`;
            fetchOptions = {
              method: "GET",
              headers: { "x-goog-api-key": input.apiKey },
            };
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
        await ctx.db.update(deployments)
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
      let keyId = deployment.llmApiKeyId;
      const sourceId = deployment.llmApiKeySourceDeploymentId;
      if (sourceId) {
        const owner = await ctx.db.query.deployments.findFirst({
          where: and(
            eq(deployments.id, sourceId),
            eq(deployments.userId, ctx.user.id)
          ),
        });
        keyId = owner?.llmApiKeyId || keyId;
      }

      if (!keyId || deployment.llmMode !== "included") {
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
      if (deployment.llmApiKeySourceDeploymentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This deployment is linked to a credit pool. Update the pool owner instead.",
        });
      }

      const keyId = deployment.llmApiKeyId;
      if (!keyId || deployment.llmMode !== "included") {
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

      // Sync the new limit to the DB so the frontend sees the updated value
      await ctx.db.update(deployments)
        .set({ llmCreditLimitDollars: input.limitDollars })
        .where(and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.userId, ctx.user.id),
        ));

      return { success: true };
    }),

  // Update managed key plan — changes both Stripe price and OpenRouter limit
  updateManagedKeyPlan: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      newLimitDollars: z.number().min(1).max(1000),
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

      // Block linked deployments
      if (deployment.llmApiKeySourceDeploymentId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This deployment is linked to a credit pool. Update the pool owner instead.",
        });
      }

      if (deployment.llmMode !== "included" || !deployment.llmApiKeyId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This deployment does not use managed keys.",
        });
      }

      // Update Stripe line item if subscription exists
      const subscriptionId = deployment.stripeSubscriptionId;
      if (subscriptionId) {
        const managedItem = await findManagedKeyItem(subscriptionId);
        if (managedItem) {
          await updateManagedKeyLineItem(managedItem.itemId, input.newLimitDollars * 100);
        } else {
          // No managed key line item yet — add one
          await addManagedKeyLineItem(subscriptionId, input.newLimitDollars * 100);
        }
      }

      // Update OpenRouter key limit
      const ok = await updateOpenRouterKeyLimit(deployment.llmApiKeyId, input.newLimitDollars);
      if (!ok) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update credit limit on OpenRouter.",
        });
      }

      // Update DB
      await ctx.db.update(deployments)
        .set({ llmCreditLimitDollars: input.newLimitDollars })
        .where(eq(deployments.id, input.deploymentId));

      logger.info(
        { deploymentId: input.deploymentId, newLimitDollars: input.newLimitDollars },
        "Managed key plan updated"
      );

      return { success: true };
    }),

  // Cancel managed keys — removes Stripe line item, revokes OpenRouter key, switches to BYOK
  cancelManagedKey: protectedProcedure
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

      if (deployment.llmMode !== "included") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This deployment does not use managed keys.",
        });
      }

      // Block if this is a pool owner with linked children
      if (!deployment.llmApiKeySourceDeploymentId) {
        const linkedChildren = await ctx.db.query.deployments.findMany({
          where: and(
            eq(deployments.llmApiKeySourceDeploymentId, input.deploymentId),
            eq(deployments.userId, ctx.user.id),
          ),
        });

        if (linkedChildren.length > 0) {
          const names = linkedChildren.map((c) => c.name).join(", ");
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Cannot cancel managed keys: ${linkedChildren.length} deployment(s) are linked to this credit pool (${names}). Unlink them first.`,
          });
        }
      }

      // Remove Stripe managed key line item
      const subscriptionId = deployment.stripeSubscriptionId;
      if (subscriptionId) {
        const managedItem = await findManagedKeyItem(subscriptionId);
        if (managedItem) {
          await removeManagedKeyLineItem(managedItem.itemId);
        }
      }

      // Revoke OpenRouter key
      const keyId = deployment.llmApiKeyId;
      if (keyId) {
        await revokeOpenRouterKey(keyId).catch((err: unknown) => {
          logger.warn({ err, deploymentId: input.deploymentId }, "Failed to revoke OpenRouter key during managed key cancellation");
        });
      }

      // Switch to BYOK in DB
      await ctx.db.update(deployments)
        .set({
          llmMode: "byok",
          llmApiKey: null,
          llmApiKeyId: null,
          llmCreditLimitDollars: null,
          llmApiKeySourceDeploymentId: null,
        })
        .where(eq(deployments.id, input.deploymentId));

      logger.info({ deploymentId: input.deploymentId }, "Managed keys cancelled, switched to BYOK");

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

      const keyId = deployment.llmApiKeyId;
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
      await ctx.db.update(deployments)
        .set({
          llmApiKey: null,
          llmApiKeyId: null,
          llmMode: "byok",
        })
        .where(and(
          eq(deployments.id, input.deploymentId),
          eq(deployments.userId, ctx.user.id),
        ));

      return { success: true };
    }),
});
