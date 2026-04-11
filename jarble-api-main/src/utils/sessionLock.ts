/**
 * Per-session exec lock.
 *
 * Prevents concurrent `chatViaExec` / `npx openclaw agent` calls on the same
 * OpenClaw session from racing on the shared conversation history file, which
 * would corrupt it with duplicate or out-of-order entries. Each call chains
 * onto the previous call's promise so they execute in strict FIFO order per
 * session key.
 *
 * Previously this was duplicated between `flowChat.ts:67` and
 * `tamboAgent.ts:40` with essentially identical implementations. Cycle 15 of
 * the 2026-04-11 bot teams QA marathon consolidated the two into this shared
 * helper so the concurrency semantics are testable in isolation and any
 * future change (e.g. cross-pod locking via Redis) lands in one place.
 *
 * Known limitation: the underlying Map is per-API-pod. In a multi-pod API
 * deployment, two requests for the same session landing on different pods
 * are NOT mutually serialized. The production deployment currently runs a
 * single Kubero replica, so this is OK for now; a distributed lock would be
 * needed if the API ever scales out horizontally for flow chat traffic.
 */

const sessionExecLocks = new Map<string, Promise<unknown>>();

/**
 * Serialize `fn` against any other in-flight call that shares the same
 * `sessionKey`. Each subsequent call waits for the previous call's promise
 * to settle (fulfilled OR rejected) before running.
 *
 * Implementation notes:
 *   - `prev.then(fn, fn)` runs `fn` on both fulfillment AND rejection of the
 *     previous call — a failing call doesn't poison the chain for subsequent
 *     callers. Each caller gets an independent result.
 *   - The returned promise is the un-`finally`-wrapped chain node, so the
 *     next call chains directly off it without cleanup overhead.
 *   - Cleanup only runs when this call is STILL the head of the chain at
 *     settle time — if another call advanced the chain we leave the map
 *     entry alone (it belongs to the new head).
 */
export function withSessionLock<T>(
  sessionKey: string,
  fn: () => Promise<T>,
): Promise<T> {
  const prev = sessionExecLocks.get(sessionKey) || Promise.resolve();
  const next = prev.then(fn, fn) as Promise<T>;
  sessionExecLocks.set(sessionKey, next);
  // Clean up after completion so the Map doesn't grow unbounded over a long
  // session's lifetime. Only delete if we're still the head — a newer call
  // may have advanced the chain, in which case the entry already points at
  // something newer and must not be touched.
  //
  // IMPORTANT: `next.finally(cleanup)` creates a SECOND observation of
  // `next`, and if `fn` rejected, that finally-wrapped promise inherits
  // the rejection. The caller observes the rejection via the `return next`
  // path, but the finally branch is a separate observation — without a
  // trailing `.catch(() => {})` it triggers Node's unhandledRejection
  // handler on every failed chat call. Found in Cycle 15 of the
  // 2026-04-11 bot teams QA marathon: the test battery's error-injection
  // cases produced "Unhandled Rejection" warnings even though every test
  // passed, because this dangling finally branch was never observed.
  void next
    .finally(() => {
      if (sessionExecLocks.get(sessionKey) === next) {
        sessionExecLocks.delete(sessionKey);
      }
    })
    .catch(() => {
      // Swallow — the caller already observes the rejection through the
      // returned promise. We only want the finally side-effect to run.
    });
  return next;
}

/**
 * Test-only helper: returns the current number of active session locks.
 * Exposed so unit tests can assert the Map is empty after cleanup.
 */
export function _getSessionLockCountForTest(): number {
  return sessionExecLocks.size;
}

/**
 * Test-only helper: returns whether a given sessionKey has an active lock.
 */
export function _hasSessionLockForTest(sessionKey: string): boolean {
  return sessionExecLocks.has(sessionKey);
}

/**
 * Test-only helper: clear all locks. Used to reset state between tests.
 */
export function _clearSessionLocksForTest(): void {
  sessionExecLocks.clear();
}
