import pino from "pino";

export const logger = pino({
  level: process.env.NODE_ENV === "production" ? "info" : "debug",
  transport: process.env.NODE_ENV === "development"
    ? { target: "pino-pretty", options: { colorize: true } }
    : undefined,
});

/** Create a child logger scoped to a module (e.g., "k8s:exec", "configSync") */
export function createModuleLogger(module: string) {
  return logger.child({ module });
}

/** Create a child logger scoped to a specific request */
export function createRequestLogger(requestId: string, userId?: string) {
  return logger.child({ requestId, ...(userId ? { userId } : {}) });
}
