/**
 * Unit tests for devHandlerRuntime.ts.
 *
 * The dev handler runtime exists so service skills work in local
 * development and tests without a Kubernetes cluster — `kubectl exec`
 * is replaced by an in-process `new Function(...)` call backed by an
 * in-memory store. Production never hits this code path, but the
 * test suite and local dev rely on it heavily.
 *
 * Three contracts worth pinning:
 *
 *   1. Per-service isolation — service A and service B must not see
 *      each other's keys. A regression that aliased the global store
 *      would leak data across deployments in a multi-tenant dev env.
 *
 *   2. Deep-copy semantics — `store.get(key)` returns a clone, and
 *      `store.set(key, value)` deep-copies on the way in. This
 *      mirrors the production behavior of writing JSON to disk +
 *      reading it back, so a regression to shallow refs would let
 *      tests pass locally but fail under exec.
 *
 *   3. SSE event emission — every successful handler invocation
 *      emits a `mutation` event to subscribers. Listener errors must
 *      NOT crash the emitter (one bad subscriber does not break the
 *      whole stream).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../utils/logger.js", () => ({
  createModuleLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  clearStore,
  clearAllStores,
  getStoreSnapshot,
  subscribe,
  subscriberCount,
  executeHandlerLocally,
  type ServiceEvent,
} from "../../services/devHandlerRuntime.js";

// Module-level state means we MUST reset between tests, otherwise
// previous-test stores/subscribers leak into the next one. The
// `listeners` Map inside the SUT has no public clear hook, so we
// track every subscribe call here and unsubscribe in afterEach.
const cleanupFns: Array<() => void> = [];

function trackSubscribe(serviceId: string, listener: (e: ServiceEvent) => void) {
  const unsub = subscribe(serviceId, listener);
  cleanupFns.push(unsub);
  return unsub;
}

beforeEach(() => {
  clearAllStores();
});

afterEach(() => {
  clearAllStores();
  while (cleanupFns.length > 0) {
    const fn = cleanupFns.pop();
    try {
      fn?.();
    } catch {
      // ignore double-unsub
    }
  }
});

// ── Store API via handler ───────────────────────────────────────────────────

describe("executeHandlerLocally — store API", () => {
  it("set + get round-trip succeeds within a single handler", async () => {
    const code = `
      context.store.set("greeting", "hello");
      return { saved: context.store.get("greeting") };
    `;
    const result = await executeHandlerLocally("svc-1", "greet", code, {});
    expect(result.ok).toBe(true);
    expect((result.result as any).saved).toBe("hello");
  });

  it("persists across separate handler invocations within the same service", async () => {
    await executeHandlerLocally("svc-1", "save", `context.store.set("k", "v"); return null;`, {});
    const r2 = await executeHandlerLocally("svc-1", "load", `return context.store.get("k");`, {});
    expect(r2.result).toBe("v");
  });

  it("isolates stores between services — svc-A cannot read svc-B's keys", async () => {
    await executeHandlerLocally("svc-A", "x", `context.store.set("secret", "A-only"); return null;`, {});
    const peek = await executeHandlerLocally("svc-B", "x", `return context.store.get("secret");`, {});
    expect(peek.result).toBeUndefined();
  });

  it("deep-copies on set — mutating the original after set does not affect the stored value", async () => {
    // Pre-seed the store via a handler.
    await executeHandlerLocally("svc-1", "init", `
      const obj = { count: 1 };
      context.store.set("obj", obj);
      // Mutate locally after set.
      obj.count = 999;
      return null;
    `, {});

    // Read it back — the stored value should still be {count: 1}.
    const r = await executeHandlerLocally("svc-1", "read", `return context.store.get("obj");`, {});
    expect((r.result as any).count).toBe(1);
  });

  it("deep-copies on get — mutating the returned value does not affect later reads", async () => {
    await executeHandlerLocally("svc-1", "init", `context.store.set("obj", { count: 1 }); return null;`, {});

    // First read, mutate the copy.
    await executeHandlerLocally("svc-1", "mutate", `
      const obj = context.store.get("obj");
      obj.count = 999;
      return null;
    `, {});

    // Second read — should still be 1.
    const r = await executeHandlerLocally("svc-1", "read", `return context.store.get("obj");`, {});
    expect((r.result as any).count).toBe(1);
  });

  it("getAll returns a plain object snapshot", async () => {
    await executeHandlerLocally("svc-1", "init", `
      context.store.set("a", 1);
      context.store.set("b", 2);
      return null;
    `, {});

    const r = await executeHandlerLocally("svc-1", "all", `return context.store.getAll();`, {});
    expect(r.result).toEqual({ a: 1, b: 2 });
  });

  it("delete removes a key", async () => {
    await executeHandlerLocally("svc-1", "init", `context.store.set("k", "v"); return null;`, {});
    await executeHandlerLocally("svc-1", "del", `context.store.delete("k"); return null;`, {});
    const r = await executeHandlerLocally("svc-1", "peek", `return context.store.get("k");`, {});
    expect(r.result).toBeUndefined();
  });
});

// ── Handler execution semantics ─────────────────────────────────────────────

describe("executeHandlerLocally — execution", () => {
  it("passes args into the handler", async () => {
    const r = await executeHandlerLocally(
      "svc-1",
      "echo",
      `return { received: args };`,
      { name: "Alice", count: 3 },
    );
    expect(r.result).toEqual({ received: { name: "Alice", count: 3 } });
  });

  it("supports async handlers (returns a Promise)", async () => {
    const r = await executeHandlerLocally(
      "svc-1",
      "async-echo",
      `return Promise.resolve({ async: true, args });`,
      { x: 1 },
    );
    expect((r.result as any).async).toBe(true);
    expect((r.result as any).args).toEqual({ x: 1 });
  });

  it("captures synchronous handler errors as { ok: false, error }", async () => {
    const r = await executeHandlerLocally(
      "svc-1",
      "boom",
      `throw new Error("kaboom");`,
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("kaboom");
  });

  it("captures async rejections too", async () => {
    const r = await executeHandlerLocally(
      "svc-1",
      "boom-async",
      `return Promise.reject(new Error("async-fail"));`,
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("async-fail");
  });

  it("captures non-Error rejections as their string form", async () => {
    const r = await executeHandlerLocally(
      "svc-1",
      "boom-string",
      `throw "string-error";`,
      {},
    );
    expect(r.ok).toBe(false);
    expect(r.error).toBe("string-error");
  });

  it("exposes serviceId and skillName on the context", async () => {
    const r = await executeHandlerLocally(
      "my-svc",
      "my-skill",
      `return { serviceId: context.serviceId, skillName: context.skillName };`,
      {},
    );
    expect(r.result).toEqual({ serviceId: "my-svc", skillName: "my-skill" });
  });
});

// ── Store reset helpers ─────────────────────────────────────────────────────

describe("clearStore / clearAllStores / getStoreSnapshot", () => {
  it("getStoreSnapshot returns {} for an unknown service", () => {
    expect(getStoreSnapshot("never-touched")).toEqual({});
  });

  it("getStoreSnapshot returns a plain object of the service's keys", async () => {
    await executeHandlerLocally("svc-1", "init", `context.store.set("a", 1); context.store.set("b", 2); return null;`, {});
    expect(getStoreSnapshot("svc-1")).toEqual({ a: 1, b: 2 });
  });

  it("clearStore wipes a single service without touching others", async () => {
    await executeHandlerLocally("svc-A", "init", `context.store.set("a", 1); return null;`, {});
    await executeHandlerLocally("svc-B", "init", `context.store.set("b", 2); return null;`, {});

    clearStore("svc-A");

    expect(getStoreSnapshot("svc-A")).toEqual({});
    expect(getStoreSnapshot("svc-B")).toEqual({ b: 2 });
  });

  it("clearAllStores wipes every service", async () => {
    await executeHandlerLocally("svc-A", "init", `context.store.set("a", 1); return null;`, {});
    await executeHandlerLocally("svc-B", "init", `context.store.set("b", 2); return null;`, {});

    clearAllStores();

    expect(getStoreSnapshot("svc-A")).toEqual({});
    expect(getStoreSnapshot("svc-B")).toEqual({});
  });
});

// ── Event subscription ──────────────────────────────────────────────────────

describe("subscribe / subscriberCount", () => {
  it("emits a mutation event to subscribers on successful handler invocation", async () => {
    const events: ServiceEvent[] = [];
    trackSubscribe("svc-1", (e) => events.push(e));

    await executeHandlerLocally("svc-1", "save", `return { saved: 1 };`, {});

    expect(events).toHaveLength(1);
    expect(events[0].serviceId).toBe("svc-1");
    expect(events[0].skillName).toBe("save");
    expect(events[0].type).toBe("mutation");
    expect(events[0].data).toEqual({ saved: 1 });
    expect(typeof events[0].timestamp).toBe("string");
  });

  it("does NOT cross-emit between services", async () => {
    const aEvents: ServiceEvent[] = [];
    const bEvents: ServiceEvent[] = [];
    trackSubscribe("svc-A", (e) => aEvents.push(e));
    trackSubscribe("svc-B", (e) => bEvents.push(e));

    await executeHandlerLocally("svc-A", "x", `return null;`, {});

    expect(aEvents).toHaveLength(1);
    expect(bEvents).toHaveLength(0);
  });

  it("does NOT emit when the handler throws (failed invocations don't fire mutations)", async () => {
    const events: ServiceEvent[] = [];
    trackSubscribe("svc-1", (e) => events.push(e));

    await executeHandlerLocally("svc-1", "boom", `throw new Error("fail");`, {});

    expect(events).toHaveLength(0);
  });

  it("unsubscribe stops the listener from receiving further events", async () => {
    const events: ServiceEvent[] = [];
    const unsubscribe = trackSubscribe("svc-1", (e) => events.push(e));

    await executeHandlerLocally("svc-1", "first", `return 1;`, {});
    expect(events).toHaveLength(1);

    unsubscribe();
    await executeHandlerLocally("svc-1", "second", `return 2;`, {});
    expect(events).toHaveLength(1);
  });

  it("subscriberCount tracks adds and removes accurately", () => {
    expect(subscriberCount("svc-1")).toBe(0);

    const u1 = trackSubscribe("svc-1", () => {});
    expect(subscriberCount("svc-1")).toBe(1);

    const u2 = trackSubscribe("svc-1", () => {});
    expect(subscriberCount("svc-1")).toBe(2);

    u1();
    expect(subscriberCount("svc-1")).toBe(1);

    u2();
    expect(subscriberCount("svc-1")).toBe(0);
  });

  it("a throwing listener does not break sibling listeners", async () => {
    const seen: string[] = [];

    trackSubscribe("svc-1", () => {
      throw new Error("bad listener");
    });
    trackSubscribe("svc-1", (e) => {
      seen.push(e.skillName);
    });

    await executeHandlerLocally("svc-1", "x", `return null;`, {});

    // The good listener still saw the event despite the bad one throwing.
    expect(seen).toEqual(["x"]);
  });
});
