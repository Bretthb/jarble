import { z } from "zod";
import crypto from "crypto";
import { router, protectedProcedure, publicProcedure } from "../middleware.js";
import { tables, dbDate, type DbClient } from "../../db/index.js";
import { eq, and, or, isNull, sql, inArray } from "drizzle-orm";
import { createDeployment, deleteDeployment, stopDeployment, startDeployment, restartDeployment, getDeploymentPodStatus, getDeploymentStorageUsage, exportDeploymentConfigs, getDeploymentLogs, getCustomComponentsWithDefinitions, writeComponentToPvc, deleteComponentFromPvc, findPodForDeployment, execInPod, appsApi, NAMESPACE } from "../../k8s/index.js";
import { ensureCapacityForDeployment, checkScaleDown, getCapacityStatus, CapacityError, SERVER_TYPES } from "../../k8s/nodeManager.js";
import type { ManagedBy, IsolationLevel } from "../../k8s/constants.js";
import { getPvcMountPath, getContainerName, getContainerHome } from "../../k8s/constants.js";
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
import { safeFireAndForget } from "../../utils/safeAsync.js";
import { calculateMonthlyPriceCents } from "../../utils/pricing.js";
import { seedPlatformAgents } from "../../services/platformAgents.js";
import { COMPONENT_LIBRARY } from "../../data/componentLibrary.js";
import { isAdmin } from "../../utils/admin.js";
import { RESOURCE_TIERS } from "../../k8s/constants.js";
import { validateThemeConfig, COMPONENT_MANIFEST } from "@jarble/component-manifest";
import { noHtmlTags, NO_HTML_MESSAGE } from "../../utils/sanitize.js";
import { requireOrgRole } from "./org.js";
import type { OrgRole } from "./org.js";

const { deployments, users, runtimeCatalog, platformCredentials, deploymentSkills, chatSessions, chatMessages, agentCalls, orchestrationFlows, orgMembers, organizations, deploymentSecrets, promoRedemptions } = tables;

/**
 * Find a deployment and verify the caller has access.
 * - Personal deployments (orgId is null): only the creator (userId) can access
 * - Org deployments: any org member can read; mutations require owner/admin role
 *
 * Returns the deployment + the caller's org role (null for personal deployments).
 * Throws NOT_FOUND if deployment doesn't exist or caller has no access.
 */
async function findDeploymentWithAccess(
  db: DbClient,
  deploymentId: string,
  userId: string,
  opts?: { requireRole?: OrgRole[] },
): Promise<{ deployment: any; orgRole: OrgRole | null }> {
  // 1. First try to find by userId (personal deployment or user is creator)
  let deployment = await db.query.deployments.findFirst({
    where: and(eq(deployments.id, deploymentId), eq(deployments.userId, userId)),
    with: { runtimeCatalogEntry: true },
  });

  if (deployment) {
    // Personal deployment or user is the creator
    if (!deployment.orgId) {
      return { deployment, orgRole: null };
    }
    // Creator is also an org member — get their role
    const membership = await db.query.orgMembers.findFirst({
      where: and(eq(orgMembers.orgId, deployment.orgId), eq(orgMembers.userId, userId)),
    });
    const role = (membership?.role ?? "member") as OrgRole;
    if (opts?.requireRole && !opts.requireRole.includes(role)) {
      throw new TRPCError({ code: "FORBIDDEN", message: `Requires ${opts.requireRole.join(" or ")} role` });
    }
    return { deployment, orgRole: role };
  }

  // 2. Not the creator — check if it's an org deployment they have access to
  const dep = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    with: { runtimeCatalogEntry: true },
  });

  if (!dep || !dep.orgId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
  }

  // Verify org membership
  const membership = await db.query.orgMembers.findFirst({
    where: and(eq(orgMembers.orgId, dep.orgId), eq(orgMembers.userId, userId)),
  });
  if (!membership) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
  }

  const role = membership.role as OrgRole;

  // Check visibility — members can't see "admin" visibility deployments
  if ((dep as any).visibility === "admin" && role === "member") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
  }

  // Check required role for mutations
  if (opts?.requireRole && !opts.requireRole.includes(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: `Requires ${opts.requireRole.join(" or ")} role` });
  }

  return { deployment: dep, orgRole: role };
}

export const deploymentRouter = router({

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

      // Start K8s deployment (fire-and-forget - don't block the response)
      void (async () => {
        try {
          // Persist managedBy on the DB row before creating K8s resources
          await ctx.db.update(deployments)
            .set({ managedBy })
            .where(eq(deployments.id, deploymentId));

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
            isolationLevel: ((deployment as any).isolationLevel || "standard") as IsolationLevel,
            nodeName: targetNode,
            deploymentType,
          }, managedBy);
          logger.info({ deploymentId }, "K8s createDeployment returned, polling for readiness...");

          // Poll for pod readiness - 150 attempts × 2s = 300s (5 min) timeout
          // Fresh VPS: ~60s K3s join + ~23s image pull + ~120-180s OpenClaw boot = ~4-5 min
          await new Promise((r) => setTimeout(r, 1500));
          let ready = false;
          for (let i = 0; i < 150; i++) {
            const podStatus = await getDeploymentPodStatus(deploymentId, managedBy);
            if (podStatus.status === "running") { ready = true; break; }
            if (podStatus.status === "failed") break;
            await new Promise((r) => setTimeout(r, 2000));
          }

          // Only update if still in transitional state (don't overwrite enforcement actions).
          // Wave 4 Layer B: includes the granular per-step statuses written by
          // lifecycle.ts (waiting_volume, pulling_image, initializing) and the
          // call-site write above (provisioning_node).
          await ctx.db.update(deployments)
            .set({ status: ready ? "running" : "failed", ...(ready ? { error: null } : { error: "Pod did not become ready" }) })
            .where(and(
              eq(deployments.id, deploymentId),
              inArray(deployments.status, [
                "creating",
                "provisioning_node",
                "waiting_volume",
                "pulling_image",
                "initializing",
              ]),
            ));
          logger.info({ deploymentId, ready }, "Deployment create completed");
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown deployment error";
          await ctx.db.update(deployments)
            .set({ status: "failed", error: message })
            .where(and(
              eq(deployments.id, deploymentId),
              inArray(deployments.status, [
                "creating",
                "provisioning_node",
                "waiting_volume",
                "pulling_image",
                "initializing",
              ]),
            ));
          logger.error({ deploymentId, err }, "Deployment failed");
        }
      })();

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
              const { restartDeployment } = await import("../../k8s/lifecycle.js");
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

  // Stop deployment (scale to 0 replicas, PVC persists)
  stop: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id, {
        requireRole: ["owner", "admin"],
      });

      if (deployment.status !== "running") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot stop a deployment that is ${deployment.status}`,
        });
      }

      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;

      try {
        // Atomic conditional update - prevents double-stop race condition.
        // If two concurrent requests both pass the status check above, only
        // one will succeed in setting "stopping" (the other gets 0 rows).
        const stopResult = await ctx.db.update(deployments)
          .set({ status: "stopping" })
          .where(and(eq(deployments.id, input.id), eq(deployments.status, "running")));

        const rowsAffected = (stopResult as any)[0]?.affectedRows ?? (stopResult as any).rowCount ?? (stopResult as any).changes ?? 1;
        if (rowsAffected === 0) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "Deployment is no longer running (concurrent request may have stopped it)",
          });
        }

        await stopDeployment(input.id, managedBy);

        await ctx.db.update(deployments)
          .set({ status: "stopped" })
          .where(eq(deployments.id, input.id));
        logger.info({ deploymentId: input.id }, "Deployment stopped");
      } catch (err) {
        if (err instanceof TRPCError) throw err;
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
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id, {
        requireRole: ["owner", "admin"],
      });

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
      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
      const startDeploymentType = (deployment as any).deploymentType || "agent";

      // ── SYNCHRONOUS capacity check before starting ──────────────────────
      // Same as deploy: blocks until capacity is confirmed or rejected.
      // Container/website types skip VPS provisioning (they use shared pool nodes).
      let targetNode: string | undefined;
      try {
        targetNode = await ensureCapacityForDeployment(
          ctx.db,
          deployment.cpuLimit || "2.0",
          deployment.memoryMb || 3072,
          startDeploymentType,
          input.id,
          // storageMb is historically named — the value is GiB. Pass it through
          // so the autoscaler picks a tier whose root disk fits this PVC.
          deployment.storageMb || undefined,
        );
        if (targetNode) logger.info({ deploymentId: input.id, targetNode }, "Node capacity confirmed for start");
      } catch (capacityErr) {
        if (capacityErr instanceof CapacityError) {
          // At the server limit - don't change deployment status (it's still stopped/failed),
          // just return the error to the user
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: (capacityErr as Error).message,
          });
        }
        // Transient failure - log but proceed without node pinning
        logger.error({ deploymentId: input.id, err: capacityErr instanceof Error ? capacityErr.message : capacityErr },
          "Auto-scale capacity check failed during start, proceeding without node pinning");
      }

      try {
        await ctx.db.update(deployments)
          .set({ status: "creating", error: null })
          .where(eq(deployments.id, input.id));

        // If we got a target node and this is legacy mode, pin the pod to that node
        // before scaling up. Operator mode handles node selection via the CR spec.
        if (targetNode && managedBy !== "operator") {
          try {
            await appsApi.patchNamespacedDeployment(
              `dep-${input.id}`,
              NAMESPACE,
              {
                spec: {
                  template: {
                    spec: {
                      nodeSelector: { "kubernetes.io/hostname": targetNode },
                    },
                  },
                },
              },
              undefined,
              undefined,
              undefined,
              undefined,
              undefined,
              { headers: { "Content-Type": "application/strategic-merge-patch+json" } }
            );
            logger.info({ deploymentId: input.id, targetNode }, "Patched nodeSelector before start");
          } catch (patchErr) {
            logger.warn({ deploymentId: input.id, patchErr }, "Failed to patch nodeSelector, proceeding without node pinning");
          }
        }

        // For operator mode, start/restart needs config to recreate the CR
        const deployConfig = {
          name: deployment.name,
          runtime: deployment.runtime,
          image: deployment.image || undefined,
          cpuLimit: deployment.cpuLimit || undefined,
          memoryMb: deployment.memoryMb || undefined,
          storageMb: deployment.storageMb || undefined,
        };

        if (wasFailedState) {
          await restartDeployment(input.id, managedBy, ctx.user.id, deployConfig);
        } else {
          await startDeployment(input.id, managedBy, ctx.user.id, deployConfig);
        }

        // Poll for pod readiness (fire-and-forget)
        void (async () => {
          try {
            // Brief delay to let transitional status be visible in UI
            await new Promise((r) => setTimeout(r, 1500));

            let ready = false;
            for (let i = 0; i < 90; i++) {
              const podStatus = await getDeploymentPodStatus(input.id, managedBy);
              if (podStatus.status === "running") { ready = true; break; }
              if (podStatus.status === "failed") break;
              await new Promise((r) => setTimeout(r, 2000));
            }
            // Only update if still in transitional state (don't overwrite enforcement actions)
            await ctx.db.update(deployments)
              .set({ status: ready ? "running" : "failed" })
              .where(and(eq(deployments.id, input.id), eq(deployments.status, "creating")));
            // Sync configs after start - picks up any changes made while stopped
            if (ready) {
              safeFireAndForget(syncConfigsToPvc(input.id), { operation: "syncConfigsToPvc", deploymentId: input.id });
            }
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
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id, {
        requireRole: ["owner", "admin"],
      });

      if (deployment.status !== "running" && deployment.status !== "failed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot restart a deployment that is ${deployment.status}`,
        });
      }

      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;

      try {
        await ctx.db.update(deployments)
          .set({ status: "restarting" })
          .where(eq(deployments.id, input.id));

        // Fire-and-forget restart + status polling
        void (async () => {
          try {
            await restartDeployment(input.id, managedBy, ctx.user.id, {
              name: deployment.name,
              runtime: deployment.runtime,
              image: deployment.image || undefined,
              cpuLimit: deployment.cpuLimit || undefined,
              memoryMb: deployment.memoryMb || undefined,
              storageMb: deployment.storageMb || undefined,
            });

            // Brief delay to let transitional status be visible in UI
            await new Promise((r) => setTimeout(r, 1500));

            let ready = false;
            for (let i = 0; i < 90; i++) {
              const podStatus = await getDeploymentPodStatus(input.id, managedBy);
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

  // Push the latest MCP server + tools to a running pod without restarting.
  // Fixes the "old pod doesn't have set_theme" problem - zero downtime.
  updateRuntime: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { deployment } = await findDeploymentWithAccess(
        ctx.db,
        input.id,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );

      if (deployment.status !== "running") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `Cannot update runtime on a deployment that is ${deployment.status}`,
        });
      }

      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;

      try {
        const { syncMcpServer } = await import("../../services/configSync.js");
        const result = await syncMcpServer(input.id, managedBy);
        logger.info({ deploymentId: input.id, ...result }, "updateRuntime completed");
        return result;
      } catch (err) {
        logger.error({ deploymentId: input.id, err }, "updateRuntime failed");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: err instanceof Error ? err.message : "Failed to update runtime",
        });
      }
    }),

  // Cancel subscription (deployment stays active until billing period ends)
  cancel: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { deployment } = await findDeploymentWithAccess(
        ctx.db,
        input.id,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );

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
      const { deployment } = await findDeploymentWithAccess(
        ctx.db,
        input.id,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );

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
      const { deployment } = await findDeploymentWithAccess(
        ctx.db,
        input.deploymentId,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );

      if (deployment.stripeSubscriptionId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Deployment already has a subscription linked",
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
      // Config export is sensitive (may include secrets/prompts) — org admins only.
      const { deployment } = await findDeploymentWithAccess(
        ctx.db,
        input.id,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );

      if (deployment.status !== "running") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Deployment must be running to export configs",
        });
      }

      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
      try {
        const result = await exportDeploymentConfigs(input.id, managedBy);
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

  // Update OpenClaw version on a running pod
  updateOpenClawVersion: protectedProcedure
    .input(z.object({
      id: z.string(),
      version: z.string().default("latest"),
    }))
    .mutation(async ({ ctx, input }) => {
      const { deployment } = await findDeploymentWithAccess(
        ctx.db,
        input.id,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );
      if (deployment.status !== "running") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Deployment must be running (currently ${deployment.status})` });
      }

      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
      const podName = await findPodForDeployment(input.id, { managedBy }).catch(() => null);
      if (!podName) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "No pod found" });
      }

      const containerName = getContainerName(managedBy);

      // Get current version
      const currentVersion = await execInPod(podName, ["npx", "openclaw", "--version"], containerName).catch(() => "unknown");

      // Run update with memory cap to avoid OOM
      const target = input.version;
      const updateCmd = `cd /opt/openclaw && NODE_OPTIONS='--max-old-space-size=256' npm install openclaw@${target} --prefer-offline 2>&1 | tail -10`;
      let output: string;
      try {
        output = await execInPod(podName, ["sh", "-c", updateCmd], containerName, 120_000);
      } catch (err) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Update failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Get new version
      const newVersion = await execInPod(podName, ["npx", "openclaw", "--version"], containerName).catch(() => "unknown");

      logger.info({ deploymentId: input.id, from: currentVersion.trim(), to: newVersion.trim(), target }, "OpenClaw updated");

      return {
        previousVersion: currentVersion.trim(),
        newVersion: newVersion.trim(),
        output: output.trim(),
      };
    }),

  // Read the actual config from the running pod (introspection)
  getPodConfig: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id);
      if (deployment.status !== "running") {
        return { status: "unavailable" as const, model: null, channels: null };
      }

      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
      const podName = await findPodForDeployment(input.id, { managedBy }).catch(() => null);
      if (!podName) {
        return { status: "unavailable" as const, model: null, channels: null };
      }

      const containerName = getContainerName(managedBy);
      const home = getContainerHome(managedBy);
      const configPath = `${home}/.openclaw/openclaw.json`;

      let openclawRaw: string | null = null;
      try {
        openclawRaw = await execInPod(podName, ["cat", configPath], containerName);
      } catch {
        return { status: "unavailable" as const, model: null, channels: null };
      }

      let model: string | null = null;
      let channels: Record<string, { enabled: boolean }> | null = null;

      if (openclawRaw) {
        try {
          const config = JSON.parse(openclawRaw);
          model = config.agents?.defaults?.model?.primary ?? config.agent?.model ?? null;
          if (config.channels && typeof config.channels === "object") {
            channels = {};
            for (const [key, val] of Object.entries(config.channels)) {
              channels[key] = { enabled: (val as any)?.enabled ?? true };
            }
          }
        } catch {
          // Malformed JSON
        }
      }

      return { status: "live" as const, model, channels };
    }),

  // Set deployment theme
  setActiveFlow: protectedProcedure
    .input(z.object({
      id: z.string(),
      flowId: z.string().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { deployment } = await findDeploymentWithAccess(
        ctx.db,
        input.id,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );

      // Verify the flow exists and this deployment is a member (if setting, not clearing)
      if (input.flowId) {
        const fdm = (tables as any).flowDeploymentMemberships;
        if (fdm) {
          const membership = await ctx.db.query.flowDeploymentMemberships.findFirst({
            where: and(eq(fdm.deploymentId, input.id), eq(fdm.flowId, input.flowId)),
          });
          if (!membership) throw new TRPCError({ code: "BAD_REQUEST", message: "Deployment is not a member of this flow" });
        }
      }

      await ctx.db.update(deployments)
        .set({ activeFlowId: input.flowId } as any)
        .where(eq(deployments.id, input.id));

      // Sync soul.md so the pod's team context matches the new active flow.
      if (deployment.status === "running") {
        safeFireAndForget(syncConfigsToPvc(input.id), {
          operation: "syncConfigsToPvc",
          deploymentId: input.id,
        });
      }

      return { success: true, activeFlowId: input.flowId };
    }),

  setTheme: protectedProcedure
    .input(z.object({
      id: z.string(),
      themeConfig: z.record(z.string(), z.unknown()),
    }))
    .mutation(async ({ ctx, input }) => {
      await findDeploymentWithAccess(
        ctx.db,
        input.id,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );

      const error = validateThemeConfig(input.themeConfig);
      if (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error });
      }

      await ctx.db.update(deployments)
        .set({ themeConfig: JSON.stringify(input.themeConfig) } as any)
        .where(eq(deployments.id, input.id));

      return { success: true };
    }),

  // Delete deployment + K8s resources
  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      logger.info({ deploymentId: input.id, userId: ctx.user.id }, "delete: request received");

      // Fetch deployment first to get the OpenRouter key hash (for revocation)
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id, {
        requireRole: ["owner", "admin"],
      });

      logger.debug({ deploymentId: input.id, status: deployment.status, llmMode: deployment.llmMode }, "delete: deployment found");

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
          logger.warn({ deploymentId: input.id, linkedCount: linkedChildren.length }, "delete: blocked - credit pool has linked children");
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
          logger.warn({ err, deploymentId: input.id, keyId }, "delete: failed to revoke OpenRouter key - continuing");
        }
      }

      // Cancel Stripe subscription if one exists (prevent orphaned billing)
      if (deployment.stripeSubscriptionId && isStripeConfigured()) {
        logger.debug({ deploymentId: input.id, subscriptionId: deployment.stripeSubscriptionId }, "delete: cancelling Stripe subscription");
        try {
          await cancelSubscriptionImmediately(deployment.stripeSubscriptionId);
          logger.debug({ deploymentId: input.id }, "delete: Stripe subscription cancelled");
        } catch (err) {
          logger.warn({ err, deploymentId: input.id, subscriptionId: deployment.stripeSubscriptionId }, "delete: failed to cancel Stripe subscription - continuing");
        }
      }

      // ── Strategy E: rewrite affected flow definitions ─────────────────────
      // The FK on flow_deployment_memberships.deployment_id cascades on
      // delete, so the join table cleans itself. But
      // orchestration_flows.definition is a text JSON blob with no
      // schema-aware FK — deleting a deployment leaves dead deploymentId
      // references in those flow definitions. This block finds affected
      // flows and rewrites them to strip the dead nodes (and any edges that
      // reference those nodes). We run this BEFORE the deployment row is
      // removed so a failure here doesn't orphan the deployment — the
      // user can retry.
      //
      // See docs/audits/stale-flow-deployment-ids.md Strategy E.
      try {
        const deploymentId = input.id;
        // PG/MySQL/SQLite all support LIKE on text columns. We quote the id
        // to avoid matching substrings, then re-verify in JS after parsing
        // so a coincidental string match doesn't cause a spurious rewrite.
        const idNeedle = `%"${deploymentId}"%`;
        const affectedFlows = await ctx.db
          .select({
            id: orchestrationFlows.id,
            definition: orchestrationFlows.definition,
          })
          .from(orchestrationFlows)
          .where(sql`${orchestrationFlows.definition} LIKE ${idNeedle}`);

        if (affectedFlows.length > 0) {
          logger.debug(
            { deploymentId, candidateCount: affectedFlows.length },
            "delete: candidate flows for stale-ref rewrite",
          );
        }

        for (const flow of affectedFlows) {
          let definition: { nodes?: any[]; edges?: any[] };
          try {
            definition =
              typeof flow.definition === "string"
                ? JSON.parse(flow.definition)
                : (flow.definition as any);
          } catch {
            logger.warn(
              { flowId: flow.id, deploymentId },
              "delete: flow definition is not valid JSON, skipping rewrite",
            );
            continue;
          }

          const sourceNodes = Array.isArray(definition?.nodes)
            ? definition.nodes
            : [];
          const sourceEdges = Array.isArray(definition?.edges)
            ? definition.edges
            : [];

          const removedNodeIds = new Set<string>();
          const keptNodes = sourceNodes.filter((n: any) => {
            const matches =
              n?.deploymentId === deploymentId ||
              n?.config?.deploymentId === deploymentId;
            if (matches && n?.id) removedNodeIds.add(n.id);
            return !matches;
          });

          // Re-verify: if no nodes were actually removed, the LIKE matched
          // a coincidental substring (e.g. an id appearing in a label).
          // Skip the write so we don't churn the updatedAt timestamp.
          if (removedNodeIds.size === 0) continue;

          const keptEdges = sourceEdges.filter(
            (e: any) =>
              !removedNodeIds.has(e?.source) && !removedNodeIds.has(e?.target),
          );

          const newDefinition = {
            ...definition,
            nodes: keptNodes,
            edges: keptEdges,
          };

          await ctx.db
            .update(orchestrationFlows)
            .set({
              definition: JSON.stringify(newDefinition),
              updatedAt: dbDate(),
            })
            .where(eq(orchestrationFlows.id, flow.id));

          logger.info(
            {
              flowId: flow.id,
              deploymentId,
              nodesRemoved: sourceNodes.length - keptNodes.length,
              edgesRemoved: sourceEdges.length - keptEdges.length,
            },
            "delete: rewrote affected flow definition",
          );
        }
      } catch (err) {
        // Non-fatal — deployment delete proceeds even if flow rewrite fails.
        // The cascading FK on flow_deployment_memberships still cleans the
        // join table, and any leftover orphans will be caught by the
        // periodic sweep (Strategy A).
        logger.error(
          {
            deploymentId: input.id,
            err: err instanceof Error ? err.message : String(err),
          },
          "delete: failed to rewrite affected flow definitions (non-fatal)",
        );
      }

      // Delete K8s resources first - if this throws, we abort and leave the DB record intact
      // so the user can retry. Step-by-step logs are inside deleteDeployment.
      const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
      logger.info({ deploymentId: input.id, managedBy }, "delete: starting K8s resource cleanup");
      await deleteDeployment(input.id, managedBy);
      logger.info({ deploymentId: input.id }, "delete: K8s cleanup complete, removing DB records");

      // Check if any auto-scaled nodes are now empty and can be removed
      void checkScaleDown().catch((err) => {
        logger.warn({ err }, "Scale-down check failed (non-blocking)");
      });

      // Explicitly clean up child rows before deleting the deployment.
      // Most FKs have ON DELETE CASCADE, but agent_calls and promo_redemptions
      // do NOT — they block the delete with a constraint violation if not cleaned first.
      const credResult = await ctx.db.delete(platformCredentials)
        .where(eq(platformCredentials.deploymentId, input.id));
      logger.debug({ deploymentId: input.id, rows: (credResult as any)?.changes ?? (credResult as any)?.rowsAffected ?? "?" }, "delete: platform_credentials removed");

      const skillsResult = await ctx.db.delete(deploymentSkills)
        .where(eq(deploymentSkills.deploymentId, input.id));
      logger.debug({ deploymentId: input.id, rows: (skillsResult as any)?.changes ?? (skillsResult as any)?.rowsAffected ?? "?" }, "delete: deployment_skills removed");

      // Clean up agent_calls (no ON DELETE CASCADE on caller/callee FKs)
      await ctx.db.delete(agentCalls)
        .where(or(eq(agentCalls.callerDeploymentId, input.id), eq(agentCalls.calleeDeploymentId, input.id)));
      logger.debug({ deploymentId: input.id }, "delete: agent_calls removed");

      // Clean up promo_redemptions (no ON DELETE CASCADE on deployment FK)
      await ctx.db.delete(promoRedemptions)
        .where(eq(promoRedemptions.deploymentId, input.id));
      logger.debug({ deploymentId: input.id }, "delete: promo_redemptions removed");

      // Access + role check already enforced at top via findDeploymentWithAccess.
      // Use id alone so org-owned deployments delete correctly for org admins.
      await ctx.db.delete(deployments)
        .where(eq(deployments.id, input.id));
      logger.debug({ deploymentId: input.id }, "delete: deployments row removed");

      logger.info({ deploymentId: input.id, userId: ctx.user.id }, "delete: deployment fully deleted");

      return { success: true };
    }),

  // ── Fork & Public Profile Procedures ─────────────────────────────────────

  // Fork a public (or owned) deployment into a new deployment for the current user
  fork: protectedProcedure
    .input(z.object({
      sourceId: z.string(),
      name: z.string().min(1).max(255).refine(noHtmlTags, NO_HTML_MESSAGE),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. Fetch source deployment - must be isPublic=true OR owned by user
      const source = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.sourceId),
      });

      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Source deployment not found" });
      }

      if (!source.isPublic && source.userId !== ctx.user.id) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Source deployment not found" });
      }

      // 2. Generate new deployment ID
      const newId = nanoid();
      const now = new Date().toISOString();

      // 3. Clone selected fields from source (NOT: llmApiKey, stripeSubscriptionId, billing, status, credentials, llmApiKeyId)
      await ctx.db.insert(deployments).values({
        id: newId,
        userId: ctx.user.id,
        name: input.name,
        description: source.description,
        runtime: source.runtime,
        runtimeCatalogId: source.runtimeCatalogId,
        systemPrompt: source.systemPrompt,
        llmProvider: source.llmProvider,
        llmModel: source.llmModel,
        themeConfig: source.themeConfig,
        messagingOnly: source.messagingOnly,
        image: source.image,
        specialties: source.specialties,
        bio: source.bio,
        forkedFromId: input.sourceId,
        status: "pending",
      } as any);

      // 6. Copy deploymentSkills (fresh records)
      const existingSkills = await ctx.db.query.deploymentSkills.findMany({
        where: eq(deploymentSkills.deploymentId, input.sourceId),
      });
      for (const ds of existingSkills) {
        await ctx.db.insert(deploymentSkills).values({
          id: `dsk_${nanoid()}`,
          deploymentId: newId,
          skillId: ds.skillId,
          installedAt: now,
        } as any);
      }

      // 9. Copy subagents
      const existingSubagents = await ctx.db.query.deploymentSubagents?.findMany?.({
        where: eq(tables.deploymentSubagents.deploymentId, input.sourceId),
      }) || [];
      for (const sa of existingSubagents) {
        await ctx.db.insert(tables.deploymentSubagents).values({
          id: `sa_${nanoid()}`,
          deploymentId: newId,
          name: sa.name,
          slug: sa.slug,
          description: sa.description,
          systemPrompt: sa.systemPrompt,
          model: sa.model,
          triggerType: sa.triggerType,
          triggerConfig: sa.triggerConfig,
          tools: sa.tools,
          enabled: sa.enabled,
          sortOrder: sa.sortOrder,
          isPublic: false,
          forkedFromId: sa.id,
          forkCount: 0,
          createdAt: now,
          updatedAt: now,
        } as any);
      }

      // 10. Increment source deployment's forkCount
      await ctx.db.update(deployments)
        .set({ forkCount: sql`${deployments.forkCount} + 1` } as any)
        .where(eq(deployments.id, input.sourceId));

      // 11. Return the new deployment
      const newDeployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, newId),
        with: { runtimeCatalogEntry: true },
      });

      logger.info({ sourceId: input.sourceId, newId, userId: ctx.user.id }, "Deployment forked");

      return newDeployment;
    }),

  // Platform fork: admin-only fork that uses platform-managed LLM keys
  platformFork: protectedProcedure
    .input(z.object({
      sourceId: z.string(),
      name: z.string().min(1).max(255).refine(noHtmlTags, NO_HTML_MESSAGE).optional(),
      resourceTier: z.enum(["small", "medium", "large"]).default("small"),
      llmProvider: z.string().optional(),
      llmModel: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // 1. Admin check
      if (!isAdmin(ctx.user.id)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Platform fork is restricted to administrators" });
      }

      // 2. Fetch source deployment (admins can fork anything)
      const source = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, input.sourceId),
      });

      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Source deployment not found" });
      }

      // 3. Resolve resource tier to concrete values
      const tier = RESOURCE_TIERS[input.resourceTier];

      // 4. Generate new deployment ID
      const newId = nanoid();
      const now = new Date().toISOString();

      // 5. Insert new deployment with platform overrides
      await ctx.db.insert(deployments).values({
        id: newId,
        userId: ctx.user.id,
        name: input.name || `[Platform] ${source.name}`,
        description: source.description,
        runtime: source.runtime,
        runtimeCatalogId: source.runtimeCatalogId,
        systemPrompt: source.systemPrompt,
        llmProvider: input.llmProvider || source.llmProvider,
        llmModel: input.llmModel || source.llmModel,
        llmMode: "platform",
        isPlatform: true,
        llmApiKey: null,
        cpuLimit: tier.cpuLimit,
        memoryMb: tier.memoryMb,
        storageMb: tier.storageMb,
        resourceTier: input.resourceTier,
        themeConfig: source.themeConfig,
        messagingOnly: source.messagingOnly,
        image: source.image,
        specialties: source.specialties,
        bio: source.bio,
        forkedFromId: input.sourceId,
        status: "stopped",
      } as any);


      // 8. Copy deploymentSkills
      const existingSkills = await ctx.db.query.deploymentSkills.findMany({
        where: eq(deploymentSkills.deploymentId, input.sourceId),
      });
      for (const ds of existingSkills) {
        await ctx.db.insert(deploymentSkills).values({
          id: `dsk_${nanoid()}`,
          deploymentId: newId,
          skillId: ds.skillId,
          installedAt: now,
        } as any);
      }

      // 9. Copy subagents
      const existingSubagents2 = await ctx.db.query.deploymentSubagents?.findMany?.({
        where: eq(tables.deploymentSubagents.deploymentId, input.sourceId),
      }) || [];
      for (const sa of existingSubagents2) {
        await ctx.db.insert(tables.deploymentSubagents).values({
          id: `sa_${nanoid()}`,
          deploymentId: newId,
          name: sa.name,
          slug: sa.slug,
          description: sa.description,
          systemPrompt: sa.systemPrompt,
          model: sa.model,
          triggerType: sa.triggerType,
          triggerConfig: sa.triggerConfig,
          tools: sa.tools,
          enabled: sa.enabled,
          sortOrder: sa.sortOrder,
          isPublic: false,
          forkedFromId: sa.id,
          forkCount: 0,
          createdAt: now,
          updatedAt: now,
        } as any);
      }

      // 10. Increment source deployment's forkCount
      await ctx.db.update(deployments)
        .set({ forkCount: sql`${deployments.forkCount} + 1` } as any)
        .where(eq(deployments.id, input.sourceId));

      // 11. Return the new deployment
      const newDeployment = await ctx.db.query.deployments.findFirst({
        where: eq(deployments.id, newId),
        with: { runtimeCatalogEntry: true },
      });

      logger.info({ sourceId: input.sourceId, newId, userId: ctx.user.id, resourceTier: input.resourceTier }, "Platform deployment forked");

      return newDeployment;
    }),

  // Set deployment visibility (public/private)
  setVisibility: protectedProcedure
    .input(z.object({
      id: z.string(),
      isPublic: z.boolean(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify access (owner/admin can toggle public visibility)
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id, {
        requireRole: ["owner", "admin"],
      });

      await ctx.db.update(deployments)
        .set({ isPublic: input.isPublic } as any)
        .where(eq(deployments.id, input.id));

      return { success: true };
    }),

  // Set org-level deployment visibility ("all" = every member sees it, "admin" = owner + admin only)
  setOrgVisibility: protectedProcedure
    .input(z.object({
      id: z.string(),
      visibility: z.enum(["all", "admin"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const { deployment } = await findDeploymentWithAccess(ctx.db, input.id, ctx.user.id, {
        requireRole: ["owner", "admin"],
      });

      if (!deployment.orgId) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Visibility only applies to org deployments" });
      }

      await ctx.db.update(deployments)
        .set({ visibility: input.visibility })
        .where(eq(deployments.id, input.id));

      return { success: true };
    }),

  // Get public profile for a deployment (no auth required)
  getPublicProfile: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.id), eq(deployments.isPublic, true)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Parse JSON fields safely
      let specialties: string[] = [];
      try {
        specialties = deployment.specialties ? JSON.parse(deployment.specialties as string) : [];
      } catch { /* ignore parse errors */ }

      let showcasePrompts: string[] = [];
      try {
        showcasePrompts = (deployment as any).showcasePrompts ? JSON.parse((deployment as any).showcasePrompts as string) : [];
      } catch { /* ignore parse errors */ }

      // Return sanitized profile - never expose llmApiKey, stripeSubscriptionId, userId
      return {
        name: deployment.name,
        description: deployment.description,
        runtime: deployment.runtime,
        systemPrompt: deployment.systemPrompt
          ? (deployment.systemPrompt as string).slice(0, 200)
          : null,
        specialties,
        forkCount: deployment.forkCount,
        bio: (deployment as any).bio,
        showcasePrompts,
        forkedFromId: deployment.forkedFromId,
        themeConfig: deployment.themeConfig,
      };
    }),

  // ─── Chat Persistence ────────────────────────────────────────────────────

  // List chat sessions for a deployment
  listChatSessions: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify deployment access (any org member may view chat sessions)
      await findDeploymentWithAccess(ctx.db, input.deploymentId, ctx.user.id);

      const sessions = await ctx.db.query.chatSessions.findMany({
        where: eq(chatSessions.deploymentId, input.deploymentId),
        orderBy: (s, { desc }) => [desc(s.updatedAt)],
      });
      return sessions;
    }),

  // Get messages for a chat session
  getChatMessages: protectedProcedure
    .input(z.object({ sessionId: z.string(), deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify deployment access (any org member may read chat messages)
      await findDeploymentWithAccess(ctx.db, input.deploymentId, ctx.user.id);

      const msgs = await ctx.db.query.chatMessages.findMany({
        where: eq(chatMessages.sessionId, input.sessionId),
        orderBy: (m, { asc }) => [asc(m.createdAt)],
      });
      return msgs;
    }),

  // Sync chat session + messages from client (upsert)
  syncChatSession: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      sessionId: z.string(),
      title: z.string().max(200),
      messages: z.array(z.object({
        id: z.string(),
        role: z.enum(["user", "assistant"]),
        content: z.string(),
        thinkingText: z.string().optional(),
        createdAt: z.number(),
      })).max(200),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify deployment access (any org member may sync their own chat session)
      await findDeploymentWithAccess(ctx.db, input.deploymentId, ctx.user.id);

      const now = dbDate();

      // Upsert session
      const existing = await ctx.db.query.chatSessions.findFirst({
        where: eq(chatSessions.id, input.sessionId),
      });

      if (existing) {
        await ctx.db.update(chatSessions)
          .set({ title: input.title, updatedAt: now } as any)
          .where(eq(chatSessions.id, input.sessionId));
      } else {
        await ctx.db.insert(chatSessions).values({
          id: input.sessionId,
          deploymentId: input.deploymentId,
          title: input.title,
          createdAt: now,
          updatedAt: now,
        } as any);
      }

      // Delete existing messages and replace with new set (simple sync strategy)
      await ctx.db.delete(chatMessages).where(eq(chatMessages.sessionId, input.sessionId));

      if (input.messages.length > 0) {
        const rows = input.messages.map((m) => ({
          id: m.id,
          sessionId: input.sessionId,
          role: m.role,
          content: m.content,
          thinkingText: m.thinkingText || null,
          createdAt: dbDate(new Date(m.createdAt)),
        }));
        await ctx.db.insert(chatMessages).values(rows as any);
      }

      return { success: true };
    }),

  // Delete a chat session (cascade deletes messages)
  deleteChatSession: protectedProcedure
    .input(z.object({ sessionId: z.string(), deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify deployment access (any org member may delete a chat session on the deployment)
      await findDeploymentWithAccess(ctx.db, input.deploymentId, ctx.user.id);

      await ctx.db.delete(chatSessions).where(eq(chatSessions.id, input.sessionId));
      return { success: true };
    }),

  // ── Resource Graph ────────────────────────────────────────────────────
  // Returns the deployment relationship graph for a user - all implicit
  // data-sharing connections between their deployments.
  getResourceGraph: protectedProcedure.query(async ({ ctx }) => {
    // 1. Get all user's deployments
    const userDeps = await ctx.db.query.deployments.findMany({
      where: eq(deployments.userId, ctx.user.id),
      columns: {
        id: true,
        name: true,
        runtime: true,
        status: true,
        llmProvider: true,
        llmModel: true,
        llmApiKeySourceDeploymentId: true,
      },
    });

    const userDepIds = userDeps.map(d => d.id);
    if (userDepIds.length === 0) {
      return { nodes: [], edges: [] };
    }

    // 2. Build shared API key edges
    const apiKeyEdges: { source: string; target: string; type: "api_key_share" }[] = [];
    for (const dep of userDeps) {
      if (dep.llmApiKeySourceDeploymentId) {
        apiKeyEdges.push({
          source: dep.llmApiKeySourceDeploymentId,
          target: dep.id,
          type: "api_key_share",
        });
      }
    }

    // 3. Build agent call edges (from agentCalls table)
    // Filter out flow-originated calls (callerDeploymentId starts with "flow_")
    const calls = await ctx.db.select({
      caller: agentCalls.callerDeploymentId,
      callee: agentCalls.calleeDeploymentId,
      count: sql<number>`count(*)`,
      totalCredits: sql<number>`coalesce(sum(${agentCalls.creditsCharged}), 0)`,
    })
      .from(agentCalls)
      .where(and(
        inArray(agentCalls.callerDeploymentId, userDepIds),
        inArray(agentCalls.calleeDeploymentId, userDepIds),
        sql`${agentCalls.callerDeploymentId} NOT LIKE 'flow_%'`,
      ))
      .groupBy(agentCalls.callerDeploymentId, agentCalls.calleeDeploymentId);

    const agentCallEdges = calls.map(c => ({
      source: c.caller,
      target: c.callee,
      type: "agent_call" as const,
      callCount: Number(c.count),
      totalCredits: Number(c.totalCredits),
    }));

    // 4. Build flow connection edges (from orchestration_flows)
    const userFlows = await ctx.db.query.orchestrationFlows.findMany({
      where: eq(orchestrationFlows.userId, ctx.user.id),
      columns: { id: true, name: true, definition: true },
    });

    const flowEdges: { source: string; target: string; type: "flow_connection"; flowId: string; flowName: string }[] = [];
    for (const flow of userFlows) {
      try {
        const def = typeof flow.definition === "string" ? JSON.parse(flow.definition) : flow.definition;
        if (!def?.nodes || !def?.edges) continue;

        // Map nodeId -> deploymentId for nodes referencing user's deployments
        const nodeDeploymentMap = new Map<string, string>();
        for (const node of def.nodes as Array<{ id: string; deploymentId?: string }>) {
          if (node.deploymentId && userDepIds.includes(node.deploymentId)) {
            nodeDeploymentMap.set(node.id, node.deploymentId);
          }
        }

        for (const edge of def.edges as Array<{ source: string; target: string }>) {
          const sourceDep = nodeDeploymentMap.get(edge.source);
          const targetDep = nodeDeploymentMap.get(edge.target);
          if (sourceDep && targetDep && sourceDep !== targetDep) {
            flowEdges.push({
              source: sourceDep,
              target: targetDep,
              type: "flow_connection",
              flowId: flow.id,
              flowName: flow.name,
            });
          }
        }
      } catch { /* skip invalid definitions */ }
    }

    // 5. Build shared platform credential edges
    const creds = await ctx.db.query.platformCredentials.findMany({
      where: inArray(platformCredentials.deploymentId, userDepIds),
      columns: { deploymentId: true, platformId: true },
    });

    const platformGroups = new Map<string, string[]>();
    for (const cred of creds) {
      const group = platformGroups.get(cred.platformId) || [];
      group.push(cred.deploymentId);
      platformGroups.set(cred.platformId, group);
    }

    const platformEdges: { source: string; target: string; type: "shared_platform"; platform: string }[] = [];
    for (const [platform, depIds] of platformGroups) {
      if (depIds.length > 1) {
        // Star topology: connect first to all others
        for (let i = 1; i < depIds.length; i++) {
          platformEdges.push({ source: depIds[0], target: depIds[i], type: "shared_platform", platform });
        }
      }
    }

    // 6. Build shared secret key edges (key NAMES only, never values)
    const secrets = await ctx.db.query.deploymentSecrets.findMany({
      where: inArray(deploymentSecrets.deploymentId, userDepIds),
      columns: { deploymentId: true, key: true },
    });

    const secretGroups = new Map<string, string[]>();
    for (const s of secrets) {
      const group = secretGroups.get(s.key) || [];
      group.push(s.deploymentId);
      secretGroups.set(s.key, group);
    }

    const secretEdges: { source: string; target: string; type: "shared_secret"; secretKey: string }[] = [];
    for (const [key, depIds] of secretGroups) {
      if (depIds.length > 1) {
        // Star topology to limit edge count
        for (let i = 1; i < depIds.length; i++) {
          secretEdges.push({ source: depIds[0], target: depIds[i], type: "shared_secret", secretKey: key });
        }
      }
    }

    // 7. Return the graph
    return {
      nodes: userDeps.map(d => ({
        id: d.id,
        name: d.name,
        runtime: d.runtime,
        status: d.status,
        llmProvider: d.llmProvider,
        llmModel: d.llmModel,
      })),
      edges: [
        ...apiKeyEdges,
        ...agentCallEdges,
        ...flowEdges,
        ...platformEdges,
        ...secretEdges,
      ],
    };
  }),

  // ── Env Var Map ─────────────────────────────────────────────────────
  // Returns all env vars that would be injected into the pod, categorized
  // by source. Values are masked for security — only key names and sources shown.
  getEnvVarMap: protectedProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      // Env var map lists secret key names — restrict to org owner/admin
      // (not regular members) to avoid leaking naming clues.
      const { deployment } = await findDeploymentWithAccess(
        ctx.db,
        input.id,
        ctx.user.id,
        { requireRole: ["owner", "admin"] },
      );

      const vars: Array<{ key: string; source: "llm" | "platform" | "system" | "user" | "agent"; visible: "bot" | "system" }> = [];

      // LLM credentials
      const providerEnvMap: Record<string, string> = { openrouter: "OPENROUTER_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", google: "GOOGLE_API_KEY" };
      if (deployment.llmApiKey || (deployment as any).llmMode === "platform") {
        const envVar = providerEnvMap[(deployment as any).llmProvider ?? "openrouter"] ?? "OPENROUTER_API_KEY";
        vars.push({ key: envVar, source: "llm", visible: "system" });
      }
      if ((deployment as any).llmProvider) vars.push({ key: "LLM_PROVIDER", source: "llm", visible: "system" });
      if ((deployment as any).llmModel) vars.push({ key: "LLM_MODEL", source: "llm", visible: "system" });

      // System vars (always injected)
      vars.push({ key: "JARBLE_MEMORY_SCOPE", source: "system", visible: "bot" });
      if ((deployment as any).gatewayToken) vars.push({ key: "OPENCLAW_GATEWAY_TOKEN", source: "system", visible: "system" });

      // Platform credentials
      const platformCreds = await ctx.db.query.platformCredentials.findMany({
        where: eq(platformCredentials.deploymentId, input.id),
        columns: { platformId: true },
      });
      for (const cred of platformCreds) {
        const platformUpper = cred.platformId.toUpperCase();
        vars.push({ key: `${platformUpper}_BOT_TOKEN`, source: "platform", visible: "system" });
      }

      // User/agent custom secrets
      const secrets = await ctx.db.query.deploymentSecrets.findMany({
        where: eq(deploymentSecrets.deploymentId, input.id),
        columns: { key: true, source: true },
      });
      for (const s of secrets) {
        vars.push({ key: s.key, source: s.source === "agent" ? "agent" : "user", visible: "bot" });
      }

      return { vars };
    }),
});
