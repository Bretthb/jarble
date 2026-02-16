/**
 * ═══════════════════════════════════════════════════════════════════════
 * Runtime Registry — Single entry point for runtime handler lookup.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * All runtime handlers are registered here. The deployment router and
 * K8s layer import from this module to get the correct handler for a
 * deployment's runtime slug.
 *
 * HOW TO ADD A NEW RUNTIME:
 *   1. Create src/runtimes/handlers/yourruntime.ts implementing RuntimeHandler
 *   2. Import it here and add it to HANDLERS
 *   That's it — deployment router and K8s layer pick it up automatically.
 */

import type { RuntimeHandler } from "./types.js";
import { openclawHandler } from "./handlers/openclaw.js";
import { zeroclawHandler } from "./handlers/zeroclaw.js";
import { logger } from "../utils/logger.js";

// ─── Registry ─────────────────────────────────────────────────────────

const HANDLERS: Record<string, RuntimeHandler> = {
  [openclawHandler.slug]: openclawHandler,
  [zeroclawHandler.slug]: zeroclawHandler,
};

/**
 * Get the handler for a runtime slug.
 * Throws if the runtime is not registered (should never happen for valid deployments).
 */
export function getHandler(runtimeSlug: string): RuntimeHandler {
  const handler = HANDLERS[runtimeSlug];
  if (!handler) {
    throw new Error(`No runtime handler registered for slug: "${runtimeSlug}"`);
  }
  return handler;
}

/**
 * Get the handler for a runtime slug, or null if not registered.
 * Use this when the caller can gracefully handle unknown runtimes.
 */
export function getHandlerOrNull(runtimeSlug: string): RuntimeHandler | null {
  return HANDLERS[runtimeSlug] ?? null;
}

/**
 * Check if a handler exists for a runtime slug.
 */
export function hasHandler(runtimeSlug: string): boolean {
  return runtimeSlug in HANDLERS;
}

/**
 * List all registered runtime slugs.
 */
export function listRegisteredRuntimes(): string[] {
  return Object.keys(HANDLERS);
}

// Log registered handlers at import time
logger.info(
  { runtimes: listRegisteredRuntimes() },
  "Runtime registry initialized"
);

// ─── Re-exports ───────────────────────────────────────────────────────

export type {
  RuntimeHandler,
  ConfigFile,
  ConfigFileSpec,
  DeploymentFields,
  ParsedDeploymentFields,
  RuntimeCapabilities,
} from "./types.js";
