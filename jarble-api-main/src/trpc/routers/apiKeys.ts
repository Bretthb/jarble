/**
 * API Keys tRPC Router
 *
 * Manages API keys for external mesh access.
 * Users create/revoke keys from the dashboard Settings page.
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { eq, and, isNull } from "drizzle-orm";
import { db, tables } from "../../db/index.js";
import { router, protectedProcedure } from "../middleware.js";
import { generateApiKey, hashApiKey } from "../../middleware/apiKeyAuth.js";
import { createModuleLogger } from "../../utils/logger.js";

const log = createModuleLogger("apiKeys");

export const apiKeysRouter = router({
  /**
   * List all API keys for the current user.
   * Returns key metadata (never the raw key itself).
   */
  list: protectedProcedure.query(async ({ ctx }) => {
    const keys = await (db.query as any).apiKeys?.findMany?.({
      where: and(
        eq(tables.apiKeys.userId, ctx.user.id),
        isNull(tables.apiKeys.revokedAt),
      ),
    }) ?? [];

    return keys.map((k: any) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scopes: k.scopes,
      rateLimitPerMin: k.rateLimitPerMin,
      rateLimitPerDay: k.rateLimitPerDay,
      lastUsedAt: k.lastUsedAt,
      requestCount: k.requestCount,
      expiresAt: k.expiresAt,
      createdAt: k.createdAt,
    }));
  }),

  /**
   * Create a new API key.
   * Returns the raw key exactly once - it cannot be retrieved later.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        scopes: z.string().optional().default("mesh:read,mesh:write"),
        rateLimitPerMin: z.number().int().min(1).max(1000).optional().default(60),
        rateLimitPerDay: z.number().int().min(1).max(100000).optional().default(10000),
        expiresInDays: z.number().int().min(1).max(365).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Limit: max 10 active keys per user
      const existingCount = await (db.query as any).apiKeys?.findMany?.({
        where: and(
          eq(tables.apiKeys.userId, ctx.user.id),
          isNull(tables.apiKeys.revokedAt),
        ),
      });
      if (existingCount && existingCount.length >= 10) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Maximum 10 active API keys per user",
        });
      }

      const rawKey = generateApiKey();
      const keyHash = hashApiKey(rawKey);
      const keyPrefix = rawKey.slice(0, 12); // "jrbl_" + first 7 chars of random

      const expiresAt = input.expiresInDays
        ? new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString()
        : null;

      // Generate a stable ID since MySQL doesn't have RETURNING
      const { nanoid } = await import("nanoid");
      const keyId = `ak_${nanoid(12)}`;

      await db.insert(tables.apiKeys).values({
        id: keyId,
        userId: ctx.user.id,
        name: input.name,
        keyHash,
        keyPrefix,
        scopes: input.scopes,
        rateLimitPerMin: input.rateLimitPerMin,
        rateLimitPerDay: input.rateLimitPerDay,
        expiresAt,
      } as any);

      log.info({ userId: ctx.user.id, keyId, name: input.name }, "API key created");

      return {
        id: keyId,
        key: rawKey, // Only returned once!
        name: input.name,
        keyPrefix,
        scopes: input.scopes,
        expiresAt,
      };
    }),

  /**
   * Revoke an API key.
   */
  revoke: protectedProcedure
    .input(z.object({ keyId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership
      const key = await (db.query as any).apiKeys?.findFirst?.({
        where: and(
          eq(tables.apiKeys.id, input.keyId),
          eq(tables.apiKeys.userId, ctx.user.id),
        ),
      });

      if (!key) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }

      await db.update(tables.apiKeys)
        .set({ revokedAt: new Date().toISOString() } as any)
        .where(eq(tables.apiKeys.id, input.keyId));

      log.info({ userId: ctx.user.id, keyId: input.keyId }, "API key revoked");
      return { success: true };
    }),

  /**
   * Get usage statistics for an API key.
   */
  usage: protectedProcedure
    .input(z.object({ keyId: z.string() }))
    .query(async ({ ctx, input }) => {
      const key = await (db.query as any).apiKeys?.findFirst?.({
        where: and(
          eq(tables.apiKeys.id, input.keyId),
          eq(tables.apiKeys.userId, ctx.user.id),
        ),
      });

      if (!key) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "API key not found",
        });
      }

      return {
        keyId: key.id,
        name: key.name,
        requestCount: key.requestCount,
        lastUsedAt: key.lastUsedAt,
        createdAt: key.createdAt,
        revokedAt: key.revokedAt,
      };
    }),
});
