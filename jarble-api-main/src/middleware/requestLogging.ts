import type { Request, Response, NextFunction } from "express";

/**
 * Logs every request on completion with method, URL, status code, and duration.
 * Skips /health (K8s probes every 10s) to reduce noise.
 * Uses req.log (request-scoped logger) for automatic requestId inclusion.
 */
export function requestLoggingMiddleware(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/health") {
    next();
    return;
  }

  const start = Date.now();

  res.on("finish", () => {
    const durationMs = Date.now() - start;
    const data = { method: req.method, url: req.originalUrl, statusCode: res.statusCode, durationMs };

    if (res.statusCode >= 500) {
      req.log.error(data, "request completed");
    } else if (res.statusCode >= 400) {
      req.log.warn(data, "request completed");
    } else {
      req.log.info(data, "request completed");
    }
  });

  next();
}
