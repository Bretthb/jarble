/**
 * Unit tests for safeFireAndForget.
 *
 * The helper is the centralized "I'm intentionally not awaiting this"
 * primitive. Every fire-and-forget background mutation in the API
 * (configSync, K8s reconcile, deployment-status writes) flows through
 * it. The contract is small but load-bearing:
 *
 *   1. The returned value is always void — callers must not await.
 *   2. A rejection MUST be caught and logged; never bubbles up.
 *   3. The log entry MUST carry the operation name + any context fields
 *      so the operator can identify which fire-and-forget failed in a
 *      sea of pino lines.
 *
 * A regression here would either crash a stray Node process with
 * UnhandledPromiseRejection, or — worse — silently swallow failures
 * with no log line, making config-sync drops invisible.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const mockError = vi.fn();

vi.mock("../../utils/logger.js", () => ({
  logger: {
    error: (...args: any[]) => mockError(...args),
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { safeFireAndForget } from "../../utils/safeAsync.js";

beforeEach(() => {
  mockError.mockReset();
});

/** Wait one microtask tick so the .catch handler has a chance to run. */
async function microtask() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("safeFireAndForget", () => {
  it("returns void synchronously", () => {
    const ret = safeFireAndForget(Promise.resolve(), { operation: "test" });
    expect(ret).toBeUndefined();
  });

  it("does not log when the promise resolves", async () => {
    safeFireAndForget(Promise.resolve("ok"), { operation: "happy-path" });
    await microtask();
    expect(mockError).not.toHaveBeenCalled();
  });

  it("catches rejection and logs the error with the operation name", async () => {
    const err = new Error("kaboom");
    safeFireAndForget(Promise.reject(err), { operation: "syncConfigsToPvc" });
    await microtask();

    expect(mockError).toHaveBeenCalledTimes(1);
    const [logCtx, logMsg] = mockError.mock.calls[0];
    expect(logCtx.err).toBe(err);
    expect(logCtx.operation).toBe("syncConfigsToPvc");
    expect(logMsg).toContain("Fire-and-forget failed");
    expect(logMsg).toContain("syncConfigsToPvc");
  });

  it("propagates additional context fields into the log entry", async () => {
    safeFireAndForget(Promise.reject(new Error("boom")), {
      operation: "restartDeployment",
      deploymentId: "dep-abc123",
      reason: "config-sync",
    });
    await microtask();

    const [logCtx] = mockError.mock.calls[0];
    expect(logCtx.deploymentId).toBe("dep-abc123");
    expect(logCtx.reason).toBe("config-sync");
  });

  it("does not let the rejection escape as an unhandled rejection", async () => {
    // If the SUT failed to attach a .catch handler, this Promise would
    // emit an UnhandledPromiseRejection event. Vitest's runner fails the
    // test when one is observed; reaching the end of the test cleanly
    // is the assertion.
    safeFireAndForget(Promise.reject(new Error("untracked")), { operation: "must-be-caught" });
    await microtask();
    expect(mockError).toHaveBeenCalledTimes(1);
  });

  it("handles non-Error rejections (string, number, plain object)", async () => {
    safeFireAndForget(Promise.reject("string-rejection"), { operation: "string-err" });
    safeFireAndForget(Promise.reject(42), { operation: "number-err" });
    safeFireAndForget(Promise.reject({ foo: "bar" }), { operation: "object-err" });
    await microtask();

    expect(mockError).toHaveBeenCalledTimes(3);
    expect(mockError.mock.calls[0][0].err).toBe("string-rejection");
    expect(mockError.mock.calls[1][0].err).toBe(42);
    expect(mockError.mock.calls[2][0].err).toEqual({ foo: "bar" });
  });

  it("does not log when the promise rejects with undefined (still caught)", async () => {
    // Edge case: rejecting with `undefined` is legal — the helper must
    // still .catch it (otherwise UnhandledRejection) and log.
    safeFireAndForget(Promise.reject(undefined), { operation: "undefined-rej" });
    await microtask();
    expect(mockError).toHaveBeenCalledTimes(1);
    expect(mockError.mock.calls[0][0].err).toBeUndefined();
  });
});
