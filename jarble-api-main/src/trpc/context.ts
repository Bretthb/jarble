import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
// Side-effect import: pulls in the `declare global { namespace Express { ... } }`
// augmentation that adds `requestId` and `log` to the Express Request type.
// Required so tsc programs that walk the import graph from this file (e.g. the
// frontend's `pnpm run check`, which resolves API source via the `jarble-api`
// path alias) include the augmentation. The API's own tsc picks it up via
// `include: ["src/**/*"]`, so this import is a no-op there.
import "../middleware/requestId.js";
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

  return { user, db, requestId, log: reqLog, ip: req.ip ?? null };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
