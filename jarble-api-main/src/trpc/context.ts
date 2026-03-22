import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { db } from "../db/index.js";
import { createModuleLogger, createRequestLogger } from "../utils/logger.js";

const log = createModuleLogger("trpc:context");

export async function createContext({ req }: CreateExpressContextOptions) {
  // Extract Bearer token
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  const requestId = req.requestId || "unknown";

  let user: Awaited<ReturnType<typeof getUserFromToken>> | null = null;

  if (token) {
    try {
      const payload = await verifyToken(token);
      user = await getUserFromToken(payload);
    } catch (err) {
      log.warn({ err, hasToken: !!token, requestId }, "JWT verification failed");
    }
  } else {
    log.debug({ path: req.path, requestId }, "No auth token provided");
  }

  const reqLog = createRequestLogger(requestId, user?.id);

  return { user, db, requestId, log: reqLog };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
