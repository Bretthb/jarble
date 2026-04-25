/**
 * Unit tests for `useComposition`.
 *
 * `useComposition` is the IME-aware keyboard-event filter used by
 * every chat input in the platform. Without it, a user typing
 * Japanese / Chinese / Korean — where multi-byte characters are
 * built up via composition events — would have their first Enter
 * keypress submit a partially-composed character to the bot.
 *
 * The hook tracks composition state and SUPPRESSES Enter / Escape
 * keypresses while composition is active. Two contracts pinned:
 *
 *   1. **Composition window swallows Enter / Escape** — between
 *      compositionStart and the post-compositionEnd settle, those
 *      keypresses must NOT bubble up to the chat-submit handler.
 *
 *   2. **Original handlers still get called** — wrapping is
 *      transparent: every onKeyDown/onCompositionStart/
 *      onCompositionEnd the consumer passed in still runs, in
 *      addition to the IME bookkeeping.
 *
 * The post-compositionEnd settle uses two nested setTimeouts to
 * work around a Safari-specific timing quirk where compositionEnd
 * fires BEFORE the keyDown that completed it. Tests use fake timers
 * to drive the settle without waiting on real wall-clock time.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useComposition } from "../useComposition";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Build a fake CompositionEvent with the bare minimum the hook reads. */
function compositionEvent(): React.CompositionEvent<HTMLInputElement> {
  return {} as React.CompositionEvent<HTMLInputElement>;
}

/** Build a fake KeyboardEvent with stopPropagation as a spy. */
function keyEvent(key: string, shiftKey = false) {
  const stopPropagation = vi.fn();
  const event = {
    key,
    shiftKey,
    stopPropagation,
  } as unknown as React.KeyboardEvent<HTMLInputElement>;
  return { event, stopPropagation };
}

describe("useComposition — initial state", () => {
  it("isComposing() is false on first render (no composition yet)", () => {
    const { result } = renderHook(() => useComposition());
    expect(result.current.isComposing()).toBe(false);
  });

  it("returns four stable handler/getter values on the result", () => {
    const { result } = renderHook(() => useComposition());
    expect(typeof result.current.onCompositionStart).toBe("function");
    expect(typeof result.current.onCompositionEnd).toBe("function");
    expect(typeof result.current.onKeyDown).toBe("function");
    expect(typeof result.current.isComposing).toBe("function");
  });
});

describe("useComposition — composition window", () => {
  it("isComposing() flips to true after compositionStart", () => {
    const { result } = renderHook(() => useComposition());

    act(() => {
      result.current.onCompositionStart(compositionEvent());
    });

    expect(result.current.isComposing()).toBe(true);
  });

  it("isComposing() stays true synchronously after compositionEnd (Safari quirk window)", () => {
    // The hook uses a double-setTimeout to delay the settle, so
    // immediately after compositionEnd, isComposing is STILL true.
    // This is the entire point of the workaround — a Safari onKeyDown
    // that fires right after compositionEnd should still see "composing".
    const { result } = renderHook(() => useComposition());

    act(() => {
      result.current.onCompositionStart(compositionEvent());
    });
    act(() => {
      result.current.onCompositionEnd(compositionEvent());
    });

    expect(result.current.isComposing()).toBe(true);
  });

  it("isComposing() flips back to false after the double-setTimeout settle", () => {
    const { result } = renderHook(() => useComposition());

    act(() => {
      result.current.onCompositionStart(compositionEvent());
      result.current.onCompositionEnd(compositionEvent());
    });

    // Drive both nested timers.
    act(() => {
      vi.runAllTimers();
    });

    expect(result.current.isComposing()).toBe(false);
  });
});

describe("useComposition — onKeyDown filtering", () => {
  it("Enter (no shift) DURING composition is swallowed (stopPropagation called, originalOnKeyDown NOT called)", () => {
    const originalOnKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition({ onKeyDown: originalOnKeyDown }));

    act(() => {
      result.current.onCompositionStart(compositionEvent());
    });

    const { event, stopPropagation } = keyEvent("Enter");
    act(() => {
      result.current.onKeyDown(event);
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(originalOnKeyDown).not.toHaveBeenCalled();
  });

  it("Shift+Enter DURING composition passes through (allows newline insertion)", () => {
    const originalOnKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition({ onKeyDown: originalOnKeyDown }));

    act(() => {
      result.current.onCompositionStart(compositionEvent());
    });

    const { event, stopPropagation } = keyEvent("Enter", true);
    act(() => {
      result.current.onKeyDown(event);
    });

    expect(stopPropagation).not.toHaveBeenCalled();
    expect(originalOnKeyDown).toHaveBeenCalledTimes(1);
  });

  it("Escape DURING composition is swallowed (cancel-composition handled by browser, not the app)", () => {
    const originalOnKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition({ onKeyDown: originalOnKeyDown }));

    act(() => {
      result.current.onCompositionStart(compositionEvent());
    });

    const { event, stopPropagation } = keyEvent("Escape");
    act(() => {
      result.current.onKeyDown(event);
    });

    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(originalOnKeyDown).not.toHaveBeenCalled();
  });

  it("Enter OUTSIDE composition passes through to originalOnKeyDown", () => {
    const originalOnKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition({ onKeyDown: originalOnKeyDown }));

    const { event, stopPropagation } = keyEvent("Enter");
    act(() => {
      result.current.onKeyDown(event);
    });

    expect(stopPropagation).not.toHaveBeenCalled();
    expect(originalOnKeyDown).toHaveBeenCalledTimes(1);
  });

  it("Other keys (e.g. ArrowDown) always pass through, composing or not", () => {
    const originalOnKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition({ onKeyDown: originalOnKeyDown }));

    act(() => {
      result.current.onCompositionStart(compositionEvent());
    });

    const { event, stopPropagation } = keyEvent("ArrowDown");
    act(() => {
      result.current.onKeyDown(event);
    });

    expect(stopPropagation).not.toHaveBeenCalled();
    expect(originalOnKeyDown).toHaveBeenCalledTimes(1);
  });

  it("After composition fully settles, Enter again submits as normal", () => {
    const originalOnKeyDown = vi.fn();
    const { result } = renderHook(() => useComposition({ onKeyDown: originalOnKeyDown }));

    // Composition window
    act(() => {
      result.current.onCompositionStart(compositionEvent());
      result.current.onCompositionEnd(compositionEvent());
    });
    act(() => {
      vi.runAllTimers();
    });

    // Now Enter should pass through.
    const { event, stopPropagation } = keyEvent("Enter");
    act(() => {
      result.current.onKeyDown(event);
    });

    expect(stopPropagation).not.toHaveBeenCalled();
    expect(originalOnKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe("useComposition — original handlers wired through", () => {
  it("forwards compositionStart events to originalOnCompositionStart", () => {
    const originalOnCompositionStart = vi.fn();
    const { result } = renderHook(() =>
      useComposition({ onCompositionStart: originalOnCompositionStart }),
    );

    const e = compositionEvent();
    act(() => {
      result.current.onCompositionStart(e);
    });

    expect(originalOnCompositionStart).toHaveBeenCalledWith(e);
  });

  it("forwards compositionEnd events to originalOnCompositionEnd", () => {
    const originalOnCompositionEnd = vi.fn();
    const { result } = renderHook(() =>
      useComposition({ onCompositionEnd: originalOnCompositionEnd }),
    );

    const e = compositionEvent();
    act(() => {
      result.current.onCompositionEnd(e);
    });

    expect(originalOnCompositionEnd).toHaveBeenCalledWith(e);
  });

  it("works without any options (consumer can pass nothing)", () => {
    const { result } = renderHook(() => useComposition());
    // None of these should throw.
    expect(() => {
      act(() => {
        result.current.onCompositionStart(compositionEvent());
        result.current.onCompositionEnd(compositionEvent());
        result.current.onKeyDown(keyEvent("a").event);
      });
      act(() => {
        vi.runAllTimers();
      });
    }).not.toThrow();
  });
});

describe("useComposition — re-entry pattern (rapid IME starts)", () => {
  it("a second compositionStart cancels a pending settle from a prior compositionEnd", () => {
    // Workflow: user starts → ends (settle scheduled) → starts again before
    // the settle fires. The settle MUST be canceled so the second composition
    // window stays open.
    const { result } = renderHook(() => useComposition());

    act(() => {
      result.current.onCompositionStart(compositionEvent());
      result.current.onCompositionEnd(compositionEvent());
    });

    // Settle is now pending. Start a second composition immediately.
    act(() => {
      result.current.onCompositionStart(compositionEvent());
    });

    // Run all pending timers — the first settle's nested timer must have
    // been cleared when the second start fired.
    act(() => {
      vi.runAllTimers();
    });

    // We're STILL composing because no compositionEnd has fired since
    // the second start.
    expect(result.current.isComposing()).toBe(true);
  });
});
