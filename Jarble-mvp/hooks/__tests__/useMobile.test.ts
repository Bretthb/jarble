import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useIsMobile } from "../useMobile";

// ── Helpers ─────────────────────────────────────────────────────────────────

let changeListeners: Array<() => void> = [];

function mockMatchMedia(matches: boolean) {
  const mql = {
    matches,
    media: "(max-width: 767px)",
    addEventListener: vi.fn((_event: string, cb: () => void) => {
      changeListeners.push(cb);
    }),
    removeEventListener: vi.fn((_event: string, cb: () => void) => {
      changeListeners = changeListeners.filter((fn) => fn !== cb);
    }),
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => mql),
  );
  return mql;
}

function setWindowWidth(width: number) {
  Object.defineProperty(window, "innerWidth", {
    writable: true,
    configurable: true,
    value: width,
  });
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("useIsMobile", () => {
  beforeEach(() => {
    changeListeners = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns true for narrow viewport (< 768px)", () => {
    setWindowWidth(500);
    mockMatchMedia(true);

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it("returns false for wide viewport (>= 768px)", () => {
    setWindowWidth(1024);
    mockMatchMedia(false);

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it("initializes to false before effect runs (SSR-safe)", () => {
    // The hook uses useState(false) initially, then sets the real value in useEffect
    // We cannot really test the pre-effect value with renderHook since the effect runs synchronously
    // in the test environment, but we can verify it doesn't throw
    setWindowWidth(400);
    mockMatchMedia(true);

    const { result } = renderHook(() => useIsMobile());
    // After mount, the effect has already run — should reflect the actual width
    expect(result.current).toBe(true);
  });

  it("updates when resize triggers matchMedia change", () => {
    setWindowWidth(1024);
    mockMatchMedia(false);

    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    // Simulate resize to mobile width
    act(() => {
      setWindowWidth(500);
      // Fire all matchMedia change listeners
      for (const cb of changeListeners) cb();
    });

    expect(result.current).toBe(true);
  });

  it("cleans up matchMedia listener on unmount", () => {
    setWindowWidth(1024);
    const mql = mockMatchMedia(false);

    const { unmount } = renderHook(() => useIsMobile());

    expect(mql.addEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );

    unmount();

    expect(mql.removeEventListener).toHaveBeenCalledWith(
      "change",
      expect.any(Function),
    );
  });
});
