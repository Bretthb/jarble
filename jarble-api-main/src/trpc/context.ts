import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { db } from "../db/index.js";
import { logger } from "../utils/logger.js";

export async function createContext({ req }: CreateExpressContextOptions) {
  // Extract Bearer token
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  let user = null;

  if (token) {
    try {
      const payload = await verifyToken(token);
      user = await getUserFromToken(payload);
    } catch (err) {
      logger.warn({ err, hasToken: !!token }, "JWT verification failed");
    }
  } else {
    logger.debug({ path: req.path }, "No auth token provided");
  }

  return { user, db, ip: req.ip ?? null };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
