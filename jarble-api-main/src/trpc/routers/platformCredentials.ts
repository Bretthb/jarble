import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { db, tables, dbDate } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { logger } from "../../utils/logger.js";
import { TRPCError } from "@trpc/server";
import { encryptApiKey, decryptApiKey } from "../../utils/encryption.js";
import { syncConfigsToPvc } from "../../services/configSync.js";
import { safeFireAndForget } from "../../utils/safeAsync.js";
import { findPodForDeployment, execInPod } from "../../k8s/index.js";

const { deployments, platformCredentials } = tables;

// ── OpenClaw channel config mapping ─────────────────────────────────────────
// Maps platformId → { frontendFieldKey → openClawJsonChannelKey }
// Used when writing openclaw.json { channels: { discord: { token: "..." } } }
export const PLATFORM_CREDENTIAL_KEYS: Record<string, Record<string, string>> = {
  discord: { botToken: "token" },                 // channels.discord.token
  telegram: { botToken: "botToken" },             // channels.telegram.botToken
  slack: { botToken: "botToken", appToken: "appToken" },
  whatsapp: {},                                    // QR pairing via Baileys - no tokens
  web: { allowedDomains: "allowedDomains" },
  teams: { appId: "appId", appPassword: "appPassword" },
  messenger: { pageAccessToken: "pageAccessToken", verifyToken: "verifyToken" },
};

// Maps platformId → { frontendFieldKey → envVarName } for K8s Secret fallback
export const PLATFORM_ENV_MAP: Record<string, Record<string, string>> = {
  discord: { botToken: "DISCORD_BOT_TOKEN" },
  telegram: { botToken: "TELEGRAM_BOT_TOKEN" },
  slack: { botToken: "SLACK_BOT_TOKEN", appToken: "SLACK_APP_TOKEN" },
  whatsapp: {},
  web: {},
  teams: { appId: "TEAMS_APP_ID", appPassword: "TEAMS_APP_PASSWORD" },
  messenger: { pageAccessToken: "MESSENGER_PAGE_ACCESS_TOKEN", verifyToken: "MESSENGER_VERIFY_TOKEN" },
};

/**
 * Mask a credential string for safe display.
 * Shows first 4 and last 4 chars, rest replaced with dots.
 */
function maskCredential(value: string): string {
  if (value.length <= 10) return "****";
  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`;
}

export const platformCredentialsRouter = router({
  // Get all platform credentials for a deployment (masked)
  getByDeployment: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const creds = await ctx.db.query.platformCredentials.findMany({
        where: eq(platformCredentials.deploymentId, input.deploymentId),
      });

      // Decrypt and mask credentials for safe display
      return creds.map((cred) => {
        let decryptedObj: Record<string, string> = {};
        try {
          const decrypted = decryptApiKey(cred.credentials);
          decryptedObj = JSON.parse(decrypted);
        } catch {
          logger.warn({ credId: cred.id }, "Failed to decrypt platform credentials");
        }

        const masked: Record<string, string> = {};
        for (const [key, value] of Object.entries(decryptedObj)) {
          masked[key] = typeof value === "string" && value.length > 0 ? maskCredential(value) : "";
        }

        return {
          id: cred.id,
          platformId: cred.platformId,
          maskedCredentials: masked,
          createdAt: cred.createdAt,
          updatedAt: cred.updatedAt,
        };
      });
    }),

  // Save (upsert) platform credentials
  save: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      platformId: z.string(),
      credentials: z.record(z.string()), // { botToken: "xoxb-...", appToken: "xapp-..." }
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Validate platformId
      if (!PLATFORM_CREDENTIAL_KEYS[input.platformId]) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown platform: ${input.platformId}` });
      }

      // Encrypt the credentials JSON blob
      const encrypted = encryptApiKey(JSON.stringify(input.credentials));

      // Check if existing row for this deployment+platform
      const existing = await ctx.db.query.platformCredentials.findFirst({
        where: and(
          eq(platformCredentials.deploymentId, input.deploymentId),
          eq(platformCredentials.platformId, input.platformId),
        ),
      });

      if (existing) {
        // Update
        await ctx.db.update(platformCredentials)
          .set({
            credentials: encrypted,
            updatedAt: dbDate(),
          })
          .where(eq(platformCredentials.id, existing.id));

        logger.info({
          deploymentId: input.deploymentId,
          platformId: input.platformId,
        }, "Platform credentials updated");
      } else {
        // Insert
        await ctx.db.insert(platformCredentials).values({
          id: nanoid(12),
          deploymentId: input.deploymentId,
          platformId: input.platformId,
          credentials: encrypted,
        });

        logger.info({
          deploymentId: input.deploymentId,
          platformId: input.platformId,
        }, "Platform credentials saved");
      }

      // Config sync: push updated configs to PVC
      // Always fire - syncConfigsToPvc handles status checks internally
      // and will wait for "creating" deployments to become "running"
      safeFireAndForget(syncConfigsToPvc(input.deploymentId), { operation: "syncConfigsToPvc", deploymentId: input.deploymentId });

      return { success: true };
    }),

  // Delete platform credentials
  delete: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      platformId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      await ctx.db.delete(platformCredentials)
        .where(and(
          eq(platformCredentials.deploymentId, input.deploymentId),
          eq(platformCredentials.platformId, input.platformId),
        ));

      logger.info({
        deploymentId: input.deploymentId,
        platformId: input.platformId,
      }, "Platform credentials deleted");

      // Config sync: push updated configs to PVC if deployment is running
      if (deployment.status === "running") {
        safeFireAndForget(syncConfigsToPvc(input.deploymentId), { operation: "syncConfigsToPvc", deploymentId: input.deploymentId });
      }

      return { success: true };
    }),

  // Check if WhatsApp is connected for a deployment
  checkWhatsAppStatus: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user!.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const existing = await ctx.db.query.platformCredentials.findFirst({
        where: and(
          eq(platformCredentials.deploymentId, input.deploymentId),
          eq(platformCredentials.platformId, "whatsapp"),
        ),
      });

      return { connected: !!existing };
    }),

  // Mark WhatsApp as connected (called by the QR SSE endpoint after successful pairing)
  markWhatsAppConnected: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user!.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // Upsert: only insert if no existing whatsapp row
      const existing = await ctx.db.query.platformCredentials.findFirst({
        where: and(
          eq(platformCredentials.deploymentId, input.deploymentId),
          eq(platformCredentials.platformId, "whatsapp"),
        ),
      });

      if (!existing) {
        const encrypted = encryptApiKey(JSON.stringify({}));
        await ctx.db.insert(platformCredentials).values({
          id: nanoid(12),
          deploymentId: input.deploymentId,
          platformId: "whatsapp",
          credentials: encrypted,
        });

        logger.info({ deploymentId: input.deploymentId }, "WhatsApp marked as connected");
      }

      // Trigger config sync so openclaw.json gets WhatsApp channel written
      if (deployment.status === "running") {
        safeFireAndForget(syncConfigsToPvc(input.deploymentId), { operation: "syncConfigsToPvc", deploymentId: input.deploymentId });
      }

      return { success: true };
    }),

  // Poll for pending Telegram pairing requests and auto-approve the first one
  pollTelegramPairing: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      // For stopped/failed deployments, don't bother looking for a pod.
      // But for "creating" and "restarting", the pod may already be Running in K8s
      // even though the DB hasn't flipped to "running" yet (createDeployment blocks
      // waiting for readiness to write config files). The bot can connect to Telegram
      // before the readiness probe passes, so we should try to exec anyway.
      const depStatus = deployment.status;
      if (depStatus === "stopped" || depStatus === "failed" || depStatus === "pending") {
        return { status: "pod_not_ready" as const };
      }

      // For exec operations we only need the pod to be Running, not necessarily ready.
      // The readiness probe (TCP 18789) may still be failing even after OpenClaw has
      // started and is responding to Telegram messages.
      const podName = await findPodForDeployment(input.deploymentId, { requireReady: false });
      if (!podName) {
        return { status: "pod_not_ready" as const };
      }

      try {
        // Wrap in bash so that a non-zero exit code from openclaw doesn't cause execInPod
        // to throw. openclaw may exit non-zero even when it outputs valid JSON.
        // Redirect stderr to /dev/null so log lines don't contaminate the JSON stdout.
        const listOutput = await execInPod(podName, [
          "bash", "-c",
          "npx openclaw pairing list telegram --json 2>/dev/null; exit 0",
        ]);

        logger.debug({ deploymentId: input.deploymentId, listOutput }, "pollTelegramPairing: raw list output");

        // Robustly extract the JSON array - some openclaw versions may prefix log lines
        let requests: Array<{ code: string; status?: string }>;
        try {
          let jsonStr = listOutput.trim();
          if (!jsonStr.startsWith("[")) {
            const match = jsonStr.match(/\[[\s\S]*\]/);
            jsonStr = match ? match[0] : "[]";
          }
          requests = JSON.parse(jsonStr);
        } catch {
          logger.warn({ deploymentId: input.deploymentId, listOutput }, "pollTelegramPairing: failed to parse list output");
          return { status: "waiting" as const };
        }

        if (!Array.isArray(requests) || requests.length === 0) {
          return { status: "waiting" as const };
        }

        // Find the first pending request
        const pending = requests.find((r) => !r.status || r.status === "pending");
        if (!pending) {
          const approved = requests.find((r) => r.status === "approved");
          if (approved) {
            return { status: "paired" as const };
          }
          return { status: "waiting" as const };
        }

        logger.info({ deploymentId: input.deploymentId, code: pending.code }, "pollTelegramPairing: found pending request, approving");

        // Sanitize code (expected format: uppercase alphanumeric only)
        const safeCode = pending.code.replace(/[^A-Z0-9]/gi, "");
        try {
          await execInPod(podName, [
            "bash", "-c",
            `npx openclaw pairing approve telegram ${safeCode} --notify 2>/dev/null; exit 0`,
          ]);
          logger.info({ deploymentId: input.deploymentId, code: pending.code }, "Auto-approved Telegram pairing request");
        } catch (approveErr) {
          // Pod may have restarted immediately after approval (e.g. liveness probe or configSync).
          // The approve command was fired - treat as paired regardless.
          logger.warn({ deploymentId: input.deploymentId, code: pending.code, approveErr },
            "Approve exec errored (pod likely restarted) - treating as paired");
        }

        return { status: "paired" as const };
      } catch (err) {
        logger.error({ deploymentId: input.deploymentId, err }, "Failed to poll Telegram pairing");
        return { status: "error" as const, message: String(err) };
      }
    }),

  // Test connection (placeholder - validates required fields are present)
  testConnection: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      platformId: z.string(),
      credentials: z.record(z.string()),
    }))
    .mutation(async ({ ctx, input }) => {
      // Verify deployment ownership
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });

      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const requiredKeys = PLATFORM_CREDENTIAL_KEYS[input.platformId];
      if (!requiredKeys) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `Unknown platform: ${input.platformId}` });
      }

      // Check that all required fields have values
      const missingFields: string[] = [];
      for (const key of Object.keys(requiredKeys)) {
        if (!input.credentials[key] || input.credentials[key].trim() === "") {
          missingFields.push(key);
        }
      }

      if (missingFields.length > 0) {
        return {
          success: false,
          message: `Missing required fields: ${missingFields.join(", ")}`,
        };
      }

      // TODO: Actually validate credentials against each platform's API
      // e.g., for Discord: call GET /users/@me with the bot token
      // e.g., for Slack: call auth.test with the bot token

      return {
        success: true,
        message: "Credentials look valid (format check only)",
      };
    }),
});
