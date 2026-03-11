import { db, tables } from "../db/index.js";
import { nanoid } from "nanoid";
import { logger } from "../utils/logger.js";

export async function logAdminAction(params: {
  userId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  try {
    await db.insert(tables.auditLogs).values({
      id: nanoid(),
      userId: params.userId,
      action: params.action,
      targetType: params.targetType ?? null,
      targetId: params.targetId ?? null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      ipAddress: params.ipAddress ?? null,
    });
  } catch (err) {
    logger.error({ err, ...params }, "Failed to write audit log");
  }
}
