/**
 * Unit tests for `usePersistFn`.
 *
 * `usePersistFn` is the foundational stable-callback hook used across
 * the platform — it wraps a callback so the returned reference stays
 * STABLE across renders while the callback body always runs the
 * latest closure. The contract is the half-step between
 * `useCallback` (stable but stale-prone with bare deps) and a fresh
 * arrow function (always-current but unstable reference).
 *
 * Two contracts to pin:
 *
 *   1. **Reference stability** — the same function instance is
 *      returned across every render. Stable refs let consumers pass
 *      the function into `useEffect` deps without forcing re-runs.
 *
 *   2. **Always-fresh body** — calling the persisted ref ALWAYS
 *      executes the latest closure, even if many renders have
 *      happened since. A regression that froze the body to the
 *      first-render closure would silently break event handlers
 *      that depend on current state.
 */

import { describe, it, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePersistFn } from "../usePersistFn";

describe("usePersistFn", () => {
  it("returns the same function reference across re-renders", () => {
    const { result, rerender } = renderHook(({ fn }) => usePersistFn(fn), {
      initialProps: { fn: () => 1 },
    });

    const first = result.current;
    rerender({ fn: () => 2 });
    const second = result.current;
    rerender({ fn: () => 3 });
    const third = result.current;

    expect(first).toBe(second);
    expect(second).toBe(third);
  });

  it("calls the LATEST closure body, even after many re-renders", () => {
    let counter = 0;
    const { result, rerender } = renderHook(({ fn }) => usePersistFn(fn), {
      initialProps: { fn: () => `v${++counter}` },
    });

    // First call — runs the initial fn.
    expect(result.current()).toBe("v1");

    // Re-render with a new fn that closes over a different value.
    rerender({ fn: () => `latest-${counter}` });
    expect(result.current()).toBe("latest-1");

    // Re-render again with a third closure.
    rerender({ fn: () => "fresh-text" });
    expect(result.current()).toBe("fresh-text");
  });

  it("forwards arguments to the underlying function", () => {
    const spy = vi.fn((a: number, b: string) => `${a}-${b}`);
    const { result } = renderHook(() => usePersistFn(spy));

    const ret = result.current(42, "hello");

    expect(spy).toHaveBeenCalledWith(42, "hello");
    expect(ret).toBe("42-hello");
  });

  it("preserves `this` binding from the call site", () => {
    function getThis(this: unknown): unknown {
      return this;
    }
    const { result } = renderHook(() => usePersistFn(getThis));

    const obj = { id: "context" };
    // Invoke the persisted fn as a method of `obj` — should see obj as `this`.
    const ret = (result.current as any).call(obj);

    expect(ret).toBe(obj);
  });

  it("works inside an effect-style callback that captures the hook output", () => {
    // Simulates the canonical usage: a useEffect that depends on the
    // persisted fn but should NOT re-run when the underlying fn
    // changes (because the ref is stable).
    const effectSpy = vi.fn();

    const { rerender } = renderHook(
      ({ fn }) => {
        const persisted = usePersistFn(fn);
        // Pretend useEffect would run with `persisted` in its deps.
        // We simulate that here by calling effectSpy with the ref.
        effectSpy(persisted);
        return persisted;
      },
      { initialProps: { fn: () => "first" } },
    );

    expect(effectSpy).toHaveBeenCalledTimes(1);
    const firstRef = effectSpy.mock.calls[0][0];

    rerender({ fn: () => "second" });
    rerender({ fn: () => "third" });

    expect(effectSpy).toHaveBeenCalledTimes(3);
    // All three calls received the SAME ref — useEffect (if depped on
    // it) would NOT have re-fired.
    expect(effectSpy.mock.calls[1][0]).toBe(firstRef);
    expect(effectSpy.mock.calls[2][0]).toBe(firstRef);
  });

  it("preserves return values (sync number/string/object/promise)", async () => {
    const { result } = renderHook(() =>
      usePersistFn(() => ({ ok: true, n: 42 })),
    );
    expect(result.current()).toEqual({ ok: true, n: 42 });

    const { result: result2 } = renderHook(() =>
      usePersistFn(async () => "async-result"),
    );
    await expect(result2.current()).resolves.toBe("async-result");
  });

  it("the persisted function is callable from inside an act() (no act warnings)", () => {
    const spy = vi.fn();
    const { result } = renderHook(() => usePersistFn(spy));

    act(() => {
      result.current("inside-act");
    });

    expect(spy).toHaveBeenCalledWith("inside-act");
  });
});
