import type { Request, Response, NextFunction } from "express";
import { nanoid } from "nanoid";
import { createRequestLogger } from "../utils/logger.js";
import type { Logger } from "pino";

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      log: Logger;
    }
  }
}

/**
 * Attaches a unique requestId and a scoped Pino child logger to every request.
 * Respects incoming X-Request-ID header (e.g., from Traefik).
 */
export function requestIdMiddleware(req: Request, _res: Response, next: NextFunction) {
  const requestId = (req.headers["x-request-id"] as string) || nanoid(12);
  req.requestId = requestId;
  req.log = createRequestLogger(requestId);
  next();
}
