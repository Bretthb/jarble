import { z } from "zod";
import { router, protectedProcedure } from "../middleware.js";
import { tables } from "../../db/index.js";
import { eq, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { logger } from "../../utils/logger.js";
import { TRPCError } from "@trpc/server";
import { encryptApiKey, decryptApiKey } from "../../utils/encryption.js";

const { deployments, platformCredentials } = tables;

// ── OpenClaw channel config mapping ─────────────────────────────────────────
// Maps platformId → { frontendFieldKey → openClawJsonChannelKey }
// Used when writing openclaw.json { channels: { discord: { token: "..." } } }
export const PLATFORM_CREDENTIAL_KEYS: Record<string, Record<string, string>> = {
  discord: { botToken: "token" },                 // channels.discord.token
  telegram: { botToken: "botToken" },             // channels.telegram.botToken
  slack: { botToken: "botToken", appToken: "appToken" },
  whatsapp: {},                                    // QR pairing via Baileys — no tokens
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
      return creds.map((cred: any) => {
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
        await (ctx.db as any).update(platformCredentials)
          .set({
            credentials: encrypted,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(platformCredentials.id, (existing as any).id));

        logger.info({
          deploymentId: input.deploymentId,
          platformId: input.platformId,
        }, "Platform credentials updated");
      } else {
        // Insert
        await (ctx.db as any).insert(platformCredentials).values({
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

      await (ctx.db as any).delete(platformCredentials)
        .where(and(
          eq(platformCredentials.deploymentId, input.deploymentId),
          eq(platformCredentials.platformId, input.platformId),
        ));

      logger.info({
        deploymentId: input.deploymentId,
        platformId: input.platformId,
      }, "Platform credentials deleted");

      return { success: true };
    }),

  // Test connection (placeholder — validates required fields are present)
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
