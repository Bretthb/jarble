import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq, and, isNull } from "drizzle-orm";
import { createDeployment, deleteDeployment, stopDeployment, startDeployment, restartDeployment, getDeploymentPodStatus, getDeploymentStorageUsage, exportDeploymentConfigs } from "../../k8s/deployment.js";
import { cancelSubscriptionAtPeriodEnd, reactivateSubscription } from "../../services/stripe.js";
import { nanoid } from "nanoid";
import { logger } from "../../utils/logger.js";
import { TRPCError } from "@trpc/server";
import { env } from "../../utils/env.js";
import { getHandlerOrNull } from "../../runtimes/index.js";
import type { DeploymentFields } from "../../runtimes/types.js";
import { encryptApiKey, decryptApiKey } from "../../utils/encryption.js";
import { provisionOpenRouterKey, revokeOpenRouterKey } from "../../utils/openrouter.js";

const { deployments, users, runtimeCatalog } = tables;

/**
 * Helper: Check free deployment status for a user.
 * Returns whether the user has used their free deployment and if it's expired.
 */
async function checkFreeDeployment(db: any, userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }

  const freeUsed = user.freeDeploymentUsed ?? false;

  // Check if free trial has expired
  let freeExpired = false;
  let freeExpiresAt: string | null = null;

  if (freeUsed) {
    // Find the free deployment to check its expiry
    const freeDeployment = await db.query.deployments.findFirst({
      where: and(eq(deployments.userId, userId), eq(deployments.isFree, true)),
    });

    if (freeDeployment?.freeExpiresAt) {
      freeExpiresAt = freeDeployment.freeExpiresAt;
      freeExpired = new Date(freeDeployment.freeExpiresAt) < new Date();
    }
  }

  return {
    freeUsed,
    freeExpired,
    freeExpiresAt,
  };
}

export const deploymentRouter = router({
  // Check free deployment status (for frontend UI)
  canDeploy: protectedProcedure.query(async ({ ctx }) => {
    return checkFreeDeployment(ctx.db, ctx.user.id);
  }),

  // List user's deployments
  list: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.db.query.deployments.findMany({
      where: eq(deployments.userId, ctx.user.id),
      with: { runtimeCatalogEntry: true },
      orderBy: (d, { desc }) => [desc(d.createdAt)],
    });

    // Enrich with free trial status
    return result.map((d: any) => ({
      ...d,
      freeTrialExpired: d.isFree && d.freeExpiresAt ? new Date(d.freeExpiresAt) < new Date() : false,
    }));
  }),

  // List deployments that can be linked to (owner deployments with included credits)
  listLinkableDeployments: protectedProcedure.query(async ({ ctx }) => {
    const result = await ctx.db.query.deployments.findMany({
      where: and(
        eq(deployments.userId, ctx.user.id),
        eq((deployments as any).llmMode, "included"),
        isNull((deployments as any).llmApiKeySourceDeploymentId),
      ),
      orderBy: (d: any, { desc }: any) => [desc(d.createdAt)],
    });

    return result.map((d: any) => ({
      id: d.id,
      name: d.name,
      runtime: d.runtime,
      llmCreditLimitDollars: d.llmCreditLimitDollars,
    }));
  }),

  // Get single deployment
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      return ctx.db.query.deployments.findFirst({
        where: and(
          eq(deployments.id, input.id),
          eq(deployments.userId, ctx.user.id)
        ),
        with: { runtimeCatalogEntry: true },
      });
    }),

  // Create deployment (DB record only, doesn't deploy)
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1),
      runtimeCatalogId: z.number(),
      platform: z.string().optional(),
      image: z.string().optional(),
      llmMode: z.enum(["included", "byok"]).default("byok"),
      llmProvider: z.enum(["openrouter", "openai", "anthropic", "google"]).default("openrouter"),
      llmModel: z.string().optional(), // e.g. "openrouter/auto", "gpt-4o", "claude-sonnet-4-20250514"
      llmApiKey: z.string().optional(),
      systemPrompt: z.string().optional(),
      creditLimitDollars: z.number().min(1).max(1000).optional(), // Monthly spending cap for "included" mode (default $5)
      linkToDeploymentId: z.string().optional(), // Link to an existing deployment's credit pool instead of provisioning a new key
      cpuLimit: z.string().optional(),    // e.g. "2.0" — overrides runtime catalog default
      memoryMb: z.number().int().positive().optional(),   // e.g. 2048 — RAM in MB
      storageMb: z.number().int().positive().optional(),  // e.g. 30 — storage in GB (historical naming)
    }))
    .mutation(async ({ ctx, input }) => {
      // Look up the runtime catalog entry
      const catalogEntry = await ctx.db.query.runtimeCatalog.findFirst({
        where: eq(runtimeCatalog.id, input.runtimeCatalogId),
      });

      if (!catalogEntry) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Runtime not found in catalog",
        });
      }

      // Runtime-specific validation via handler (e.g. OpenClaw requires LLM key for BYOK)
      const handler = getHandlerOrNull(catalogEntry.slug);
      if (handler) {
        const validationError = handler.validateCreate({
          llmMode: input.llmMode,
          llmApiKey: input.llmApiKey,
          llmProvider: input.llmProvider,
          llmModel: input.llmModel,
          systemPrompt: input.systemPrompt,
        });
        if (validationError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: validationError });
        }
      }

      // Check if this will be a free deployment
      const freeStatus = await checkFreeDeployment(ctx.db, ctx.user.id);
      const isFree = !freeStatus.freeUsed;

      const deploymentId = nanoid(12);
      const now = new Date();
      const freeExpiresAt = isFree
        ? new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : null;

      // ── Resolve LLM credentials ──────────────────────────────────
      let resolvedApiKey = input.llmApiKey || null;
      let resolvedProvider: string = input.llmProvider;
      let resolvedApiKeyId: string | null = null;
      let resolvedSourceDeploymentId: string | null = null;
      let resolvedCreditLimit: number | null = input.llmMode === "included" ? (input.creditLimitDollars ?? 5) : null;

      if (input.llmMode === "included") {
        if (input.linkToDeploymentId) {
          // ── Link to an existing deployment's credit pool ──────────
          const sourceDeployment = await ctx.db.query.deployments.findFirst({
            where: and(
              eq(deployments.id, input.linkToDeploymentId),
              eq(deployments.userId, ctx.user.id),
            ),
          });

          if (!sourceDeployment) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Source deployment not found" });
          }

          const src = sourceDeployment as any;
          if (src.llmMode !== "included" || !src.llmApiKey) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Source deployment does not have included credits configured",
            });
          }

          // Resolve to root owner (follow the chain if source is itself linked)
          let rootId = sourceDeployment.id;
          let rootDeployment = src;
          if (src.llmApiKeySourceDeploymentId) {
            const root = await ctx.db.query.deployments.findFirst({
              where: and(
                eq(deployments.id, src.llmApiKeySourceDeploymentId),
                eq(deployments.userId, ctx.user.id),
              ),
            });
            if (root) {
              rootId = root.id;
              rootDeployment = root as any;
            }
          }

          // Copy the root owner's encrypted key + hash (no decryption needed)
          resolvedApiKey = null; // We'll set the encrypted key directly
          resolvedApiKeyId = rootDeployment.llmApiKeyId;
          resolvedSourceDeploymentId = rootId;
          resolvedProvider = "openrouter";
          resolvedCreditLimit = rootDeployment.llmCreditLimitDollars;

          logger.info({
            deploymentId,
            sourceDeploymentId: rootId,
            userId: ctx.user.id,
          }, "Linking deployment to existing credit pool");
        } else {
          // ── Provision a new OpenRouter tenant key ──────────────────
          if (!env.OPENROUTER_MANAGEMENT_KEY) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Included credits are not yet configured. Please use BYOK mode.",
            });
          }

          try {
            const provisioned = await provisionOpenRouterKey({
              userId: ctx.user.id,
              deploymentId,
              limitDollars: input.creditLimitDollars, // Uses default ($5) if not specified
            });

            resolvedApiKey = provisioned.key;
            resolvedApiKeyId = provisioned.hash;
            resolvedProvider = "openrouter"; // Included credits always use OpenRouter
          } catch (err) {
            logger.error({ err, deploymentId, userId: ctx.user.id }, "Failed to auto-provision OpenRouter key");
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to provision LLM credits. Please try again or use BYOK mode.",
            });
          }
        }
      }

      // Encrypt the API key before storing in DB
      // For linked deployments, copy the encrypted key directly from the root owner
      let encryptedKey: string | null = null;
      if (resolvedSourceDeploymentId) {
        // Linked: copy the root owner's already-encrypted key
        const rootDep = await ctx.db.query.deployments.findFirst({
          where: eq(deployments.id, resolvedSourceDeploymentId),
        });
        encryptedKey = (rootDep as any)?.llmApiKey || null;
      } else {
        encryptedKey = resolvedApiKey ? encryptApiKey(resolvedApiKey) : null;
      }

      // Free tier deployments get minimum specs (except 2GB RAM minimum)
      const FREE_TIER_SPECS = { cpuLimit: "1", memoryMb: 2048, storageMb: 20 };

      // Insert deployment — hardware overrides default from runtime catalog
      await (ctx.db as any).insert(deployments).values({
        id: deploymentId,
        userId: ctx.user.id,
        name: input.name,
        runtime: catalogEntry.slug,
        image: input.image || catalogEntry.dockerImage,
        runtimeCatalogId: input.runtimeCatalogId,
        isFree,
        monthlyPriceCents: isFree ? 0 : catalogEntry.monthlyPriceCents,
        freeExpiresAt,
        cpuLimit: isFree ? FREE_TIER_SPECS.cpuLimit : (input.cpuLimit || catalogEntry.cpuLimit),
        memoryMb: isFree ? FREE_TIER_SPECS.memoryMb : (input.memoryMb || catalogEntry.memoryMb),
        storageMb: isFree ? FREE_TIER_SPECS.storageMb : (input.storageMb || catalogEntry.storageMb),
        llmMode: input.llmMode,
        llmProvider: resolvedProvider,
        llmModel: input.llmModel || (input.llmMode === "included" ? "openrouter/auto" : null),
        llmApiKey: encryptedKey,
        llmApiKeyId: resolvedApiKeyId,
        llmCreditLimitDollars: resolvedCreditLimit,
        llmApiKeySourceDeploymentId: resolvedSourceDeploymentId,
        systemPrompt: input.systemPrompt || null,
        status: "pending",
      });

      // If this is the free deployment, mark it on the user
      if (isFree) {
        await (ctx.db as any).update(users)
          .set({
            freeDeploymentUsed: true,
            freeTrialExpiresAt: freeExpiresAt,
          })
          .where(eq(users.id, ctx.user.id));
      }

      const deployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, deploymentId),
        with: { runtimeCatalogEntry: true },
      });

      logger.info({
        deploymentId,
        userId: ctx.user.id,
        runtime: catalogEntry.slug,
        isFree,
        llmMode: input.llmMode,
        llmProvider: resolvedProvider,
        hasApiKeyId: !!resolvedApiKeyId,
        cpuLimit: isFree ? FREE_TIER_SPECS.cpuLimit : (input.cpuLimit || catalogEntry.cpuLimit),
        memoryMb: isFree ? FREE_TIER_SPECS.memoryMb : (input.memoryMb || catalogEntry.memoryMb),
        storageMb: isFree ? FREE_TIER_SPECS.storageMb : (input.storageMb || catalogEntry.storageMb),
        monthlyPriceCents: isFree ? 0 : catalogEntry.monthlyPriceCents,
      }, "Deployment created (pending)");

      return deployment;
    }),

  // Deploy (triggers K8s deployment)
  deploy: protectedProcedure
    .input(z.string()) // deploymentId
    .mutation(async ({ ctx, input: deploymentId }) => {
      // Verify ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, deploymentId), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Update status to creating
      await (ctx.db as any).update(deployments)
        .set({ status: "creating" })
        .where(eq(deployments.id, deploymentId));

      // Decrypt the API key for injection into K8s Secrets
      const rawApiKey = (deployment as any).llmApiKey
        ? decryptApiKey((deployment as any).llmApiKey)
        : null;

      // Build runtime handler data for K8s (config files + secret entries)
      const runtimeHandler = getHandlerOrNull(deployment.runtime);
      const deploymentFields: DeploymentFields = {
        id: deployment.id,
        runtime: deployment.runtime,
        name: deployment.name,
        description: deployment.description ?? null,
        systemPrompt: (deployment as any).systemPrompt ?? null,
        llmMode: (deployment as any).llmMode ?? "byok",
        llmProvider: (deployment as any).llmProvider ?? "openrouter",
        llmModel: (deployment as any).llmModel ?? null,
        llmApiKey: rawApiKey,
      };
      const initialConfigs = runtimeHandler?.renderConfigs(deploymentFields) ?? [];
      const extraSecretEntries = runtimeHandler?.getSecretEntries(deploymentFields) ?? {};

      // Start K8s deployment (fire-and-forget — don't block the response)
      void (async () => {
        try {
          await createDeployment(deploymentId, ctx.user.id, {
            name: deployment.name,
            runtime: deployment.runtime,
            image: deployment.image || undefined,
            cpuLimit: deployment.cpuLimit || undefined,
            memoryMb: deployment.memoryMb || undefined,
            storageMb: deployment.storageMb || undefined,
            initialConfigs,
            extraSecretEntries,
          });
          await (ctx.db as any).update(deployments)
            .set({ status: "running" })
            .where(eq(deployments.id, deploymentId));
          logger.info({ deploymentId }, "Deployment succeeded");
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown deployment error";
          await (ctx.db as any).update(deployments)
            .set({ status: "failed", error: message })
            .where(eq(deployments.id, deploymentId));
          logger.error({ deploymentId, err }, "Deployment failed");
        }
      })();

      return { success: true, deploymentId };
    }),

  // Get pod status from K8s
  getStatus: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        return { status: "not_found" };
      }

      return getDeploymentPodStatus(input.id);
    }),

  // Get storage usage from K8s (exec df inside the pod)
  getStorageUsage: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        return null;
      }

      // Get live usage from the pod + DB-configured limit
      const usage = await getDeploymentStorageUsage(input.id);
      return {
        ...usage,
        // Include the user's configured limit from DB (storageMb is actually GB)
        allocatedGb: (deployment as any).storageMb || 30,
      };
    }),

  // Update deployment
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      description: z.string().optional(),
      systemPrompt: z.string().optional(),
      llmMode: z.enum(["included", "byok"]).optional(),
      llmProvider: z.enum(["openrouter", "openai", "anthropic", "google"]).optional(),
      llmModel: z.string().optional(),
      llmApiKey: z.string().optional(),
      cpuLimit: z.string().optional(),
      memoryMb: z.number().int().positive().optional(),
      storageMb: z.number().int().positive().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rawUpdates } = input;

      // Fetch the existing deployment to detect mode switches
      const existing = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, id), eq(deployments.userId, ctx.user.id)),
      });

      if (!existing) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const updates: Record<string, any> = { ...rawUpdates };

      // ── Handle LLM mode switching ──────────────────────────────
      const currentMode = (existing as any).llmMode;
      const newMode = rawUpdates.llmMode;

      if (newMode && newMode !== currentMode) {
        if (newMode === "included") {
          // Switching BYOK → Included: provision a new OpenRouter key
          if (!env.OPENROUTER_MANAGEMENT_KEY) {
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message: "Included credits are not yet configured. Please use BYOK mode.",
            });
          }

          try {
            const provisioned = await provisionOpenRouterKey({
              userId: ctx.user.id,
              deploymentId: id,
            });

            updates.llmApiKey = encryptApiKey(provisioned.key);
            updates.llmApiKeyId = provisioned.hash;
            updates.llmProvider = "openrouter";
            updates.llmModel = updates.llmModel || "openrouter/auto";
            updates.llmCreditLimitDollars = 5; // Default plan on mode switch
            updates.llmApiKeySourceDeploymentId = null; // Own key, not linked
          } catch (err) {
            logger.error({ err, deploymentId: id }, "Failed to provision key during mode switch to included");
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to provision LLM credits. Please try again.",
            });
          }
        } else if (newMode === "byok") {
          // Switching Included → BYOK: check if this is a pool owner with linked children
          if (!(existing as any).llmApiKeySourceDeploymentId) {
            const linkedChildren = await ctx.db.query.deployments.findMany({
              where: and(
                eq((deployments as any).llmApiKeySourceDeploymentId, id),
                eq(deployments.userId, ctx.user.id),
              ),
            });

            if (linkedChildren.length > 0) {
              const names = linkedChildren.map((c: any) => c.name).join(", ");
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `Cannot switch to BYOK: ${linkedChildren.length} deployment(s) are linked to this credit pool (${names}). Unlink them first.`,
              });
            }
          }

          // Revoke the old OpenRouter key
          if (!rawUpdates.llmApiKey) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "API key is required when switching to BYOK mode.",
            });
          }

          // Revoke the old provisioned key (best-effort, don't block)
          const oldKeyId = (existing as any).llmApiKeyId;
          if (oldKeyId) {
            revokeOpenRouterKey(oldKeyId).catch((err: unknown) => {
              logger.warn({ err, deploymentId: id, oldKeyId }, "Failed to revoke old OpenRouter key during mode switch");
            });
          }

          // Encrypt the new BYOK key
          updates.llmApiKey = encryptApiKey(rawUpdates.llmApiKey);
          updates.llmApiKeyId = null; // BYOK keys don't have an OpenRouter hash
          updates.llmCreditLimitDollars = null; // Clear credit plan for BYOK
          updates.llmApiKeySourceDeploymentId = null; // Clear any link
        }
      } else if (rawUpdates.llmApiKey) {
        // Mode didn't change but user provided a new API key — encrypt it
        updates.llmApiKey = encryptApiKey(rawUpdates.llmApiKey);
      }

      await (ctx.db as any).update(deployments)
        .set(updates)
        .where(and(eq(deployments.id, id), eq(deployments.userId, ctx.user.id)));

      return ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, id),
        with: { runtimeCatalogEntry: true },
      });
    }),

  // Stop deployment (scale to 0 replicas, PVC persists)
  stop: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      if (deployment.status !== "running") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot stop a deployment that is ${deployment.status}`,
        });
      }

      try {
        await stopDeployment(input.id);
        await (ctx.db as any).update(deployments)
          .set({ status: "stopped" })
          .where(eq(deployments.id, input.id));
        logger.info({ deploymentId: input.id }, "Deployment stopped");
      } catch (err) {
        logger.error({ deploymentId: input.id, err }, "Failed to stop deployment");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to stop deployment",
        });
      }

      return { success: true };
    }),

  // Start a stopped deployment (scale to 1 replica)
  start: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      if (deployment.status !== "stopped") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot start a deployment that is ${deployment.status}`,
        });
      }

      try {
        await (ctx.db as any).update(deployments)
          .set({ status: "creating" })
          .where(eq(deployments.id, input.id));

        await startDeployment(input.id);

        // Poll for pod readiness (fire-and-forget)
        void (async () => {
          try {
            let ready = false;
            for (let i = 0; i < 30; i++) {
              const podStatus = await getDeploymentPodStatus(input.id);
              if (podStatus.status === "running") { ready = true; break; }
              if (podStatus.status === "failed") break;
              await new Promise((r) => setTimeout(r, 2000));
            }
            await (ctx.db as any).update(deployments)
              .set({ status: ready ? "running" : "failed" })
              .where(eq(deployments.id, input.id));
            logger.info({ deploymentId: input.id, ready }, "Deployment start completed");
          } catch (err) {
            await (ctx.db as any).update(deployments)
              .set({ status: "failed", error: "Failed to confirm pod startup" })
              .where(eq(deployments.id, input.id));
            logger.error({ deploymentId: input.id, err }, "Failed to confirm start");
          }
        })();

        logger.info({ deploymentId: input.id }, "Deployment start initiated");
      } catch (err) {
        await (ctx.db as any).update(deployments)
          .set({ status: "stopped" })
          .where(eq(deployments.id, input.id));
        logger.error({ deploymentId: input.id, err }, "Failed to start deployment");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to start deployment",
        });
      }

      return { success: true };
    }),

  // Restart a running deployment (stop then start)
  restart: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      if (deployment.status !== "running") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot restart a deployment that is ${deployment.status}`,
        });
      }

      try {
        await (ctx.db as any).update(deployments)
          .set({ status: "creating" })
          .where(eq(deployments.id, input.id));

        // Fire-and-forget restart + status polling
        void (async () => {
          try {
            await restartDeployment(input.id);

            let ready = false;
            for (let i = 0; i < 30; i++) {
              const podStatus = await getDeploymentPodStatus(input.id);
              if (podStatus.status === "running") { ready = true; break; }
              if (podStatus.status === "failed") break;
              await new Promise((r) => setTimeout(r, 2000));
            }
            await (ctx.db as any).update(deployments)
              .set({ status: ready ? "running" : "failed" })
              .where(eq(deployments.id, input.id));
            logger.info({ deploymentId: input.id, ready }, "Deployment restart completed");
          } catch (err) {
            await (ctx.db as any).update(deployments)
              .set({ status: "failed", error: "Restart failed" })
              .where(eq(deployments.id, input.id));
            logger.error({ deploymentId: input.id, err }, "Failed to restart");
          }
        })();

        logger.info({ deploymentId: input.id }, "Deployment restart initiated");
      } catch (err) {
        logger.error({ deploymentId: input.id, err }, "Failed to initiate restart");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to restart deployment",
        });
      }

      return { success: true };
    }),

  // Cancel subscription (deployment stays active until billing period ends)
  cancel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const dep = deployment as any;

      if (dep.isFree) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Free deployments cannot be cancelled — they expire automatically",
        });
      }

      if (!dep.stripeSubscriptionId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No subscription linked to this deployment",
        });
      }

      if (dep.cancelledAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Deployment is already cancelled",
        });
      }

      // Schedule Stripe cancellation at period end
      const { cancelAt } = await cancelSubscriptionAtPeriodEnd(dep.stripeSubscriptionId);

      // Update DB with cancellation timestamps
      await (ctx.db as any).update(deployments)
        .set({
          cancelledAt: new Date().toISOString(),
          cancelAtPeriodEnd: cancelAt.toISOString(),
        })
        .where(eq(deployments.id, input.id));

      logger.info({ deploymentId: input.id, cancelAt: cancelAt.toISOString() }, "Deployment cancellation scheduled");

      return { success: true, cancelAt: cancelAt.toISOString() };
    }),

  // Reactivate a cancelled subscription (remove cancel_at_period_end)
  reactivate: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const dep = deployment as any;

      if (!dep.cancelledAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Deployment is not cancelled",
        });
      }

      if (!dep.stripeSubscriptionId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No subscription linked to this deployment",
        });
      }

      // Reactivate on Stripe
      await reactivateSubscription(dep.stripeSubscriptionId);

      // Clear cancellation timestamps
      await (ctx.db as any).update(deployments)
        .set({
          cancelledAt: null,
          cancelAtPeriodEnd: null,
        })
        .where(eq(deployments.id, input.id));

      logger.info({ deploymentId: input.id }, "Deployment reactivated");

      return { success: true };
    }),

  // Export deployment config files as a ZIP (base64-encoded)
  exportConfigs: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      if (deployment.status !== "running") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Deployment must be running to export configs",
        });
      }

      try {
        const result = await exportDeploymentConfigs(input.id);
        logger.info({ deploymentId: input.id }, "Config export completed");
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Export failed";
        logger.error({ deploymentId: input.id, err }, "Config export failed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message,
        });
      }
    }),

  // Delete deployment + K8s resources
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Fetch deployment first to get the OpenRouter key hash (for revocation)
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Check if this is a credit pool owner with linked deployments
      const dep = deployment as any;
      if (dep.llmMode === "included" && !dep.llmApiKeySourceDeploymentId) {
        // This is an owner — check for linked children
        const linkedChildren = await ctx.db.query.deployments.findMany({
          where: and(
            eq((deployments as any).llmApiKeySourceDeploymentId, input.id),
            eq(deployments.userId, ctx.user.id),
          ),
        });

        if (linkedChildren.length > 0) {
          const names = linkedChildren.map((c: any) => c.name).join(", ");
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Cannot delete: ${linkedChildren.length} deployment(s) are linked to this credit pool (${names}). Unlink or delete them first.`,
          });
        }
      }

      // Revoke the OpenRouter key if this is an owner "included" deployment (not linked)
      const llmMode = dep.llmMode;
      const keyId = dep.llmApiKeyId;
      const isLinked = !!dep.llmApiKeySourceDeploymentId;
      if (llmMode === "included" && keyId && !isLinked) {
        // Only revoke if this deployment owns the key (not linked)
        try {
          await revokeOpenRouterKey(keyId);
        } catch (err) {
          // Don't block deletion if revocation fails — log and continue
          logger.warn({ err, deploymentId: input.id, keyId }, "Failed to revoke OpenRouter key during delete");
        }
      }

      // Delete K8s resources
      await deleteDeployment(input.id);

      // Then delete from DB
      await (ctx.db as any).delete(deployments)
        .where(and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)));

      // Note: We do NOT reset freeDeploymentUsed — the free trial is one-time only

      return { success: true };
    }),
});
