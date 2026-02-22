import type express from "express";
import { verifyToken, getUserFromToken } from "../services/auth.js";

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
  } catch {
    return null;
  }
}
