/**
 * Dev-mode handler runtime - executes service handler code in-process
 * when K8s is unavailable (development mode / tests).
 *
 * Each service gets an isolated in-memory store that simulates the
 * pod's `/data/service-data/` filesystem. Handlers use a simple
 * `store` API (get/set/getAll) instead of fs calls.
 *
 * In production, handlers run inside the creator pod via kubectl exec.
 * This module provides feature parity for local dev and testing.
 */

import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("dev-handler-runtime");

// ── Per-service in-memory stores ──────────────────────────────────────────────

/** Each service gets its own key-value store */
const serviceStores = new Map<string, Map<string, unknown>>();

function getStore(serviceId: string): Map<string, unknown> {
  if (!serviceStores.has(serviceId)) {
    serviceStores.set(serviceId, new Map());
  }
  return serviceStores.get(serviceId)!;
}

/** Clear a service's store (for tests) */
export function clearStore(serviceId: string): void {
  serviceStores.delete(serviceId);
}

/** Clear all stores (for tests) */
export function clearAllStores(): void {
  serviceStores.clear();
}

/** Get raw store for inspection (tests) */
export function getStoreSnapshot(serviceId: string): Record<string, unknown> {
  const store = serviceStores.get(serviceId);
  if (!store) return {};
  return Object.fromEntries(store);
}

// ── Event subscribers for SSE streaming ───────────────────────────────────────

export type ServiceEvent = {
  serviceId: string;
  skillName: string;
  type: "mutation";
  data: unknown;
  timestamp: string;
};

type EventListener = (event: ServiceEvent) => void;

const listeners = new Map<string, Set<EventListener>>();

/** Subscribe to mutations on a service. Returns unsubscribe function. */
export function subscribe(serviceId: string, listener: EventListener): () => void {
  if (!listeners.has(serviceId)) {
    listeners.set(serviceId, new Set());
  }
  listeners.get(serviceId)!.add(listener);

  return () => {
    listeners.get(serviceId)?.delete(listener);
    if (listeners.get(serviceId)?.size === 0) {
      listeners.delete(serviceId);
    }
  };
}

/** Emit a mutation event to all subscribers */
function emit(event: ServiceEvent): void {
  const subs = listeners.get(event.serviceId);
  if (subs) {
    for (const listener of subs) {
      try {
        listener(event);
      } catch {
        // Don't let a bad listener crash the emitter
      }
    }
  }
}

/** Get subscriber count for a service (diagnostics) */
export function subscriberCount(serviceId: string): number {
  return listeners.get(serviceId)?.size ?? 0;
}

// ── Handler execution ─────────────────────────────────────────────────────────

export interface DevExecResult {
  ok: boolean;
  result?: unknown;
  error?: string;
}

/**
 * Execute handler code locally with an in-memory store.
 *
 * The handler receives:
 *   - `args`: the request body (skill input)
 *   - `context`: { env, store }
 *     - `store.get(key)` / `store.set(key, value)` / `store.getAll()`
 *       - persistent (per service) key-value store
 */
export async function executeHandlerLocally(
  serviceId: string,
  skillName: string,
  handlerCode: string,
  args: unknown,
): Promise<DevExecResult> {
  const store = getStore(serviceId);

  // Build a store API for the handler
  const storeApi = {
    get: (key: string) => {
      const val = store.get(key);
      // Return deep copy to prevent accidental mutations
      return val !== undefined ? JSON.parse(JSON.stringify(val)) : undefined;
    },
    set: (key: string, value: unknown) => {
      store.set(key, JSON.parse(JSON.stringify(value)));
    },
    getAll: () => Object.fromEntries(store),
    delete: (key: string) => store.delete(key),
  };

  const context = {
    env: { DEPLOYMENT_ID: "dev-local" },
    store: storeApi,
    serviceId,
    skillName,
  };

  try {
    // The handlerCode is a function body string.
    // We wrap it in an async function and invoke it.
    const handler = new Function("args", "context", handlerCode);
    const result = await Promise.resolve(handler(args, context));

    // Emit mutation event for SSE subscribers
    emit({
      serviceId,
      skillName,
      type: "mutation",
      data: result,
      timestamp: new Date().toISOString(),
    });

    log.debug(
      { serviceId, skillName },
      "Dev handler executed successfully",
    );

    return { ok: true, result };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn(
      { serviceId, skillName, err: message },
      "Dev handler execution failed",
    );
    return { ok: false, error: message };
  }
}
