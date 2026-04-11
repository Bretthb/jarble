/**
 * Tests for the per-session exec lock helper.
 *
 * The lock is a FIFO promise chain keyed by session string. Each caller waits
 * for the previous caller's promise to settle (fulfilled or rejected) before
 * running. Different session keys run in parallel.
 *
 * Cycle 15 of the 2026-04-11 bot teams QA marathon — consolidated from
 * duplicate implementations in flowChat.ts and tamboAgent.ts.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  withSessionLock,
  _getSessionLockCountForTest,
  _hasSessionLockForTest,
  _clearSessionLocksForTest,
} from "./sessionLock.js";

// Tiny promise-controlled work helper — lets us observe when calls start
// and finish relative to each other without timing assumptions.
function makeDeferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// Flush microtasks — lets pending `.then` callbacks run
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("withSessionLock", () => {
  beforeEach(() => {
    _clearSessionLocksForTest();
  });

  it("runs a single call immediately", async () => {
    const result = await withSessionLock("key-a", async () => 42);
    expect(result).toBe(42);
  });

  it("preserves the return type (generic)", async () => {
    const n = await withSessionLock("k", async () => 7);
    const s = await withSessionLock("k", async () => "hello");
    const o = await withSessionLock("k", async () => ({ foo: "bar" }));
    expect(n).toBe(7);
    expect(s).toBe("hello");
    expect(o).toEqual({ foo: "bar" });
  });

  it("serializes concurrent calls on the same session key (FIFO)", async () => {
    const started: string[] = [];
    const finished: string[] = [];
    const aDone = makeDeferred<void>();
    const bDone = makeDeferred<void>();

    const pA = withSessionLock("k1", async () => {
      started.push("A");
      await aDone.promise;
      finished.push("A");
      return "A-result";
    });
    const pB = withSessionLock("k1", async () => {
      started.push("B");
      await bDone.promise;
      finished.push("B");
      return "B-result";
    });

    // After a microtask flush, only A should have started (B queued behind it)
    await flush();
    expect(started).toEqual(["A"]);
    expect(finished).toEqual([]);

    // Release A — B should then start
    aDone.resolve();
    const aResult = await pA;
    expect(aResult).toBe("A-result");
    await flush();
    expect(started).toEqual(["A", "B"]);

    // Release B
    bDone.resolve();
    const bResult = await pB;
    expect(bResult).toBe("B-result");
    expect(finished).toEqual(["A", "B"]);
  });

  it("runs different session keys in parallel", async () => {
    const started: string[] = [];
    const aDone = makeDeferred<void>();
    const bDone = makeDeferred<void>();

    withSessionLock("key-alpha", async () => {
      started.push("alpha");
      await aDone.promise;
      return "a";
    });
    withSessionLock("key-beta", async () => {
      started.push("beta");
      await bDone.promise;
      return "b";
    });

    await flush();
    // Both should have started — they're on different keys
    expect(started.sort()).toEqual(["alpha", "beta"]);

    aDone.resolve();
    bDone.resolve();
    await flush();
  });

  it("does not poison the chain when a prior call rejects", async () => {
    // If A throws, B should still run to completion — the chain uses
    // `prev.then(fn, fn)` which calls fn on both settle branches.
    const pA = withSessionLock("k2", async () => {
      throw new Error("A failed");
    });
    const pB = withSessionLock("k2", async () => "B ran");

    // A should reject
    await expect(pA).rejects.toThrow("A failed");
    // B should still succeed
    await expect(pB).resolves.toBe("B ran");
  });

  it("does not poison the chain across multiple consecutive failures", async () => {
    await expect(
      withSessionLock("k3", async () => {
        throw new Error("err1");
      }),
    ).rejects.toThrow("err1");
    await expect(
      withSessionLock("k3", async () => {
        throw new Error("err2");
      }),
    ).rejects.toThrow("err2");
    await expect(
      withSessionLock("k3", async () => "recovered"),
    ).resolves.toBe("recovered");
  });

  it("cleans up the map entry after the last call settles", async () => {
    expect(_getSessionLockCountForTest()).toBe(0);
    const p = withSessionLock("cleanup-key", async () => "ok");
    // Entry exists during the call
    expect(_hasSessionLockForTest("cleanup-key")).toBe(true);
    await p;
    // Give the .finally handler a microtask to run
    await flush();
    // Entry should be gone
    expect(_hasSessionLockForTest("cleanup-key")).toBe(false);
    expect(_getSessionLockCountForTest()).toBe(0);
  });

  it("does not delete the entry when a later call has advanced the chain", async () => {
    // Start A, then immediately start B — B should replace A as the head.
    // After A finishes, its cleanup should NOT delete the entry because
    // the current head is now B's promise.
    const aDone = makeDeferred<void>();
    const bDone = makeDeferred<void>();
    const pA = withSessionLock("race-key", async () => {
      await aDone.promise;
      return "A";
    });
    const pB = withSessionLock("race-key", async () => {
      await bDone.promise;
      return "B";
    });
    await flush();
    // Release A first
    aDone.resolve();
    await pA;
    await flush();
    // Entry still exists because B is the current head
    expect(_hasSessionLockForTest("race-key")).toBe(true);
    // Now release B
    bDone.resolve();
    await pB;
    await flush();
    // Entry gone after B finishes and cleanup runs
    expect(_hasSessionLockForTest("race-key")).toBe(false);
  });

  it("handles a fan-out burst (10 concurrent calls on same key) in FIFO order", async () => {
    const finished: number[] = [];
    const promises = Array.from({ length: 10 }, (_, i) =>
      withSessionLock("burst-key", async () => {
        // Tiny delay to force interleaving opportunities
        await new Promise((r) => setImmediate(r));
        finished.push(i);
        return i;
      }),
    );
    const results = await Promise.all(promises);
    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    // Despite concurrent starts, finish order must match enqueue order
    expect(finished).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("handles multiple session keys under concurrent load without cross-talk", async () => {
    const finishedPerKey: Record<string, number[]> = { k1: [], k2: [], k3: [] };
    const keys = ["k1", "k2", "k3"];
    const promises: Promise<unknown>[] = [];
    // 5 calls per key, interleaved enqueue order
    for (let round = 0; round < 5; round++) {
      for (const k of keys) {
        promises.push(
          withSessionLock(k, async () => {
            await new Promise((r) => setImmediate(r));
            finishedPerKey[k].push(round);
            return { k, round };
          }),
        );
      }
    }
    await Promise.all(promises);
    // Within each key, rounds ran in FIFO order
    expect(finishedPerKey.k1).toEqual([0, 1, 2, 3, 4]);
    expect(finishedPerKey.k2).toEqual([0, 1, 2, 3, 4]);
    expect(finishedPerKey.k3).toEqual([0, 1, 2, 3, 4]);
  });

  it("does not leak memory when many unique keys are used once each", async () => {
    _clearSessionLocksForTest();
    const keys = Array.from({ length: 50 }, (_, i) => `leak-${i}`);
    await Promise.all(
      keys.map((k) => withSessionLock(k, async () => k.length)),
    );
    // Flush any pending cleanup callbacks
    await flush();
    await flush();
    expect(_getSessionLockCountForTest()).toBe(0);
  });

  it("tolerates a synchronously thrown error inside fn", async () => {
    // fn() throws synchronously (not via async await). Because we wrap as
    // `async () => { throw }`, the rejection still propagates through the
    // returned promise.
    await expect(
      withSessionLock("sync-err", async () => {
        throw new Error("sync boom");
      }),
    ).rejects.toThrow("sync boom");
    // Next call still works
    await expect(
      withSessionLock("sync-err", async () => "after"),
    ).resolves.toBe("after");
  });
});
