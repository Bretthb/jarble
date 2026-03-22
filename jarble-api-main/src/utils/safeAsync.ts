import { logger } from "./logger.js";

export function safeFireAndForget(
  promise: Promise<unknown>,
  context: { operation: string; deploymentId?: string; [key: string]: unknown }
): void {
  promise.catch((err) => {
    logger.error({ err, ...context }, `Fire-and-forget failed: ${context.operation}`);
  });
}
