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

const { deployments, deploymentSecrets } = tables;

const MAX_SECRETS_PER_DEPLOYMENT = 50;
const SECRET_KEY_REGEX = /^[A-Z][A-Z0-9_]{0,127}$/;

// Env vars that cannot be overwritten by deployment secrets
export const RESERVED_ENV_VARS = new Set([
  "DEPLOYMENT_ID", "USER_ID", "DEPLOYMENT_NAME", "TEMPLATE", "RUNTIME",
  "JARBLE_API_URL", "CONFIG_WEBHOOK_SECRET", "OPENCLAW_GATEWAY_TOKEN",
  "LLM_PROVIDER", "LLM_MODEL", "AGENT_LLM_API_KEY",
  "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GOOGLE_API_KEY",
  "DISCORD_BOT_TOKEN", "TELEGRAM_BOT_TOKEN", "SLACK_BOT_TOKEN", "SLACK_APP_TOKEN",
  "TEAMS_APP_ID", "TEAMS_APP_PASSWORD", "MESSENGER_PAGE_ACCESS_TOKEN", "MESSENGER_VERIFY_TOKEN",
  "JARBLE_COMPONENTS_DIR", "JARBLE_FILES_DIR", "JARBLE_MCP_SCRIPTS_DIR",
]);

function maskValue(value: string): string {
  if (value.length <= 10) return "****";
  return `${value.slice(0, 4)}${"*".repeat(Math.min(value.length - 8, 20))}${value.slice(-4)}`;
}

function validateSecretKey(key: string) {
  if (!SECRET_KEY_REGEX.test(key)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid key format. Must match ${SECRET_KEY_REGEX} (uppercase letters, digits, underscores, starting with a letter)`,
    });
  }
  if (RESERVED_ENV_VARS.has(key)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `"${key}" is a reserved environment variable and cannot be used`,
    });
  }
}

async function checkSecretCount(deploymentId: string) {
  const existing = await db.query.deploymentSecrets.findMany({
    where: eq(deploymentSecrets.deploymentId, deploymentId),
  });
  if (existing.length >= MAX_SECRETS_PER_DEPLOYMENT) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Maximum of ${MAX_SECRETS_PER_DEPLOYMENT} secrets per deployment reached`,
    });
  }
}

export const deploymentSecretsRouter = router({
  getByDeployment: protectedProcedure
    .input(z.object({ deploymentId: z.string() }))
    .query(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      const secrets = await ctx.db.query.deploymentSecrets.findMany({
        where: eq(deploymentSecrets.deploymentId, input.deploymentId),
      });

      return secrets.map((s) => {
        const scope = (s as any).scope || "shared";
        let maskedValue = "****";
        // User-scope secrets are client-encrypted — server can't decrypt them.
        // Show a placeholder instead of trying to decrypt.
        if (scope === "user") {
          maskedValue = "[client-encrypted]";
        } else {
          try {
            maskedValue = maskValue(decryptApiKey(s.value));
          } catch {
            logger.warn({ secretId: s.id }, "Failed to decrypt deployment secret");
          }
        }
        return {
          id: s.id,
          key: s.key,
          maskedValue,
          source: s.source,
          scope,
          createdAt: s.createdAt,
          updatedAt: s.updatedAt,
        };
      });
    }),

  save: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      key: z.string(),
      value: z.string().min(1).max(10240),
      /** Credential scope: shared (bot+user), bot (bot-only), user (client-encrypted, server can't decrypt) */
      scope: z.enum(["shared", "bot", "user"]).default("shared"),
    }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      validateSecretKey(input.key);

      // For "user" scope: the value is already client-side encrypted — store as-is.
      // For "shared"/"bot" scope: server-side encrypt with AES-256-GCM.
      const encrypted = input.scope === "user" ? input.value : encryptApiKey(input.value);

      const existing = await ctx.db.query.deploymentSecrets.findFirst({
        where: and(
          eq(deploymentSecrets.deploymentId, input.deploymentId),
          eq(deploymentSecrets.key, input.key),
        ),
      });

      if (existing) {
        await ctx.db.update(deploymentSecrets)
          .set({ value: encrypted, source: "user", scope: input.scope, updatedAt: dbDate() })
          .where(eq(deploymentSecrets.id, existing.id));
        logger.info({ deploymentId: input.deploymentId, key: input.key, scope: input.scope }, "Deployment secret updated");
      } else {
        await checkSecretCount(input.deploymentId);
        await ctx.db.insert(deploymentSecrets).values({
          id: nanoid(12),
          deploymentId: input.deploymentId,
          key: input.key,
          value: encrypted,
          source: "user",
          scope: input.scope,
        });
        logger.info({ deploymentId: input.deploymentId, key: input.key }, "Deployment secret created");
      }

      safeFireAndForget(syncConfigsToPvc(input.deploymentId), {
        operation: "syncConfigsToPvc",
        deploymentId: input.deploymentId,
      });

      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({
      deploymentId: z.string(),
      key: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const deployment = await ctx.db.query.deployments.findFirst({
        where: and(eq(deployments.id, input.deploymentId), eq(deployments.userId, ctx.user.id)),
      });
      if (!deployment) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Deployment not found" });
      }

      await ctx.db.delete(deploymentSecrets)
        .where(and(
          eq(deploymentSecrets.deploymentId, input.deploymentId),
          eq(deploymentSecrets.key, input.key),
        ));

      logger.info({ deploymentId: input.deploymentId, key: input.key }, "Deployment secret deleted");

      safeFireAndForget(syncConfigsToPvc(input.deploymentId), {
        operation: "syncConfigsToPvc",
        deploymentId: input.deploymentId,
      });

      return { success: true };
    }),
});
