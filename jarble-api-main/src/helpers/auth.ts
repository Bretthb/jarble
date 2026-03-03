import type express from "express";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("auth:helper");

/**
 * Extract authenticated user from the Authorization header.
 * Returns null if no valid token is present.
 */
export async function getUserFromRequest(req: express.Request) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  try {
    const payload = await verifyToken(token);
    return await getUserFromToken(payload);
  } catch (err) {
    log.warn({ err, path: req.path }, "getUserFromRequest: JWT verification failed");
    return null;
  }
}
