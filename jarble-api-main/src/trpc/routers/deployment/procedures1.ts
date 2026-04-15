import { z } from "zod";
import crypto from "crypto";
import { protectedProcedure, publicProcedure } from "../../middleware.js";
import { tables, dbDate } from "../../../db/index.js";
import { eq, and, or, isNull, sql, inArray } from "drizzle-orm";
import { createDeployment, deleteDeployment, stopDeployment, startDeployment, restartDeployment, getDeploymentPodStatus, getDeploymentStorageUsage, exportDeploymentConfigs, getDeploymentLogs, getCustomComponentsWithDefinitions, writeComponentToPvc, deleteComponentFromPvc, findPodForDeployment, execInPod, appsApi, NAMESPACE } from "../../../k8s/index.js";
import { ensureCapacityForDeployment, checkScaleDown, getCapacityStatus, CapacityError, SERVER_TYPES } from "../../../k8s/nodeManager.js";
import type { ManagedBy, IsolationLevel } from "../../../k8s/constants.js";
import { getPvcMountPath, getContainerName, getContainerHome } from "../../../k8s/constants.js";
import { validateComponentName, validateComponentDefinition } from "../../../utils/componentResolver.js";
import { cancelSubscriptionAtPeriodEnd, cancelSubscriptionImmediately, reactivateSubscription, isStripeConfigured, listActiveSubscriptions } from "../../../services/stripe.js";
import { customAlphabet } from "nanoid";

// K8s-safe alphabet: lowercase alphanumeric only (RFC 1123)
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
import { logger } from "../../../utils/logger.js";
import { TRPCError } from "@trpc/server";
import { env } from "../../../utils/env.js";
import { getHandlerOrNull } from "../../../runtimes/index.js";
import type { DeploymentFields } from "../../../runtimes/types.js";
import { encryptApiKey, decryptApiKey } from "../../../utils/encryption.js";
import { provisionOpenRouterKey, revokeOpenRouterKey } from "../../../utils/openrouter.js";
import { syncConfigsToPvc } from "../../../services/configSync.js";
import { safeFireAndForget } from "../../../utils/safeAsync.js";
import { enqueueLifecycleJob } from "../../../services/lifecycleJobs.js";
import { calculateMonthlyPriceCents } from "../../../utils/pricing.js";
import { seedPlatformAgents } from "../../../services/platformAgents.js";
import { COMPONENT_LIBRARY } from "../../../data/componentLibrary.js";
import { isAdmin } from "../../../utils/admin.js";
import { RESOURCE_TIERS } from "../../../k8s/constants.js";
import { validateThemeConfig, COMPONENT_MANIFEST } from "@jarble/component-manifest";
import { noHtmlTags, NO_HTML_MESSAGE } from "../../../utils/sanitize.js";
import { requireOrgRole } from "../org.js";
import type { OrgRole } from "../org.js";
import { findDeploymentWithAccess } from "./helpers.js";

const { deployments, users, runtimeCatalog, platformCredentials, deploymentSkills, chatSessions, chatMessages, agentCalls, orchestrationFlows, orgMembers, organizations, deploymentSecrets, promoRedemptions } = tables;

export const procedures1 = {

  // Get cluster capacity status (for frontend "X of Y slots available" display)
  getCapacity: publicProcedure.query(async () => {
    try {
      return await getCapacityStatus();
    } catch (err) {
      logger.warn({ err: err instanceof Error ? err.message : err }, "Failed to get capacity status");
      // Return a safe default so the frontend doesn't break
      return {
        totalNodes: 0,
        managedNodes: 0,
        maxManagedNodes: 0,
        availableSlots: 0,
        nodes: [],
      };
    }
  }),

  // List user's deployments (personal + org-owned)
  list: protectedProcedure.query(async ({ ctx }) => {
    // Get user's org memberships (including role for visibility filtering)
    const memberships = await ctx.db.query.orgMembers.findMany({
      where: eq(orgMembers.userId, ctx.user.id),
      columns: { orgId: true, role: true },
    });
    const orgIds = memberships.map((m: any) => m.orgId);

    const result = await ctx.db.query.deployments.findMany({
      where: orgIds.length > 0
        ? or(eq(deployments.userId, ctx.user.id), inArray(deployments.orgId, orgIds))
        : eq(deployments.userId, ctx.user.id),
      with: { runtimeCatalogEntry: true },
      orderBy: (d, { desc }) => [desc(d.createdAt)],
    });

    // Filter by visibility for member-role users (members can't see "admin" visibility deployments)
    const memberOrgIds = new Set<string>();
    for (const m of memberships) {
      if ((m as any).role === "member") {
        memberOrgIds.add(m.orgId);
      }
    }

    const filtered = result.filter((d: any) => {
      // Personal deployments: always show
      if (!d.orgId) return true;
      // If user is member (not admin/owner) in this org, hide admin-only deployments
      if (memberOrgIds.has(d.orgId) && d.visibility === "admin") return false;
      return true;
    });

    return filtered;
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

  // Assign or unassign a deployment to/from an organization
  assignToOrg: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      orgId: z.string().nullable(), // null to unassign (return to personal)
    }))
    .mutation(async ({ ctx, input }) => {
      // Only the creator (not arbitrary org members) can assign/unassign the deployment
      // to/from an org. We intentionally check userId here instead of using
      // findDeploymentWithAccess: transferring ownership between orgs is a creator-only
      // action, not something any admin/owner of the current org should be able to do.
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Verify org role (owner/admin) if assigning
      if (input.orgId) {
        await requireOrgRole(ctx.db, ctx.user.id, input.orgId, ["owner", "admin"]);
      }

      await ctx.db.update(deployments).set({ orgId: input.orgId }).where(eq(deployments.id, input.deploymentId));

      return { success: true };
    }),

  // Link a deployment to a credit pool (another deployment's managed key)
  linkToPool: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      sourceDeploymentId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Child: org admins/owners can link one of their org's deployments to a pool.
      // Pool owner source: must be directly owned by the caller — cross-user credit
      // pool sharing is not supported.
      const { deployment: child } = await findDeploymentWithAccess(
        ctx.db,
        input.deploymentId,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );
      const owner = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.sourceDeploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!owner) throw new TRPCError({ code: "NOT_FOUND", message: "Pool owner not found" });
      if ((owner as any).llmMode !== "included") throw new TRPCError({ code: "BAD_REQUEST", message: "Target deployment does not use included credits" });
      if ((owner as any).llmApiKeySourceDeploymentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Target is itself linked - cannot chain pools" });
      if ((child as any).llmApiKeySourceDeploymentId) throw new TRPCError({ code: "BAD_REQUEST", message: "This deployment is already linked" });
      if (input.deploymentId === input.sourceDeploymentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Cannot link a deployment to itself" });

      await ctx.db.update(deployments)
        .set({ llmApiKeySourceDeploymentId: input.sourceDeploymentId, llmMode: "included", llmProvider: "openrouter" } as any)
        .where(eq(deployments.id, input.deploymentId));

      return { success: true };
    }),

  // Unlink a deployment from its credit pool
  unlinkFromPool: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { deployment: dep } = await findDeploymentWithAccess(
        ctx.db,
        input.deploymentId,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );
      if (!(dep as any).llmApiKeySourceDeploymentId) throw new TRPCError({ code: "BAD_REQUEST", message: "Not linked to a pool" });

      await ctx.db.update(deployments)
        .set({ llmApiKeySourceDeploymentId: null, llmMode: "byok", llmApiKey: null, llmApiKeyId: null } as any)
        .where(eq(deployments.id, input.deploymentId));

      return { success: true };
    }),

  // Get deployments linked to a pool owner
  getPoolChildren: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const children = await ctx.db.query.deployments.findMany({
        where: and(
          eq(deployments.llmApiKeySourceDeploymentId, input.deploymentId),
          eq(deployments.userId, ctx.user.id),
        ),
      });
      return children.map((d: any) => ({ id: d.id, name: d.name, runtime: d.runtime, status: d.status }));
    }),

  // Batch-fetch storage usage for multiple deployments (Dashboard storage meters)
  getStorageUsageBatch: protectedProcedure
    .input(z.object({ ids: z.array(z.string()).max(50) }))
    .query(async ({ ctx, input }) => {
      if (input.ids.length === 0) return {};

      // Verify access: user's own deployments + org deployments they belong to
      const memberships = await ctx.db.query.orgMembers.findMany({
        where: eq(orgMembers.userId, ctx.user.id),
        columns: { orgId: true },
      });
      const orgIds = memberships.map((m: any) => m.orgId);

      const userDeps = await ctx.db.query.deployments.findMany({
        where: orgIds.length > 0
          ? or(eq(deployments.userId, ctx.user.id), inArray(deployments.orgId, orgIds))
          : eq(deployments.userId, ctx.user.id),
        columns: { id: true, managedBy: true },
      });
      const ownedIds = new Set(userDeps.map((d: { id: string }) => d.id));
      const managedByMap = new Map(userDeps.map((d: { id: string; managedBy: string | null }) => [d.id, d.managedBy]));

      const results: Record<string, { usedGb: number; totalGb: number; percentUsed: number } | null> = {};
      const fetches = input.ids
        .filter((id) => ownedIds.has(id))
        .map(async (id) => {
          try {
            const usage = await getDeploymentStorageUsage(id, (managedByMap.get(id) as ManagedBy) ?? "legacy");
            results[id] = usage ? { usedGb: usage.usedGb, totalGb: usage.totalGb, percentUsed: usage.percentUsed } : null;
          } catch {
            results[id] = null;
          }
        });

      await Promise.allSettled(fetches);
      return results;
    }),

  // Get single deployment
  getById: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id);
      return deployment;
    }),

  // Get component catalog (built-in + default library + PVC custom) for a deployment
  getComponentCatalog: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify access (org members can view too)
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id);

      // Built-in component metadata - derived from the canonical component manifest
      const builtins = Object.entries(COMPONENT_MANIFEST).map(([name, entry]) => ({
        name,
        description: entry.description,
      }));

      // Custom/library components from PVC (only if pod is running)
      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
      let customs: Array<{ name: string; description?: string; layout: Array<{ component: string; props: Record<string, unknown> }> }> = [];
      if (deployment.status === "running") {
        try {
          customs = await getCustomComponentsWithDefinitions(input.id, managedBy);
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
      description: z.string().max(5000).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
      layout: z.array(z.object({
        component: z.string(),
        props: z.record(z.string(), z.unknown()),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id, {
        requireRole: ["owner", "admin"],
      });
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

      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
      await writeComponentToPvc(input.id, input.name, definition, managedBy);
      return { success: true, message: `Component "${input.name}" saved successfully.` };
    }),

  deleteComponent: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id, {
        requireRole: ["owner", "admin"],
      });
      if (deployment.status !== "running") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Deployment is not running" });
      }

      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
      const deleted = await deleteComponentFromPvc(input.id, input.name, managedBy);
      if (!deleted) {
        throw new TRPCError({ code: "NOT_FOUND", message: `Component "${input.name}" not found.` });
      }
      return { success: true, message: `Component "${input.name}" deleted.` };
    }),

  // Create deployment (DB record only, doesn't deploy)
  create: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(255).refine(noHtmlTags, NO_HTML_MESSAGE),
      runtimeCatalogId: z.number(),
      platform: z.string().optional(),
      image: z.string().optional(),
      llmMode: z.enum(["included", "byok", "platform"]).default("byok"),
      llmProvider: z.enum(["openrouter", "openai", "anthropic", "google"]).default("openrouter"),
      llmModel: z.string().optional(), // e.g. "openrouter/auto", "gpt-4o", "claude-sonnet-4-20250514"
      llmApiKey: z.string().optional(),
      // systemPrompt intentionally permits HTML characters (no noHtmlTags refine):
      //   1. It's LLM input, not user-facing content — sent to the model as instructions
      //   2. Legitimate prompts need `<` for code examples, JSX/HTML discussions, etc.
      //   3. Only rendered in frontend <textarea value={...}> which React auto-escapes
      // If this ever surfaces in emails/admin dashboards/logs, escape at render time there.
      systemPrompt: z.string().max(50_000).optional(), // 50K chars max to prevent storage bloat
      creditLimitDollars: z.number().min(1).max(1000).optional(), // Monthly spending cap for "included" mode (default $5)
      linkToDeploymentId: z.string().optional(), // Link to an existing deployment's credit pool instead of provisioning a new key
      cpuLimit: z.string().optional(),    // e.g. "2.0" - overrides runtime catalog default
      memoryMb: z.number().int().positive().optional(),   // e.g. 2048 - RAM in MB
      storageMb: z.number().int().positive().max(500).optional(),  // e.g. 30 - storage in GiB (historical naming). Max 500 GiB to prevent runaway provisioning.
      telegramBotToken: z.string().optional(), // Pre-validated Telegram bot token (included in initial K8s Secret)
      messagingOnly: z.boolean().optional(), // If true, omit web-chat UI prompt (~1,250 tokens saved)
      isolationLevel: z.enum(["standard", "gvisor", "kata"]).optional(), // Runtime sandbox isolation (default: "standard")
      deploymentType: z.enum(["agent", "container", "website"]).default("agent"), // Scheduling type: agent (dedicated VPS), container/website (shared pool)
      orgId: z.string().nullish(), // Assign to org on creation (optional)
    }))
    .mutation(async ({ ctx, input }) => {
      // ── Wave 4 Layer A — pre-flight PVC size validation ─────────────
      // PVC size larger than the largest autoscaler tier's available
      // disk would otherwise hang at Longhorn replica scheduling
      // forever (LocalReplicaSchedulingFailure: insufficient storage),
      // because the volume stays detached and the pod stays Init:0/1
      // until the create-poll times out and flips the deployment to
      // "failed" with no actionable error. Reject early instead.
      //
      // Disk math: each Hetzner tier's root disk minus ~11 GiB of
      // overhead (OS + kubelet + containerd + Longhorn DS + safety
      // margin) is what Longhorn actually advertises as schedulable.
      // We import SERVER_TYPES from nodeManager.ts so this stays in
      // sync automatically when a new tier is added.
      //
      // DO NOT REMOVE this block: storageMb is historically named in
      // GiB, and the slider in the wizard goes higher than what any
      // currently-provisioned tier can host.
      const LARGEST_TIER_USABLE_GB = SERVER_TYPES[SERVER_TYPES.length - 1]!.usableLonghornGb;
      const requestedStorageGb = input.storageMb ?? 20; // historical: storageMb is GiB
      if (requestedStorageGb > LARGEST_TIER_USABLE_GB) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Storage size ${requestedStorageGb} GiB exceeds the maximum available on any auto-scaled worker tier (${LARGEST_TIER_USABLE_GB} GiB). Reduce the storage slider or contact support to request a larger node tier.`,
        });
      }

      // Verify org role (owner/admin) if orgId provided
      if (input.orgId) {
        await requireOrgRole(ctx.db, ctx.user.id, input.orgId, ["owner", "admin"]);
      }

      // Platform mode is admin-only
      if (input.llmMode === "platform" && !isAdmin(ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Platform LLM mode is restricted to administrators" });
      }

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

      let resolvedSystemPrompt = input.systemPrompt || null;
      let resolvedThemeConfig: string | null = null;
      let resolvedLlmModel = input.llmModel;

      // K8s requires lowercase RFC 1123 names for resources
      const deploymentId = nanoid();

      // ── Link Stripe subscription if available ──────────────────────
      let stripeSubscriptionId: string | null = null;

      if (isStripeConfigured()) {
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

      // Resolve final hardware specs
      const finalCpu = input.cpuLimit || catalogEntry.cpuLimit;
      const finalMemory = input.memoryMb || catalogEntry.memoryMb;
      const finalStorage = input.storageMb || catalogEntry.storageMb;
      const monthlyPriceCents = calculateMonthlyPriceCents(finalCpu, finalMemory, finalStorage);

      // Insert deployment - price calculated from hardware specs
      await ctx.db.insert(deployments).values({
        id: deploymentId,
        userId: ctx.user.id,
        name: input.name,
        runtime: catalogEntry.slug,
        image: input.image || catalogEntry.dockerImage,
        runtimeCatalogId: input.runtimeCatalogId,
        monthlyPriceCents,
        cpuLimit: finalCpu,
        memoryMb: finalMemory,
        storageMb: finalStorage,
        llmMode: input.llmMode,
        llmProvider: resolvedProvider,
        llmModel: resolvedLlmModel || (input.llmMode === "included" ? "openrouter/auto" : null),
        llmApiKey: encryptedKey,
        llmApiKeyId: resolvedApiKeyId,
        llmCreditLimitDollars: resolvedCreditLimit,
        llmApiKeySourceDeploymentId: resolvedSourceDeploymentId,
        systemPrompt: resolvedSystemPrompt,
        themeConfig: resolvedThemeConfig,
        stripeSubscriptionId,
        messagingOnly: input.messagingOnly ?? false,
        isolationLevel: input.isolationLevel || "standard",
        deploymentType: input.deploymentType,
        isPlatform: input.llmMode === "platform",
        orgId: input.orgId ?? null,
        status: "pending",
      });

      // Save Telegram bot token to platformCredentials (if provided during wizard)
      // This ensures the token is in the DB before deploy, so it gets included in
      // the initial K8s Secret - avoiding a post-deploy configSync restart cycle.
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

      // Seed default platform agents (component, data, workflow) - non-fatal
      await seedPlatformAgents(ctx.db, deploymentId);

      const deployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, deploymentId),
        with: { runtimeCatalogEntry: true },
      });

      logger.info({
        deploymentId,
        userId: ctx.user.id,
        runtime: catalogEntry.slug,
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

      // Access + role check (allows org owner/admin to deploy as well). Throws
      // NOT_FOUND or FORBIDDEN as appropriate.
      await findDeploymentWithAccess(ctx.db, deploymentId, ctx.user.id, {
        requireRole: ["owner", "admin"],
      });

      // Atomic conditional update: only transition from "pending" or "stopped" or "failed"
      // This prevents race conditions from rapid button clicks causing double-deploys
      const validStartStates = ["pending", "stopped", "failed"];

      const result = await ctx.db.update(deployments)
        .set({ status: "creating", error: null })
        .where(and(
          eq(deployments.id, deploymentId),
          or(
            eq(deployments.status, "pending"),
            eq(deployments.status, "stopped"),
            eq(deployments.status, "failed")
          )
        ));

      // Check if update affected any rows (Drizzle returns different shapes per DB)
      const rowsAffected = (result as any)?.rowCount ?? (result as any)?.rowsAffected ?? (result as any)?.changes ?? (result as any)?.[0]?.affectedRows ?? 0;

      if (rowsAffected === 0) {
        // Deployment exists (access check passed above) but is in wrong state
        const deployment = await ctx.db.query.deployments.findFirst({
          where: eq(deployments.id, deploymentId),
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
          logger.warn({ deploymentId, platformId: row.platformId, err }, "Failed to decrypt platform credentials - skipping");
        }
      }

      // Generate gateway token before renderConfigs so it can be included in the OpenClaw config
      const gatewayToken = crypto.randomBytes(32).toString("hex");

      // Determine management mode: operator (new deployments when enabled) vs legacy
      const managedBy: ManagedBy = process.env.USE_OPERATOR === "true" ? "operator" : "legacy";
      const pvcMount = getPvcMountPath(managedBy);

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
        managedBy,
      };
      const initialConfigs = runtimeHandler?.renderConfigs(deploymentFields) ?? [];
      const extraSecretEntries = runtimeHandler?.getSecretEntries(deploymentFields) ?? {};

      // Seed component library - write ~25 composite templates to PVC
      // Only runs on first deploy; user modifications are never overwritten by configSync.
      for (const comp of COMPONENT_LIBRARY) {
        initialConfigs.push({
          path: `${pvcMount}/components/${comp.name}.json`,
          content: JSON.stringify(comp, null, 2),
        });
      }

      // ── SYNCHRONOUS capacity check ──────────────────────────────────────
      // Blocks the response until capacity is confirmed or rejected.
      // If no existing node fits and we're at the Hetzner server limit,
      // the user gets an immediate error instead of a stuck "creating" deployment.
      // If provisioning is needed (under the limit), this blocks 2-4 min while
      // the new VPS boots and joins K3s.
      // Resolve deployment type for scheduling decisions
      const deploymentType = (deployment as any).deploymentType || "agent";

      // Wave 4 Layer B: granular status. Mark "provisioning_node" before
      // ensureCapacityForDeployment so the user can see if Hetzner is the
      // bottleneck. nodeManager.ts (Layer D) doesn't write status itself,
      // so the call site has to do it.
      await ctx.db.update(deployments)
        .set({ status: "provisioning_node" })
        .where(eq(deployments.id, deploymentId));

      let targetNode: string | undefined;
      try {
        targetNode = await ensureCapacityForDeployment(
          ctx.db,
          deployment.cpuLimit || "2.0",
          deployment.memoryMb || 3072,
          deploymentType,
          deploymentId,
          // storageMb is historically named — the value is GiB. Pass it through
          // so the autoscaler picks a tier whose root disk fits this PVC.
          deployment.storageMb || undefined,
        );
        if (targetNode) logger.info({ deploymentId, targetNode }, "Node capacity confirmed");
      } catch (capacityErr) {
        if (capacityErr instanceof CapacityError) {
          // At the server limit - revert status and return a clear error to the user
          await ctx.db.update(deployments)
            .set({ status: "failed", error: (capacityErr as Error).message })
            .where(eq(deployments.id, deploymentId));
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: (capacityErr as Error).message,
          });
        }
        // Transient failure (K8s API error, network issue, etc.) - log but proceed.
        // The K8s scheduler may still be able to place the pod on an existing node.
        logger.error({ deploymentId, err: capacityErr instanceof Error ? capacityErr.message : capacityErr },
          "Auto-scale capacity check failed, proceeding without node pinning");
      }

      // JAR-86: Enqueue a durable lifecycle job instead of firing off an
      // IIFE. The background worker (startLifecycleWorker) picks this up and
      // runs the createDeployment + readiness poll, surviving pod restarts.
      await enqueueLifecycleJob(ctx.db, {
        deploymentId,
        userId: ctx.user.id,
        type: "create",
        payload: {
          type: "create",
          managedBy,
          name: deployment.name,
          runtime: deployment.runtime,
          image: deployment.image || undefined,
          cpuLimit: deployment.cpuLimit || undefined,
          memoryMb: deployment.memoryMb || undefined,
          storageMb: deployment.storageMb || undefined,
          initialConfigs,
          extraSecretEntries,
          gatewayToken,
          isolationLevel: ((deployment as any).isolationLevel || "standard") as IsolationLevel,
          nodeName: targetNode,
          deploymentType,
        },
      });

      return { success: true, deploymentId };
    }),

  // Get pod status from K8s
  getStatus: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      let deployment;
      try {
        ({ deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id));
      } catch (err) {
        if (err instanceof TRPCError && err.code === "NOT_FOUND") {
          return { status: "not_found" };
        }
        throw err;
      }

      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
      return getDeploymentPodStatus(input.id, managedBy);
    }),

  // Get storage usage from K8s (exec df inside the pod)
  getStorageUsage: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify access (org members can view)
      let deployment;
      try {
        ({ deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id));
      } catch (err) {
        if (err instanceof TRPCError && err.code === "NOT_FOUND") {
          return null;
        }
        throw err;
      }
      if (!deployment) {
        return null;
      }

      // Get live usage from the pod + DB-configured limit
      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
      const usage = await getDeploymentStorageUsage(input.id, managedBy);
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
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id);
      if (deployment.status !== "running") {
        return { logs: "", podName: null };
      }

      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
      try {
        const result = await getDeploymentLogs(input.id, input.tailLines, managedBy);
        return result;
      } catch (err) {
        logger.warn({ deploymentId: input.id, err }, "Failed to fetch logs");
        return { logs: "", podName: null };
      }
    }),

  /**
   * List recent traces involving this deployment (JAR-51 debug drawer).
   *
   * Returns the last N distinct trace_ids where this deployment is either
   * the caller or the callee, with a short summary (timestamp, kind, skill,
   * status, duration) for each trace. The frontend debug drawer uses this
   * to render a list of recent activity, with the ability to drill down
   * into a single trace via `getAgentCallsByTrace`.
   */
  listRecentTraces: protectedProcedure
    .input(z.object({
      id: z.string(),
      limit: z.number().min(1).max(100).default(20),
    }))
    .query(async ({ ctx, input }) => {
      // Ownership check — uses findDeploymentWithAccess so org members
      // with read access via org_members can see traces for org-owned
      // deployments, not just the original creator. (Code-review P1-1.)
      await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id);

      // Fetch the most recent N depth-0 rows for this deployment. Depth-0
      // is the root of each trace (chat_turn or flow_step). We'll join
      // with the total span count per trace in a single aggregation.
      const rootCalls = await ctx.db
        .select({
          traceId: agentCalls.traceId,
          callId: agentCalls.id,
          kind: agentCalls.kind,
          skillName: agentCalls.skillName,
          spanName: agentCalls.spanName,
          status: agentCalls.status,
          durationMs: agentCalls.durationMs,
          createdAt: agentCalls.createdAt,
          callerDeploymentId: agentCalls.callerDeploymentId,
          calleeDeploymentId: agentCalls.calleeDeploymentId,
        })
        .from(agentCalls)
        .where(and(
          eq(agentCalls.depth, 0),
          sql`(${agentCalls.callerDeploymentId} = ${input.id} OR ${agentCalls.calleeDeploymentId} = ${input.id})`,
        ))
        .orderBy(sql`${agentCalls.createdAt} DESC`)
        .limit(input.limit);

      if (rootCalls.length === 0) return { traces: [] };

      // For each root trace, count total spans + max depth
      const traceIds = rootCalls.map((r) => r.traceId).filter(Boolean) as string[];
      const counts = traceIds.length > 0 ? await ctx.db
        .select({
          traceId: agentCalls.traceId,
          spanCount: sql<number>`count(*)::int`,
          maxDepth: sql<number>`max(${agentCalls.depth})::int`,
          totalCredits: sql<number>`coalesce(sum(${agentCalls.creditsCharged}), 0)::int`,
        })
        .from(agentCalls)
        .where(inArray(agentCalls.traceId, traceIds))
        .groupBy(agentCalls.traceId)
        : [];

      const countMap = new Map(counts.map((c) => [c.traceId, { spanCount: c.spanCount, maxDepth: c.maxDepth, totalCredits: c.totalCredits }]));

      return {
        traces: rootCalls.map((r) => ({
          traceId: r.traceId,
          rootCallId: r.callId,
          kind: r.kind,
          skillName: r.skillName,
          spanName: r.spanName,
          status: r.status,
          durationMs: r.durationMs,
          createdAt: r.createdAt,
          callerDeploymentId: r.callerDeploymentId,
          calleeDeploymentId: r.calleeDeploymentId,
          spanCount: countMap.get(r.traceId!)?.spanCount ?? 1,
          totalCredits: countMap.get(r.traceId!)?.totalCredits ?? 0,
          maxDepth: countMap.get(r.traceId!)?.maxDepth ?? 0,
        })),
      };
    }),

  /**
   * List team delegation sessions involving this deployment (Fractal Piece 6).
   *
   * Returns recent delegation calls where this deployment is either the
   * caller (it delegated to someone) or the callee (someone delegated to it).
   * Each row has the task, response preview, cost, duration, and the other
   * deployment's info — so the UI can show "t2 asked this bot to..." or
   * "this bot asked t1 to...".
   */
  listTeamSessions: protectedProcedure
    .input(z.object({
      id: z.string(),
      limit: z.number().min(1).max(100).default(30),
    }))
    .query(async ({ ctx, input }) => {
      await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id);

      const rows = await ctx.db
        .select({
          id: agentCalls.id,
          kind: agentCalls.kind,
          skillName: agentCalls.skillName,
          callerDeploymentId: agentCalls.callerDeploymentId,
          calleeDeploymentId: agentCalls.calleeDeploymentId,
          requestBody: agentCalls.requestBody,
          responseBody: agentCalls.responseBody,
          status: agentCalls.status,
          durationMs: agentCalls.durationMs,
          creditsCharged: agentCalls.creditsCharged,
          depth: agentCalls.depth,
          createdAt: agentCalls.createdAt,
        })
        .from(agentCalls)
        .where(and(
          eq(agentCalls.kind, "delegation"),
          sql`(${agentCalls.callerDeploymentId} = ${input.id} OR ${agentCalls.calleeDeploymentId} = ${input.id})`,
        ))
        .orderBy(sql`${agentCalls.createdAt} DESC`)
        .limit(input.limit);

      // Collect unique deployment IDs to look up names
      const depIds = new Set<string>();
      for (const r of rows) {
        if (r.callerDeploymentId) depIds.add(r.callerDeploymentId);
        if (r.calleeDeploymentId) depIds.add(r.calleeDeploymentId);
      }
      const depNames = new Map<string, string>();
      if (depIds.size > 0) {
        const deps = await ctx.db.query.deployments.findMany({
          where: inArray(deployments.id, Array.from(depIds)),
          columns: { id: true, name: true },
        });
        for (const d of deps) depNames.set(d.id, d.name);
      }

      return {
        sessions: rows.map((r) => {
          // Determine the "other" deployment from this one's perspective
          const isCaller = r.callerDeploymentId === input.id;
          const otherId = isCaller ? r.calleeDeploymentId : r.callerDeploymentId;
          return {
            id: r.id,
            direction: isCaller ? "sent" as const : "received" as const,
            otherDeploymentId: otherId,
            otherDeploymentName: otherId ? depNames.get(otherId) || otherId : null,
            skillName: r.skillName,
            task: (() => { try { return JSON.parse(r.requestBody || "{}").task?.slice(0, 300) || r.requestBody?.slice(0, 300); } catch { return r.requestBody?.slice(0, 300) || null; } })(),
            responsePreview: r.responseBody?.slice(0, 300) || null,
            status: r.status,
            durationMs: r.durationMs,
            costCents: r.creditsCharged,
            depth: r.depth,
            createdAt: r.createdAt,
          };
        }),
      };
    }),

  /**
   * Fetch the full agent_calls tree for a single trace (JAR-51 debug drawer).
   * Returns all rows for the given trace_id ordered by depth then created_at
   * so the caller can reconstruct the tree.
   *
   * Authorization: the trace must contain at least one row where the
   * authed user owns the caller or callee deployment.
   */
  getAgentCallsByTrace: protectedProcedure
    .input(z.object({
      traceId: z.string().regex(/^[a-f0-9]{32}$/, "traceId must be a 32-char hex W3C trace id"),
    }))
    .query(async ({ ctx, input }) => {
      // Code-review P1-2: deliberately exclude userId, spanId, parentSpanId
      // from the tRPC response. The frontend debug drawer doesn't render
      // these fields and they leak Auth0 ids + internal tracing ids over
      // the wire. userId is the most sensitive — in a cross-tenant
      // delegation trace (marketplace scenario) it would expose a
      // different user's Auth0 id to the caller.
      //
      // errorMessage is allowed through but truncated to 200 chars
      // below to avoid leaking stack traces / resource names.
      //
      // creditsCharged is kept since the user owns the deployment they
      // are inspecting. If cross-tenant data exposure becomes a concern
      // we can revisit.
      const rawRows = await ctx.db
        .select({
          id: agentCalls.id,
          parentCallId: agentCalls.parentCallId,
          kind: agentCalls.kind,
          skillName: agentCalls.skillName,
          spanName: agentCalls.spanName,
          depth: agentCalls.depth,
          status: agentCalls.status,
          durationMs: agentCalls.durationMs,
          createdAt: agentCalls.createdAt,
          callerDeploymentId: agentCalls.callerDeploymentId,
          calleeDeploymentId: agentCalls.calleeDeploymentId,
          traceId: agentCalls.traceId,
          spanId: agentCalls.spanId,
          // Content fields for the debug trace panel — capped to 5KB
          // for wire safety (full body available in Langfuse).
          requestBody: agentCalls.requestBody,
          responseBody: agentCalls.responseBody,
          // Retained for the auth gate below but stripped before return.
          userId: agentCalls.userId,
          errorMessage: agentCalls.errorMessage,
          creditsCharged: agentCalls.creditsCharged,
        })
        .from(agentCalls)
        .where(eq(agentCalls.traceId, input.traceId))
        .orderBy(sql`${agentCalls.depth} ASC, ${agentCalls.createdAt} ASC`);
      const rows = rawRows;

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No agent_calls rows found for this trace id" });
      }

      // Helper to strip sensitive fields from rows before sending to
      // the client (P1-2). Kept as a local function so every return
      // branch uses the same sanitization pass.
      const sanitize = (list: typeof rows) =>
        list.map(({ userId, spanId, errorMessage, requestBody, responseBody, ...rest }) => ({
          ...rest,
          errorMessage: errorMessage ? errorMessage.slice(0, 500) : null,
          requestBody: requestBody ? requestBody.slice(0, 5000) : null,
          responseBody: responseBody ? responseBody.slice(0, 5000) : null,
        }));

      // Ownership gate: the authed user must own at least one of the
      // caller/callee deployments referenced in the trace, OR the user_id
      // on any row must match.
      const userIdsInTrace = new Set(rows.map((r) => r.userId).filter(Boolean));
      if (userIdsInTrace.has(ctx.user.id)) {
        return { rows: sanitize(rows) };
      }
      const deploymentIdsInTrace = new Set<string>();
      for (const r of rows) {
        if (r.callerDeploymentId) deploymentIdsInTrace.add(r.callerDeploymentId);
        if (r.calleeDeploymentId) deploymentIdsInTrace.add(r.calleeDeploymentId);
      }
      if (deploymentIdsInTrace.size > 0) {
        const owned = await ctx.db.query.deployments.findMany({
          where: and(
            inArray(deployments.id, Array.from(deploymentIdsInTrace)),
            eq(deployments.userId, ctx.user.id),
          ),
          columns: { id: true },
        });
        if (owned.length > 0) {
          return { rows: sanitize(rows) };
        }
      }
      throw new TRPCError({ code: "FORBIDDEN", message: "You don't have access to this trace" });
    }),

  // Update deployment
  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).max(255).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
      description: z.string().max(5000).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
      systemPrompt: z.string().max(50_000).optional(),
      llmMode: z.enum(["included", "byok", "platform"]).optional(),
      llmProvider: z.enum(["openrouter", "openai", "anthropic", "google"]).optional(),
      llmModel: z.string().optional(),
      llmApiKey: z.string().optional(),
      cpuLimit: z.string().optional(),
      memoryMb: z.number().int().positive().optional(),
      storageMb: z.number().int().positive().optional(),
      messagingOnly: z.boolean().optional(),
      // JAR memory-scoping foundation: see schema.pg.ts and
      // docs/audits/memory-scoping-decision.md for the design.
      // Memory scope is enforced at the MCP server level: 'off' hides tools,
      // 'session' guards on session_id.
      memoryScope: z.enum(["global", "session", "off"]).optional(),
      /** Per-deployment delegation budget cap in cents. null = unlimited. */
      maxBudgetCents: z.number().int().min(0).nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...rawUpdates } = input;

      // Platform mode is admin-only
      if (rawUpdates.llmMode === "platform" && !isAdmin(ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Platform LLM mode is restricted to administrators" });
      }

      // Fetch the existing deployment to detect mode switches. Org owners/admins
      // may mutate deployments owned by their org.
      const { deployment: existing } = await findDeploymentWithAccess(
        ctx.db,
        id,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );

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
        } else if (newMode === "platform") {
          // Switching to platform mode: use platform's own LLM key, clear user key
          updates.isPlatform = true;
          updates.llmApiKey = null;
          updates.llmApiKeyId = null;
          updates.llmCreditLimitDollars = null;
          updates.llmApiKeySourceDeploymentId = null;
        }
      } else if (rawUpdates.llmApiKey) {
        // Mode didn't change but user provided a new API key - encrypt it
        updates.llmApiKey = encryptApiKey(rawUpdates.llmApiKey);
      }

      // Recalculate price if hardware specs changed
      if (updates.cpuLimit || updates.memoryMb || updates.storageMb) {
        const newCpu = updates.cpuLimit || existing.cpuLimit;
        const newMemory = updates.memoryMb || existing.memoryMb;
        const newStorage = updates.storageMb || existing.storageMb;
        updates.monthlyPriceCents = calculateMonthlyPriceCents(newCpu, newMemory, newStorage);
      }

      // Access already verified above (findDeploymentWithAccess). Key off id alone
      // so org-owned deployments update correctly when mutated by an org admin.
      await ctx.db.update(deployments)
        .set(updates)
        .where(eq(deployments.id, id));

      // Config sync: push updated configs to PVC if deployment is running.
      // Memory scope is enforced at the MCP server level: 'off' hides tools, 'session' guards on session_id.
      if (existing.status === "running") {
        safeFireAndForget(syncConfigsToPvc(id), { operation: "syncConfigsToPvc", deploymentId: id });

        // API key, provider, model, or memory scope changes require a pod restart
        // to take effect. ConfigSync should auto-escalate for secret changes, but
        // as a safety net, explicitly restart if any of these critical fields changed.
        const needsRestart = !!(
          updates.llmApiKey ||
          updates.llmProvider ||
          updates.llmModel ||
          updates.memoryScope
        );
        if (needsRestart) {
          // Delay restart slightly to let configSync push the new secret first
          setTimeout(async () => {
            try {
              const { restartDeployment } = await import("../../../k8s/lifecycle.js");
              await restartDeployment(id);
              logger.info({ deploymentId: id }, "Auto-restart after critical config change (API key/provider/model/memory)");
            } catch (err) {
              logger.warn({ err, deploymentId: id }, "Auto-restart failed after config change — user may need to restart manually");
            }
          }, 3000);
        }
      }

      return ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, id),
        with: { runtimeCatalogEntry: true },
      });
    }),

};
