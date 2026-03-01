import { z } from "zod";
import crypto from "crypto";
import { router, protectedProcedure } from "../middleware.js";
import { tables, dbDate, type DbClient } from "../../db/index.js";
import { eq, and, or, isNull } from "drizzle-orm";
import { createDeployment, deleteDeployment, stopDeployment, startDeployment, restartDeployment, getDeploymentPodStatus, getDeploymentStorageUsage, exportDeploymentConfigs, getDeploymentLogs, getCustomComponentsWithDefinitions, writeComponentToPvc, deleteComponentFromPvc } from "../../k8s/index.js";
import { validateComponentName, validateComponentDefinition } from "../../utils/componentResolver.js";
import { cancelSubscriptionAtPeriodEnd, cancelSubscriptionImmediately, reactivateSubscription, isStripeConfigured, listActiveSubscriptions } from "../../services/stripe.js";
import { customAlphabet } from "nanoid";

// K8s-safe alphabet: lowercase alphanumeric only (RFC 1123)
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
import { logger } from "../../utils/logger.js";
import { TRPCError } from "@trpc/server";
import { env } from "../../utils/env.js";
import { getHandlerOrNull } from "../../runtimes/index.js";
import type { DeploymentFields } from "../../runtimes/types.js";
import { encryptApiKey, decryptApiKey } from "../../utils/encryption.js";
import { provisionOpenRouterKey, revokeOpenRouterKey } from "../../utils/openrouter.js";
import { syncConfigsToPvc } from "../../services/configSync.js";
import { calculateMonthlyPriceCents } from "../../utils/pricing.js";
import { COMPONENT_LIBRARY } from "../../data/componentLibrary.js";

const { deployments, users, runtimeCatalog, platformCredentials, deploymentSkills } = tables;

/**
 * Helper: Check free deployment status for a user.
 * Returns whether the user has used their free deployment and if it's expired.
 */
async function checkFreeDeployment(db: DbClient, userId: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  });

  if (!user) {
    throw new TRPCError({ code: "NOT_FOUND", message: "User not found" });
  }

  const freeUsed = user.freeDeploymentUsed ?? false;

  // Check if free trial has expired
  let freeExpired = false;
  let freeExpiresAt: string | Date | null = null;

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
        eq(deployments.llmMode, "included"),
        isNull(deployments.llmApiKeySourceDeploymentId),
      ),
      orderBy: (d, { desc }) => [desc(d.createdAt)],
    });

    return result.map((d) => ({
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

  // Get component catalog (built-in + default library + PVC custom) for a deployment
  getComponentCatalog: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Built-in component metadata (9 primitives)
      const builtins = [
        { name: "card", description: "Simple card with title, subtitle, and body text" },
        { name: "data_table", description: "Table with column headers and data rows" },
        { name: "stat_grid", description: "Grid of metric cards with labels, values, and change indicators" },
        { name: "key_value", description: "List of key-value pairs" },
        { name: "code_block", description: "Syntax-highlighted code snippet" },
        { name: "alert", description: "Notification banner (info, success, warning, error)" },
        { name: "progress", description: "Progress bar with label and percentage" },
        { name: "image", description: "Image with optional alt text and caption" },
        { name: "layout", description: "Container that renders an array of child components" },
      ];

      // Custom/library components from PVC (only if pod is running)
      let customs: Array<{ name: string; description?: string; layout: Array<{ component: string; props: Record<string, unknown> }> }> = [];
      if (deployment.status === "running") {
        try {
          customs = await getCustomComponentsWithDefinitions(input.id);
        } catch (err) {
          logger.warn({ deploymentId: input.id, err }, "Failed to fetch custom components from PVC");
        }
      }

      return { builtins, customs };
    }),

  defineComponent: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string().optional(),
      layout: z.array(z.object({
        component: z.string(),
        props: z.record(z.string(), z.unknown()),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }
      if (deployment.status !== "running") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Deployment is not running" });
      }

      const nameErr = validateComponentName(input.name);
      if (nameErr) {
        throw new TRPCError({ code: "BAD_REQUEST", message: nameErr });
      }

      const definition = {
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        layout: input.layout,
      };

      const defErr = validateComponentDefinition(definition);
      if (defErr) {
        throw new TRPCError({ code: "BAD_REQUEST", message: defErr });
      }

      await writeComponentToPvc(input.id, input.name, definition);
      return { success: true, message: `Component "${input.name}" saved successfully.` };
    }),

  deleteComponent: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }
      if (deployment.status !== "running") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Deployment is not running" });
      }

      const deleted = await deleteComponentFromPvc(input.id, input.name);
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Component "${input.name}" not found.` });
      }
      return { success: true, message: `Component "${input.name}" deleted.` };
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
      telegramBotToken: z.string().optional(), // Pre-validated Telegram bot token (included in initial K8s Secret)
      messagingOnly: z.boolean().optional(), // If true, omit web-chat UI prompt (~1,250 tokens saved)
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

      // K8s requires lowercase RFC 1123 names for resources
      const deploymentId = nanoid();
      const now = new Date();
      const freeTrialExpiryDate = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      // Atomic guard: attempt to claim the free deployment slot.
      // This UPDATE only succeeds if freeDeploymentUsed is false/null,
      // preventing two concurrent requests from both getting a free deployment.
      const claimResult = await ctx.db.update(users)
        .set({
          freeDeploymentUsed: true,
          freeTrialExpiresAt: dbDate(freeTrialExpiryDate),
        })
        .where(and(
          eq(users.id, ctx.user.id),
          or(eq(users.freeDeploymentUsed, false), isNull(users.freeDeploymentUsed))
        ));

      const claimRows = (claimResult as any)?.rowsAffected ?? (claimResult as any)?.changes ?? (claimResult as any)?.[0]?.affectedRows ?? 0;
      const isFree = claimRows > 0;
      const freeExpiresAt = isFree ? dbDate(freeTrialExpiryDate) : null;

      // ── Link Stripe subscription if available ──────────────────────
      let stripeSubscriptionId: string | null = null;

      if (!isFree && isStripeConfigured()) {
        const currentUser = await ctx.db.query.users.findFirst({
          where: eq(users.id, ctx.user.id),
        });

        if (currentUser?.pendingStripeSubscriptionId) {
          stripeSubscriptionId = currentUser.pendingStripeSubscriptionId;

          // Clear the pending fields (consumed)
          await ctx.db.update(users)
            .set({
              pendingStripeSubscriptionId: null,
            })
            .where(eq(users.id, ctx.user.id));

          logger.info({ deploymentId, stripeSubscriptionId, userId: ctx.user.id }, "Linked pending Stripe subscription to deployment");
        }
      }

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

          if (sourceDeployment.llmMode !== "included" || !sourceDeployment.llmApiKey) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: "Source deployment does not have included credits configured",
            });
          }

          // Resolve to root owner (follow the chain if source is itself linked)
          let rootId = sourceDeployment.id;
          let rootDeployment = sourceDeployment;
          if (sourceDeployment.llmApiKeySourceDeploymentId) {
            const root = await ctx.db.query.deployments.findFirst({
              where: and(
                eq(deployments.id, sourceDeployment.llmApiKeySourceDeploymentId),
                eq(deployments.userId, ctx.user.id),
              ),
            });
            if (root) {
              rootId = root.id;
              rootDeployment = root;
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
          where: and(
            eq(deployments.id, resolvedSourceDeploymentId),
            eq(deployments.userId, ctx.user.id),
          ),
        });
        encryptedKey = rootDep?.llmApiKey || null;
      } else {
        encryptedKey = resolvedApiKey ? encryptApiKey(resolvedApiKey) : null;
      }

      // Free tier deployments get minimum specs (except 2GB RAM minimum)
      const FREE_TIER_SPECS = { cpuLimit: "1", memoryMb: 2048, storageMb: 20 };

      // Resolve final hardware specs
      const finalCpu = isFree ? FREE_TIER_SPECS.cpuLimit : (input.cpuLimit || catalogEntry.cpuLimit);
      const finalMemory = isFree ? FREE_TIER_SPECS.memoryMb : (input.memoryMb || catalogEntry.memoryMb);
      const finalStorage = isFree ? FREE_TIER_SPECS.storageMb : (input.storageMb || catalogEntry.storageMb);
      const monthlyPriceCents = isFree ? 0 : calculateMonthlyPriceCents(finalCpu, finalMemory, finalStorage);

      // Insert deployment — price calculated from hardware specs
      await ctx.db.insert(deployments).values({
        id: deploymentId,
        userId: ctx.user.id,
        name: input.name,
        runtime: catalogEntry.slug,
        image: input.image || catalogEntry.dockerImage,
        runtimeCatalogId: input.runtimeCatalogId,
        isFree,
        monthlyPriceCents,
        freeExpiresAt,
        cpuLimit: finalCpu,
        memoryMb: finalMemory,
        storageMb: finalStorage,
        llmMode: input.llmMode,
        llmProvider: resolvedProvider,
        llmModel: input.llmModel || (input.llmMode === "included" ? "openrouter/auto" : null),
        llmApiKey: encryptedKey,
        llmApiKeyId: resolvedApiKeyId,
        llmCreditLimitDollars: resolvedCreditLimit,
        llmApiKeySourceDeploymentId: resolvedSourceDeploymentId,
        systemPrompt: input.systemPrompt || null,
        stripeSubscriptionId,
        messagingOnly: input.messagingOnly ?? false,
        status: "pending",
      });

      // Free deployment claim was already handled atomically at the top of create
      // via the conditional UPDATE on users.freeDeploymentUsed (no separate update needed here).

      // Save Telegram bot token to platformCredentials (if provided during wizard)
      // This ensures the token is in the DB before deploy, so it gets included in
      // the initial K8s Secret — avoiding a post-deploy configSync restart cycle.
      if (input.telegramBotToken) {
        const encrypted = encryptApiKey(JSON.stringify({ botToken: input.telegramBotToken }));
        await ctx.db.insert(platformCredentials).values({
          id: nanoid(12),
          deploymentId,
          platformId: "telegram",
          credentials: encrypted,
        });
        logger.info({ deploymentId }, "Telegram credentials saved during create (pre-deploy)");
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
        cpuLimit: finalCpu,
        memoryMb: finalMemory,
        storageMb: finalStorage,
        monthlyPriceCents,
      }, "Deployment created (pending)");

      return deployment;
    }),

  // Deploy (triggers K8s deployment)
  deploy: protectedProcedure
    .input(z.string()) // deploymentId
    .mutation(async ({ ctx, input: deploymentId }) => {
      // Require email verification before deploying to prevent abuse
      if (!ctx.user.emailVerified) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Please verify your email before deploying. Check your inbox for a verification link.",
        });
      }

      // Atomic conditional update: only transition from "pending" or "stopped" or "failed"
      // This prevents race conditions from rapid button clicks causing double-deploys
      const validStartStates = ["pending", "stopped", "failed"];

      const result = await ctx.db.update(deployments)
        .set({ status: "creating", error: null })
        .where(and(
          eq(deployments.id, deploymentId),
          eq(deployments.userId, ctx.user.id),
          or(
            eq(deployments.status, "pending"),
            eq(deployments.status, "stopped"),
            eq(deployments.status, "failed")
          )
        ));

      // Check if update affected any rows (Drizzle returns different shapes per DB)
      const rowsAffected = (result as any)?.rowsAffected ?? (result as any)?.changes ?? (result as any)?.[0]?.affectedRows ?? 0;

      if (rowsAffected === 0) {
        // Either deployment doesn't exist, user doesn't own it, or it's already deploying
        const deployment = await ctx.db.query.deployments.findFirst({
          where: and(eq(deployments.id, deploymentId), eq(deployments.userId, ctx.user.id)),
        });

        if (!deployment) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
        }

        // Deployment exists but is in wrong state
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot deploy: deployment is already ${deployment.status}`,
        });
      }

      // Fetch the deployment for the rest of the logic
      const deployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, deploymentId),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Decrypt the API key for injection into K8s Secrets
      const rawApiKey = deployment.llmApiKey
        ? decryptApiKey(deployment.llmApiKey)
        : null;

      // Load and decrypt platform credentials from DB
      const platformCredsRows = await ctx.db.query.platformCredentials.findMany({
        where: eq(platformCredentials.deploymentId, deploymentId),
      });

      const platformCredsMap: Record<string, Record<string, string>> = {};
      for (const row of platformCredsRows) {
        try {
          const decrypted = decryptApiKey(row.credentials);
          platformCredsMap[row.platformId] = JSON.parse(decrypted);
        } catch (err) {
          logger.warn({ deploymentId, platformId: row.platformId, err }, "Failed to decrypt platform credentials — skipping");
        }
      }

      // Generate gateway token before renderConfigs so it can be included in the OpenClaw config
      const gatewayToken = crypto.randomBytes(32).toString("hex");

      // Build runtime handler data for K8s (config files + secret entries)
      const runtimeHandler = getHandlerOrNull(deployment.runtime);
      const deploymentFields: DeploymentFields = {
        id: deployment.id,
        runtime: deployment.runtime,
        name: deployment.name,
        description: deployment.description ?? null,
        systemPrompt: deployment.systemPrompt ?? null,
        llmMode: deployment.llmMode ?? "byok",
        llmProvider: deployment.llmProvider ?? "openrouter",
        llmModel: deployment.llmModel ?? null,
        llmApiKey: rawApiKey,
        platformCredentials: Object.keys(platformCredsMap).length > 0 ? platformCredsMap : undefined,
        gatewayToken,
      };
      const initialConfigs = runtimeHandler?.renderConfigs(deploymentFields) ?? [];
      const extraSecretEntries = runtimeHandler?.getSecretEntries(deploymentFields) ?? {};

      // Seed component library — write ~25 composite templates to PVC
      // Only runs on first deploy; user modifications are never overwritten by configSync.
      for (const comp of COMPONENT_LIBRARY) {
        initialConfigs.push({
          path: `/data/components/${comp.name}.json`,
          content: JSON.stringify(comp, null, 2),
        });
      }

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
            gatewayToken,
          });
          logger.info({ deploymentId }, "K8s createDeployment returned, updating status...");
          // Only update if still in transitional state (don't overwrite enforcement actions)
          await ctx.db.update(deployments)
            .set({ status: "running" })
            .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "creating")));
          logger.info({ deploymentId }, "Deployment succeeded - status set to running");
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown deployment error";
          await ctx.db.update(deployments)
            .set({ status: "failed", error: message })
            .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "creating")));
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
        allocatedGb: deployment.storageMb || 30,
      };
    }),

  // Get deployment logs from K8s pod
  getLogs: protectedProcedure
    .input(z.object({
      id: z.string(),
      tailLines: z.number().min(1).max(5000).default(200),
    }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }
      if (deployment.status !== "running") {
        return { logs: "", podName: null };
      }

      try {
        const result = await getDeploymentLogs(input.id, input.tailLines);
        return result;
      } catch (err) {
        logger.warn({ deploymentId: input.id, err }, "Failed to fetch logs");
        return { logs: "", podName: null };
      }
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
      messagingOnly: z.boolean().optional(),
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
      const currentMode = existing.llmMode;
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
          if (!existing.llmApiKeySourceDeploymentId) {
            const linkedChildren = await ctx.db.query.deployments.findMany({
              where: and(
                eq(deployments.llmApiKeySourceDeploymentId, id),
                eq(deployments.userId, ctx.user.id),
              ),
            });

            if (linkedChildren.length > 0) {
              const names = linkedChildren.map((c) => c.name).join(", ");
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
          const oldKeyId = existing.llmApiKeyId;
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

      // Recalculate price if hardware specs changed
      if (updates.cpuLimit || updates.memoryMb || updates.storageMb) {
        const newCpu = updates.cpuLimit || existing.cpuLimit;
        const newMemory = updates.memoryMb || existing.memoryMb;
        const newStorage = updates.storageMb || existing.storageMb;
        if (!existing.isFree) {
          updates.monthlyPriceCents = calculateMonthlyPriceCents(newCpu, newMemory, newStorage);
        }
      }

      await ctx.db.update(deployments)
        .set(updates)
        .where(and(eq(deployments.id, id), eq(deployments.userId, ctx.user.id)));

      // Config sync: push updated configs to PVC if deployment is running
      if (existing.status === "running") {
        void syncConfigsToPvc(id);
      }

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
        // Set transitional status first
        await ctx.db.update(deployments)
          .set({ status: "stopping" })
          .where(eq(deployments.id, input.id));

        await stopDeployment(input.id);

        await ctx.db.update(deployments)
          .set({ status: "stopped" })
          .where(eq(deployments.id, input.id));
        logger.info({ deploymentId: input.id }, "Deployment stopped");
      } catch (err) {
        // Roll back transitional status so the deployment isn't stuck in "stopping"
        try {
          await ctx.db.update(deployments)
            .set({ status: "running" })
            .where(and(eq(deployments.id, input.id), eq(deployments.status, "stopping")));
        } catch (rollbackErr) {
          logger.error({ deploymentId: input.id, rollbackErr }, "Failed to roll back stopping status");
        }
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

      if (deployment.status !== "stopped" && deployment.status !== "failed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot start a deployment that is ${deployment.status}`,
        });
      }

      // When recovering from "failed", use restart (stop+start) to force a fresh pod
      // and reset CrashLoopBackOff backoff timers. Plain startDeployment() would be a
      // no-op if the pod is already at replicas=1 but crashing.
      const wasFailedState = deployment.status === "failed";

      try {
        await ctx.db.update(deployments)
          .set({ status: "creating", error: null })
          .where(eq(deployments.id, input.id));

        if (wasFailedState) {
          await restartDeployment(input.id);
        } else {
          await startDeployment(input.id);
        }

        // Poll for pod readiness (fire-and-forget)
        void (async () => {
          try {
            // Brief delay to let transitional status be visible in UI
            await new Promise((r) => setTimeout(r, 1500));

            let ready = false;
            for (let i = 0; i < 30; i++) {
              const podStatus = await getDeploymentPodStatus(input.id);
              if (podStatus.status === "running") { ready = true; break; }
              if (podStatus.status === "failed") break;
              await new Promise((r) => setTimeout(r, 2000));
            }
            // Only update if still in transitional state (don't overwrite enforcement actions)
            await ctx.db.update(deployments)
              .set({ status: ready ? "running" : "failed" })
              .where(and(eq(deployments.id, input.id), eq(deployments.status, "creating")));
            logger.info({ deploymentId: input.id, ready }, "Deployment start completed");
          } catch (err) {
            await ctx.db.update(deployments)
              .set({ status: "failed", error: "Failed to confirm pod startup" })
              .where(and(eq(deployments.id, input.id), eq(deployments.status, "creating")));
            logger.error({ deploymentId: input.id, err }, "Failed to confirm start");
          }
        })();

        logger.info({ deploymentId: input.id, wasFailedState }, "Deployment start initiated");
      } catch (err) {
        await ctx.db.update(deployments)
          .set({ status: "stopped", error: "Failed to start deployment" })
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

      if (deployment.status !== "running" && deployment.status !== "failed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot restart a deployment that is ${deployment.status}`,
        });
      }

      try {
        await ctx.db.update(deployments)
          .set({ status: "restarting" })
          .where(eq(deployments.id, input.id));

        // Fire-and-forget restart + status polling
        void (async () => {
          try {
            await restartDeployment(input.id);

            // Brief delay to let transitional status be visible in UI
            await new Promise((r) => setTimeout(r, 1500));

            let ready = false;
            for (let i = 0; i < 30; i++) {
              const podStatus = await getDeploymentPodStatus(input.id);
              if (podStatus.status === "running") { ready = true; break; }
              if (podStatus.status === "failed") break;
              await new Promise((r) => setTimeout(r, 2000));
            }
            // Only update if still in transitional state (don't overwrite enforcement actions)
            await ctx.db.update(deployments)
              .set({ status: ready ? "running" : "failed" })
              .where(and(eq(deployments.id, input.id), eq(deployments.status, "restarting")));
            logger.info({ deploymentId: input.id, ready }, "Deployment restart completed");
          } catch (err) {
            await ctx.db.update(deployments)
              .set({ status: "failed", error: "Restart failed" })
              .where(and(eq(deployments.id, input.id), eq(deployments.status, "restarting")));
            logger.error({ deploymentId: input.id, err }, "Failed to restart");
          }
        })();

        logger.info({ deploymentId: input.id }, "Deployment restart initiated");
      } catch (err) {
        // Roll back transitional status so the deployment isn't stuck in "restarting"
        try {
          await ctx.db.update(deployments)
            .set({ status: "running" })
            .where(and(eq(deployments.id, input.id), eq(deployments.status, "restarting")));
        } catch (rollbackErr) {
          logger.error({ deploymentId: input.id, rollbackErr }, "Failed to roll back restarting status");
        }
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

      if (deployment.isFree) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Free deployments cannot be cancelled — they expire automatically",
        });
      }

      if (!deployment.stripeSubscriptionId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No subscription linked to this deployment",
        });
      }

      if (deployment.cancelledAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Deployment is already cancelled",
        });
      }

      // Schedule Stripe cancellation at period end
      const { cancelAt } = await cancelSubscriptionAtPeriodEnd(deployment.stripeSubscriptionId);

      // Update DB with cancellation timestamps
      await ctx.db.update(deployments)
        .set({
          cancelledAt: dbDate(),
          cancelAtPeriodEnd: dbDate(cancelAt),
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

      if (!deployment.cancelledAt) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Deployment is not cancelled",
        });
      }

      if (!deployment.stripeSubscriptionId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No subscription linked to this deployment",
        });
      }

      // Reactivate on Stripe
      await reactivateSubscription(deployment.stripeSubscriptionId);

      // Clear cancellation timestamps
      await ctx.db.update(deployments)
        .set({
          cancelledAt: null,
          cancelAtPeriodEnd: null,
        })
        .where(eq(deployments.id, input.id));

      logger.info({ deploymentId: input.id }, "Deployment reactivated");

      return { success: true };
    }),

  // Link a Stripe subscription to a deployment (fallback if pending link was missed)
  linkSubscription: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      if (deployment.stripeSubscriptionId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Deployment already has a subscription linked",
        });
      }

      if (deployment.isFree) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Cannot link subscription to a free deployment",
        });
      }

      // Check if user has a pending subscription from checkout
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.user.id),
      });

      const pendingSub = user?.pendingStripeSubscriptionId;

      if (pendingSub) {
        // Use pending subscription
        await ctx.db.update(deployments)
          .set({ stripeSubscriptionId: pendingSub })
          .where(eq(deployments.id, input.deploymentId));

        // Clear pending
        await ctx.db.update(users)
          .set({ pendingStripeSubscriptionId: null })
          .where(eq(users.id, ctx.user.id));

        logger.info({ deploymentId: input.deploymentId, subscriptionId: pendingSub }, "Subscription linked to deployment (from pending)");
        return { success: true, subscriptionId: pendingSub };
      }

      // Fallback: look up active subscriptions via Stripe API
      if (!isStripeConfigured() || !user?.stripeCustomerId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No pending subscription found. Please subscribe first.",
        });
      }

      const activeSubs = await listActiveSubscriptions(user!.stripeCustomerId!);

      // Find an unlinked subscription (not already used by another deployment)
      const userDeployments = await ctx.db.query.deployments.findMany({
        where: eq(deployments.userId, ctx.user.id),
      });
      const usedSubIds = new Set(
        userDeployments.map((d) => d.stripeSubscriptionId).filter(Boolean)
      );

      const unlinked = activeSubs.find(s => !usedSubIds.has(s.id));
      if (!unlinked) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No unlinked active subscription found. Please subscribe first.",
        });
      }

      await ctx.db.update(deployments)
        .set({ stripeSubscriptionId: unlinked.id })
        .where(eq(deployments.id, input.deploymentId));

      logger.info({ deploymentId: input.deploymentId, subscriptionId: unlinked.id }, "Subscription linked to deployment (from Stripe API)");
      return { success: true, subscriptionId: unlinked.id };
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
      logger.info({ deploymentId: input.id, userId: ctx.user.id }, "delete: request received");

      // Fetch deployment first to get the OpenRouter key hash (for revocation)
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        logger.warn({ deploymentId: input.id, userId: ctx.user.id }, "delete: deployment not found");
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      logger.debug({ deploymentId: input.id, status: deployment.status, llmMode: deployment.llmMode, isFree: deployment.isFree }, "delete: deployment found");

      // Check if this is a credit pool owner with linked deployments
      if (deployment.llmMode === "included" && !deployment.llmApiKeySourceDeploymentId) {
        const linkedChildren = await ctx.db.query.deployments.findMany({
          where: and(
            eq(deployments.llmApiKeySourceDeploymentId, input.id),
            eq(deployments.userId, ctx.user.id),
          ),
        });

        if (linkedChildren.length > 0) {
          const names = linkedChildren.map((c) => c.name).join(", ");
          logger.warn({ deploymentId: input.id, linkedCount: linkedChildren.length }, "delete: blocked — credit pool has linked children");
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `Cannot delete: ${linkedChildren.length} deployment(s) are linked to this credit pool (${names}). Unlink or delete them first.`,
          });
        }
      }

      // Revoke the OpenRouter key if this is an owner "included" deployment (not linked)
      const llmMode = deployment.llmMode;
      const keyId = deployment.llmApiKeyId;
      const isLinked = !!deployment.llmApiKeySourceDeploymentId;
      if (llmMode === "included" && keyId && !isLinked) {
        logger.debug({ deploymentId: input.id, keyId }, "delete: revoking OpenRouter key");
        try {
          await revokeOpenRouterKey(keyId);
          logger.debug({ deploymentId: input.id, keyId }, "delete: OpenRouter key revoked");
        } catch (err) {
          logger.warn({ err, deploymentId: input.id, keyId }, "delete: failed to revoke OpenRouter key — continuing");
        }
      }

      // Cancel Stripe subscription if one exists (prevent orphaned billing).
      // This MUST succeed before we delete anything — otherwise the user gets
      // billed for a resource that no longer exists and has no way to cancel it.
      if (deployment.stripeSubscriptionId && isStripeConfigured()) {
        logger.debug({ deploymentId: input.id, subscriptionId: deployment.stripeSubscriptionId }, "delete: cancelling Stripe subscription");
        try {
          await cancelSubscriptionImmediately(deployment.stripeSubscriptionId);
          logger.debug({ deploymentId: input.id }, "delete: Stripe subscription cancelled");
        } catch (err) {
          logger.error({ err, deploymentId: input.id, subscriptionId: deployment.stripeSubscriptionId }, "delete: failed to cancel Stripe subscription — aborting deletion");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to cancel subscription. Please try again or contact support.",
          });
        }
      }

      // Delete K8s resources first — if this throws, we abort and leave the DB record intact
      // so the user can retry. Step-by-step logs are inside deleteDeployment.
      logger.info({ deploymentId: input.id }, "delete: starting K8s resource cleanup");
      await deleteDeployment(input.id);
      logger.info({ deploymentId: input.id }, "delete: K8s cleanup complete, removing DB records");

      // Explicitly clean up child rows — SQLite doesn't enforce FK cascades by default
      const credResult = await ctx.db.delete(platformCredentials)
        .where(eq(platformCredentials.deploymentId, input.id));
      logger.debug({ deploymentId: input.id, rows: (credResult as any)?.changes ?? (credResult as any)?.rowsAffected ?? "?" }, "delete: platform_credentials removed");

      const skillsResult = await ctx.db.delete(deploymentSkills)
        .where(eq(deploymentSkills.deploymentId, input.id));
      logger.debug({ deploymentId: input.id, rows: (skillsResult as any)?.changes ?? (skillsResult as any)?.rowsAffected ?? "?" }, "delete: deployment_skills removed");

      await ctx.db.delete(deployments)
        .where(and(eq(deployments.id, input.id), eq(deployments.userId, ctx.user.id)));
      logger.debug({ deploymentId: input.id }, "delete: deployments row removed");

      // Note: We do NOT reset freeDeploymentUsed — the free trial is one-time only

      logger.info({ deploymentId: input.id, userId: ctx.user.id }, "delete: deployment fully deleted");

      return { success: true };
    }),
});
