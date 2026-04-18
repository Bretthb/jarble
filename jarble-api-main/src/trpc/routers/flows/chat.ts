/**
 * Flow chat procedures — persisted bot-team chat sessions attached to flows.
 *
 * Extracted from flows.ts as part of JAR-108 (sub-ticket of JAR-85). The
 * split keeps the 4 chat-related procedures (`getChatSessions`,
 * `getChatMessages`, `renameChatSession`, `deleteChatSession`) plus their
 * schema-backcompat helpers (`getFlowChatTables`, `isMissingTableError`)
 * in one focused module so the main flows router stays under budget.
 *
 * The procedures are exported as an object (`flowsChatProcedures`) so
 * `flows.ts` can spread them into its `router({ ... })` call alongside
 * the CRUD / execution procedures — no router nesting, no path changes.
 */

import { z } from "zod";
import { protectedProcedure } from "../../middleware.js";
import { db, tables, dbDate } from "../../../db/index.js";
import { eq, desc, asc, and, sql, lt } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { createModuleLogger } from "../../../utils/logger.js";
import { noHtmlTags, NO_HTML_MESSAGE } from "../../../utils/sanitize.js";

const logger = createModuleLogger("flows.chat");

const { orchestrationFlows } = tables;

// ── Flow chat persistence helpers ────────────────────────────────────────
// flowChatSessions / flowChatMessages were introduced in migration
// 0007_lyrical_callisto.sql which has not yet been applied to all
// environments. We access them dynamically and gracefully degrade to
// empty results if either the table is missing from the schema bundle
// (legacy build) or the underlying SQL relation doesn't exist yet.

export function getFlowChatTables(): {
  sessions: any | null;
  messages: any | null;
} {
  const t = tables as any;
  return {
    sessions: t.flowChatSessions ?? null,
    messages: t.flowChatMessages ?? null,
  };
}

/**
 * Detect Postgres "relation does not exist" / SQLite "no such table"
 * style errors so we can return an empty result instead of crashing the
 * whole procedure when the migration hasn't been applied yet.
 */
export function isMissingTableError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { code?: unknown; message?: unknown };
  if (typeof e.code === "string" && e.code === "42P01") return true;
  const msg = typeof e.message === "string" ? e.message.toLowerCase() : "";
  return (
    msg.includes("does not exist") ||
    msg.includes("no such table") ||
    msg.includes("relation") && msg.includes("does not exist")
  );
}

export const flowsChatProcedures = {
  /**
   * List the persisted bot-team chat sessions for a flow owned by the
   * caller. Each session corresponds to a single conversation thread; the
   * write path is in `routes/flowChat.ts`.
   *
   * Gracefully returns an empty array if migration 0007_lyrical_callisto
   * has not yet been applied (the underlying tables don't exist).
   */
  getChatSessions: protectedProcedure
    .input(z.object({ flowId: z.string() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      // 1. Verify flow ownership — same pattern as getById / listExecutions.
      const flow = await db
        .select({ id: orchestrationFlows.id })
        .from(orchestrationFlows)
        .where(
          and(
            eq(orchestrationFlows.id, input.flowId),
            eq(orchestrationFlows.userId, userId)
          )
        )
        .limit(1);

      if (flow.length === 0) {
        // Don't reveal whether the flow exists for another user — return
        // an empty list rather than 404. This matches the "no sessions"
        // case from the caller's perspective and avoids leaking ownership.
        logger.warn(
          { flowId: input.flowId, userId },
          "getChatSessions: flow not owned by caller"
        );
        return [] as Array<{
          id: string;
          flowId: string;
          title: string | null;
          createdAt: Date | string | null;
          updatedAt: Date | string | null;
          messageCount: number;
        }>;
      }

      const { sessions: flowChatSessions, messages: flowChatMessages } =
        getFlowChatTables();
      if (!flowChatSessions) {
        logger.warn(
          { flowId: input.flowId },
          "getChatSessions: flowChatSessions table not registered in schema bundle — returning []"
        );
        return [];
      }

      try {
        // `messageCount` is computed via a correlated subquery so the
        // query stays a single round-trip and the picker UI can render
        // "Title · N msgs" without a second fetch per session. If the
        // messages table is missing from the schema bundle we fall back
        // to 0 — the picker just hides the badge when count is 0.
        const messageCountExpr = flowChatMessages
          ? sql<number>`(select count(*) from ${flowChatMessages} where ${flowChatMessages.sessionId} = ${flowChatSessions.id})`
          : sql<number>`0`;

        const rows = await db
          .select({
            id: flowChatSessions.id,
            flowId: flowChatSessions.flowId,
            title: flowChatSessions.title,
            createdAt: flowChatSessions.createdAt,
            updatedAt: flowChatSessions.updatedAt,
            messageCount: messageCountExpr,
          })
          .from(flowChatSessions)
          .where(
            and(
              eq(flowChatSessions.flowId, input.flowId),
              eq(flowChatSessions.userId, userId)
            )
          )
          .orderBy(desc(flowChatSessions.updatedAt))
          .limit(50);

        // Coerce messageCount to a JS number — some drivers return
        // bigint / string for count(*) depending on dialect.
        return rows.map((r) => ({
          ...r,
          messageCount: Number(r.messageCount ?? 0),
        }));
      } catch (err) {
        if (isMissingTableError(err)) {
          logger.warn(
            { flowId: input.flowId, err: err instanceof Error ? err.message : String(err) },
            "getChatSessions: underlying table missing (migration 0007 not applied?) — returning []"
          );
          return [];
        }
        // Any other DB hiccup: log and degrade rather than crashing the
        // whole chat panel — chat history is non-critical.
        logger.error(
          { flowId: input.flowId, err: err instanceof Error ? err.message : String(err) },
          "getChatSessions: unexpected DB error — returning []"
        );
        return [];
      }
    }),

  /**
   * List persisted chat messages for a single session.
   *
   * Ownership is enforced via an INNER JOIN against `flow_chat_sessions`
   * filtered by `userId`. This means a malicious caller cannot read
   * messages even if they guess a sessionId — the join will return zero
   * rows when the session doesn't belong to them.
   *
   * Gracefully returns an empty array if migration 0007 hasn't been
   * applied yet.
   */
  getChatMessages: protectedProcedure
    .input(
      z.object({
        sessionId: z.string(),
        limit: z.number().int().min(1).max(500).default(200),
        // Cursor for "load older" pagination. When provided, returns the
        // `limit` messages immediately preceding (older than) the message
        // with this id. The cursor message itself is NOT included in the
        // result. Ownership of the cursor is enforced via the same JOIN
        // posture as the data query — a forged id from another user
        // simply yields []. The result is always ordered ASC regardless
        // of pagination direction so the client can prepend it directly.
        beforeId: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const { sessions: flowChatSessions, messages: flowChatMessages } =
        getFlowChatTables();
      if (!flowChatSessions || !flowChatMessages) {
        logger.warn(
          { sessionId: input.sessionId },
          "getChatMessages: flow chat tables not registered in schema bundle — returning []"
        );
        return [];
      }

      try {
        // ── Pagination cursor resolution ─────────────────────────────
        // When `beforeId` is set, look up its createdAt timestamp inside
        // the same INNER JOIN-ownership envelope so that:
        //   1. A forged cursor from another user yields [] (no leak)
        //   2. A cursor for a different session yields [] (no leak)
        //   3. A non-existent cursor yields [] (no crash)
        // We resolve to a `createdAt` value rather than relying on row id
        // ordering so that messages inserted out-of-order (e.g. delegated
        // bot replies that arrive late) still paginate consistently.
        let cursorCreatedAt: Date | string | number | null = null;
        if (input.beforeId) {
          const cursorRows = await db
            .select({ createdAt: flowChatMessages.createdAt })
            .from(flowChatMessages)
            .innerJoin(
              flowChatSessions,
              eq(flowChatMessages.sessionId, flowChatSessions.id)
            )
            .where(
              and(
                eq(flowChatMessages.id, input.beforeId),
                eq(flowChatMessages.sessionId, input.sessionId),
                eq(flowChatSessions.userId, userId)
              )
            )
            .limit(1);

          if (cursorRows.length === 0) {
            // Cursor not found (forged, deleted, or wrong session) —
            // return empty rather than 404 so the client just shows
            // "no older messages" without breaking the panel.
            return [];
          }
          cursorCreatedAt = cursorRows[0].createdAt as
            | Date
            | string
            | number
            | null;
        }

        // INNER JOIN enforces ownership — if the session belongs to a
        // different user, the join produces zero rows and we return [].
        // When paginating with a cursor we order DESC + slice + reverse
        // so the result is always ASC for the client.
        const baseConditions = [
          eq(flowChatMessages.sessionId, input.sessionId),
          eq(flowChatSessions.userId, userId),
        ];
        if (cursorCreatedAt !== null) {
          baseConditions.push(
            lt(flowChatMessages.createdAt, cursorCreatedAt as any)
          );
        }

        const rows = await db
          .select({
            id: flowChatMessages.id,
            sessionId: flowChatMessages.sessionId,
            role: flowChatMessages.role,
            content: flowChatMessages.content,
            sourceNodeId: flowChatMessages.sourceNodeId,
            sourceDeploymentId: flowChatMessages.sourceDeploymentId,
            delegationToolName: flowChatMessages.delegationToolName,
            createdAt: flowChatMessages.createdAt,
          })
          .from(flowChatMessages)
          .innerJoin(
            flowChatSessions,
            eq(flowChatMessages.sessionId, flowChatSessions.id)
          )
          .where(and(...baseConditions))
          .orderBy(
            cursorCreatedAt !== null
              ? desc(flowChatMessages.createdAt)
              : asc(flowChatMessages.createdAt)
          )
          .limit(input.limit);

        // Cursor branch: we slurped DESC (newest of the older window
        // first) — reverse to restore the ASC contract.
        if (cursorCreatedAt !== null) {
          return rows.slice().reverse();
        }
        return rows;
      } catch (err) {
        if (isMissingTableError(err)) {
          logger.warn(
            { sessionId: input.sessionId, err: err instanceof Error ? err.message : String(err) },
            "getChatMessages: underlying table missing (migration 0007 not applied?) — returning []"
          );
          return [];
        }
        logger.error(
          { sessionId: input.sessionId, err: err instanceof Error ? err.message : String(err) },
          "getChatMessages: unexpected DB error — returning []"
        );
        return [];
      }
    }),

  /**
   * Rename a single chat session. Ownership is enforced in the UPDATE
   * WHERE clause so a forged sessionId from another user silently
   * updates zero rows and returns `{ success: false }` without leaking
   * whether the session exists. Titles are sanitized against stray
   * HTML via the same `noHtmlTags` helper the rest of the router uses.
   *
   * Gracefully no-ops if migration 0007 hasn't been applied yet.
   */
  renameChatSession: protectedProcedure
    .input(
      z.object({
        sessionId: z.string().min(1),
        title: z
          .string()
          .min(1)
          .max(255)
          .refine(noHtmlTags, NO_HTML_MESSAGE),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const { sessions: flowChatSessions } = getFlowChatTables();
      if (!flowChatSessions) {
        logger.warn(
          { sessionId: input.sessionId },
          "renameChatSession: flowChatSessions table not registered in schema bundle — no-op"
        );
        return { success: false };
      }

      try {
        // UPDATE ... WHERE id AND user_id — a non-owner's forged id
        // matches zero rows and the update is a no-op. We don't 404
        // because we don't want to leak whether the session exists.
        await db
          .update(flowChatSessions)
          .set({ title: input.title, updatedAt: dbDate() })
          .where(
            and(
              eq(flowChatSessions.id, input.sessionId),
              eq(flowChatSessions.userId, userId)
            )
          );

        return { success: true };
      } catch (err) {
        if (isMissingTableError(err)) {
          logger.warn(
            {
              sessionId: input.sessionId,
              err: err instanceof Error ? err.message : String(err),
            },
            "renameChatSession: underlying table missing — no-op"
          );
          return { success: false };
        }
        logger.error(
          {
            sessionId: input.sessionId,
            err: err instanceof Error ? err.message : String(err),
          },
          "renameChatSession: unexpected DB error"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to rename chat session",
        });
      }
    }),

  /**
   * Delete a chat session and its messages. Ownership is verified via
   * a SELECT inside the same transaction as the DELETE so a forged
   * sessionId from another user silently no-ops without leaking
   * whether the target row exists. Messages are deleted BEFORE the
   * session row because `flow_chat_messages.session_id` does not have
   * an ON DELETE CASCADE constraint (see schema.pg.ts:345) — deleting
   * the session first would orphan its messages.
   *
   * Gracefully no-ops if migration 0007 hasn't been applied yet.
   */
  deleteChatSession: protectedProcedure
    .input(z.object({ sessionId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;

      const { sessions: flowChatSessions, messages: flowChatMessages } =
        getFlowChatTables();
      if (!flowChatSessions || !flowChatMessages) {
        logger.warn(
          { sessionId: input.sessionId },
          "deleteChatSession: flow chat tables not registered in schema bundle — no-op"
        );
        return { success: false, messagesDeleted: 0 };
      }

      try {
        // Use a transaction so either both deletes succeed or neither
        // does — we don't want to leave orphan messages around if the
        // session delete fails mid-flight.
        let messagesDeleted = 0;
        const result = await db.transaction(async (tx) => {
          // 1. Verify ownership inside the transaction. A forged id
          //    from another user yields zero rows and we bail without
          //    doing any writes.
          const ownedRows = await tx
            .select({ id: flowChatSessions.id })
            .from(flowChatSessions)
            .where(
              and(
                eq(flowChatSessions.id, input.sessionId),
                eq(flowChatSessions.userId, userId)
              )
            )
            .limit(1);

          if (ownedRows.length === 0) {
            return { success: false, messagesDeleted: 0 };
          }

          // 2. Count + delete messages. We issue a count(*) before the
          //    delete so the caller gets a concrete messagesDeleted
          //    number — drizzle-orm doesn't expose rowCount uniformly
          //    across dialects.
          const countRows = await tx
            .select({ c: sql<number>`count(*)` })
            .from(flowChatMessages)
            .where(eq(flowChatMessages.sessionId, input.sessionId));
          messagesDeleted = Number(countRows[0]?.c ?? 0);

          await tx
            .delete(flowChatMessages)
            .where(eq(flowChatMessages.sessionId, input.sessionId));

          // 3. Delete the session itself (ownership already verified
          //    above, but we re-filter on user_id as defense-in-depth).
          await tx
            .delete(flowChatSessions)
            .where(
              and(
                eq(flowChatSessions.id, input.sessionId),
                eq(flowChatSessions.userId, userId)
              )
            );

          return { success: true, messagesDeleted };
        });

        return result;
      } catch (err) {
        if (isMissingTableError(err)) {
          logger.warn(
            {
              sessionId: input.sessionId,
              err: err instanceof Error ? err.message : String(err),
            },
            "deleteChatSession: underlying table missing — no-op"
          );
          return { success: false, messagesDeleted: 0 };
        }
        logger.error(
          {
            sessionId: input.sessionId,
            err: err instanceof Error ? err.message : String(err),
          },
          "deleteChatSession: unexpected DB error"
        );
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete chat session",
        });
      }
    }),
};
