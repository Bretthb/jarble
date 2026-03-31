import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { saveComponentState, loadComponentState } from "../componentState";

// ── Mock global fetch ──────────────────────────────────────────────────────

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// ── Helpers ────────────────────────────────────────────────────────────────

const DEP_ID = "dep-123";
const CARD_ID = "card-abc";
const TOKEN = "test-token";
const API = "http://localhost:3001";

beforeEach(() => {
  vi.useFakeTimers();
  mockFetch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

// ── saveComponentState ─────────────────────────────────────────────────────

describe("saveComponentState", () => {
  it("debounces the save call by the specified delay", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    saveComponentState(DEP_ID, CARD_ID, { count: 1 }, TOKEN, 500);

    // Not called yet - still within debounce window
    expect(mockFetch).not.toHaveBeenCalled();

    // Advance past the debounce delay
    vi.advanceTimersByTime(500);

    // Flush the microtask queue for the async callback
    await vi.advanceTimersByTimeAsync(0);

    expect(mockFetch).toHaveBeenCalledOnce();
    expect(mockFetch).toHaveBeenCalledWith(
      `${API}/api/deployments/${DEP_ID}/component-state/save`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Content-Type": "application/json",
          Authorization: `Bearer ${TOKEN}`,
        }),
        body: JSON.stringify({ cardId: CARD_ID, state: { count: 1 } }),
      }),
    );
  });

  it("resets the debounce timer on rapid calls", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    saveComponentState(DEP_ID, CARD_ID, { v: 1 }, TOKEN, 300);
    vi.advanceTimersByTime(200); // 200ms in - still within debounce
    saveComponentState(DEP_ID, CARD_ID, { v: 2 }, TOKEN, 300); // resets timer

    vi.advanceTimersByTime(200); // 400ms total from first call, 200 from second
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).not.toHaveBeenCalled(); // second debounce not done yet

    vi.advanceTimersByTime(100); // 300ms from second call
    await vi.advanceTimersByTimeAsync(0);

    expect(mockFetch).toHaveBeenCalledOnce();
    // Should send the LATEST state
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.state).toEqual({ v: 2 });
  });

  it("uses default 1000ms delay", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    saveComponentState(DEP_ID, CARD_ID, "data", TOKEN);

    vi.advanceTimersByTime(999);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("does not throw when fetch fails", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("Network error"));

    saveComponentState(DEP_ID, CARD_ID, {}, TOKEN, 0);

    vi.advanceTimersByTime(0);
    await vi.advanceTimersByTimeAsync(0);

    // Should log a warning, not throw
    expect(warnSpy).toHaveBeenCalledWith(
      "[ComponentState] Save failed:",
      expect.any(Error),
    );

    warnSpy.mockRestore();
  });

  it("handles different card IDs independently", async () => {
    mockFetch.mockResolvedValue({ ok: true });

    saveComponentState(DEP_ID, "card-A", { a: 1 }, TOKEN, 100);
    saveComponentState(DEP_ID, "card-B", { b: 2 }, TOKEN, 100);

    vi.advanceTimersByTime(100);
    await vi.advanceTimersByTimeAsync(0);

    // Both should fire - they have different keys
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});

// ── loadComponentState ─────────────────────────────────────────────────────

describe("loadComponentState", () => {
  it("returns saved state on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ state: { count: 42 } }),
    });

    const result = await loadComponentState(DEP_ID, CARD_ID, TOKEN);

    expect(result).toEqual({ count: 42 });
    expect(mockFetch).toHaveBeenCalledWith(
      `${API}/api/deployments/${DEP_ID}/component-state/${CARD_ID}`,
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
  });

  it("returns null when response is not ok", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404 });

    const result = await loadComponentState(DEP_ID, CARD_ID, TOKEN);
    expect(result).toBeNull();
  });

  it("returns null when state field is missing", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });

    const result = await loadComponentState(DEP_ID, CARD_ID, TOKEN);
    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValue(new Error("Network down"));

    const result = await loadComponentState(DEP_ID, CARD_ID, TOKEN);
    expect(result).toBeNull();
  });

  it("encodes cardId in URL", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ state: "ok" }),
    });

    await loadComponentState(DEP_ID, "card/with spaces", TOKEN);

    expect(mockFetch).toHaveBeenCalledWith(
      `${API}/api/deployments/${DEP_ID}/component-state/${encodeURIComponent("card/with spaces")}`,
      expect.any(Object),
    );
  });
});
