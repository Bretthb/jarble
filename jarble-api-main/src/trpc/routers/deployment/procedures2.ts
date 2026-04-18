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

export const procedures2 = {

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

        // JAR-86: Enqueue a durable job instead of running K8s ops + readiness
        // poll in an IIFE. The worker handles start vs restart selection and
        // resumes safely on crash.
        await enqueueLifecycleJob(ctx.db, {
          deploymentId: input.id,
          userId: ctx.user.id,
          type: "start",
          payload: {
            type: "start",
            managedBy,
            wasFailedState,
            deployConfig,
          },
        });

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

        // JAR-86: Enqueue a durable restart job — the worker runs
        // restartDeployment + the readiness poll.
        await enqueueLifecycleJob(ctx.db, {
          deploymentId: input.id,
          userId: ctx.user.id,
          type: "restart",
          payload: {
            type: "restart",
            managedBy,
            deployConfig: {
              name: deployment.name,
              runtime: deployment.runtime,
              image: deployment.image || undefined,
              cpuLimit: deployment.cpuLimit || undefined,
              memoryMb: deployment.memoryMb || undefined,
              storageMb: deployment.storageMb || undefined,
            },
          },
        });

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
        const { syncMcpServer } = await import("../../../services/configSync.js");
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
};
