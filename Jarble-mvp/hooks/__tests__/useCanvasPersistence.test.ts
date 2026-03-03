import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { loadCanvasState } from "../useCanvasPersistence";
import type { CanvasState, CanvasCard } from "@/components/workspace/types";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<CanvasCard> = {}): CanvasCard {
  return {
    id: "card-1",
    component: "card",
    props: { title: "Test", body: "Hello" },
    position: { x: 0, y: 0 },
    size: { width: 300, height: 200 },
    zIndex: 1,
    minimized: false,
    createdAt: Date.now(),
    ...overrides,
  };
}

function makeState(cards: CanvasCard[] = [makeCard()]): CanvasState {
  return {
    cards,
    viewportOffset: { x: 0, y: 0 },
    zoom: 1,
    nextZIndex: cards.length + 1,
    focusedCardId: null,
    mode: "dashboard",
  };
}

function makePersistedState(
  cards: CanvasCard[] = [makeCard()],
  savedAt = Date.now(),
) {
  return {
    cards: cards.map((c) => ({
      id: c.id,
      component: c.component,
      props: c.props,
      position: c.position,
      size: c.size,
      minimized: c.minimized,
      createdAt: c.createdAt,
      ...(c.editable ? { editable: true } : {}),
      ...(c.fileId ? { fileId: c.fileId } : {}),
      ...(c.saveMethod ? { saveMethod: c.saveMethod } : {}),
      ...(c.title ? { title: c.title } : {}),
    })),
    viewportOffset: { x: 0, y: 0 },
    zoom: 1,
    savedAt,
    mode: "dashboard",
  };
}

const STORAGE_PREFIX = "jarble-canvas-";
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

// ── Tests: loadCanvasState ──────────────────────────────────────────────────

describe("loadCanvasState", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns null when nothing is stored", () => {
    expect(loadCanvasState("dep-123")).toBeNull();
  });

  it("restores valid persisted state from localStorage", () => {
    const card = makeCard({ id: "c1", component: "alert" });
    const persisted = makePersistedState([card]);
    localStorage.setItem(
      `${STORAGE_PREFIX}dep-123`,
      JSON.stringify(persisted),
    );

    const result = loadCanvasState("dep-123");
    expect(result).not.toBeNull();
    expect(result!.cards).toHaveLength(1);
    expect(result!.cards[0].id).toBe("c1");
    expect(result!.cards[0].component).toBe("alert");
    expect(result!.mode).toBe("dashboard");
  });

  it("uses deployment ID as storage key", () => {
    const persisted = makePersistedState();
    localStorage.setItem(
      `${STORAGE_PREFIX}dep-abc`,
      JSON.stringify(persisted),
    );

    // Different deployment ID should return null
    expect(loadCanvasState("dep-xyz")).toBeNull();
    // Correct deployment ID should return state
    expect(loadCanvasState("dep-abc")).not.toBeNull();
  });

  it("returns null and removes entry when state is expired (>7 days)", () => {
    const oldDate = Date.now() - EXPIRY_MS - 1000; // 7 days + 1s ago
    const persisted = makePersistedState([makeCard()], oldDate);
    localStorage.setItem(
      `${STORAGE_PREFIX}dep-old`,
      JSON.stringify(persisted),
    );

    const result = loadCanvasState("dep-old");
    expect(result).toBeNull();
    // Should have cleaned up the entry
    expect(localStorage.getItem(`${STORAGE_PREFIX}dep-old`)).toBeNull();
  });

  it("returns null for corrupt/invalid JSON in localStorage", () => {
    localStorage.setItem(`${STORAGE_PREFIX}dep-bad`, "not-json{{{");
    expect(loadCanvasState("dep-bad")).toBeNull();
  });

  it("marks sandbox cards with empty props as propsLost", () => {
    const sandboxCard = makeCard({
      id: "s1",
      component: "sandbox",
      props: {},
    });
    const regularCard = makeCard({
      id: "r1",
      component: "card",
      props: { title: "Hello" },
    });

    const persisted = makePersistedState([sandboxCard, regularCard]);
    // Manually set sandbox card props to empty to simulate missing props
    persisted.cards[0].props = {};
    localStorage.setItem(
      `${STORAGE_PREFIX}dep-filter`,
      JSON.stringify(persisted),
    );

    const result = loadCanvasState("dep-filter");
    expect(result).not.toBeNull();
    // Both cards should be present
    expect(result!.cards).toHaveLength(2);
    // Sandbox card should have propsLost flag
    expect(result!.cards[0].id).toBe("s1");
    expect(result!.cards[0].propsLost).toBe(true);
    // Regular card should not
    expect(result!.cards[1].id).toBe("r1");
    expect(result!.cards[1].propsLost).toBeUndefined();
  });

  it("always restores editable cards even without props", () => {
    const editableCard = makeCard({
      id: "e1",
      component: "sandbox",
      props: {},
      editable: true,
    });

    const persisted = makePersistedState([editableCard]);
    persisted.cards[0].editable = true;
    persisted.cards[0].props = {};
    localStorage.setItem(
      `${STORAGE_PREFIX}dep-edit`,
      JSON.stringify(persisted),
    );

    const result = loadCanvasState("dep-edit");
    expect(result).not.toBeNull();
    expect(result!.cards).toHaveLength(1);
    expect(result!.cards[0].editable).toBe(true);
  });

  it("assigns sequential zIndex values to restored cards", () => {
    const cards = [
      makeCard({ id: "c1", component: "card" }),
      makeCard({ id: "c2", component: "alert" }),
      makeCard({ id: "c3", component: "badge" }),
    ];
    const persisted = makePersistedState(cards);
    localStorage.setItem(
      `${STORAGE_PREFIX}dep-z`,
      JSON.stringify(persisted),
    );

    const result = loadCanvasState("dep-z");
    expect(result).not.toBeNull();
    expect(result!.cards[0].zIndex).toBe(1);
    expect(result!.cards[1].zIndex).toBe(2);
    expect(result!.cards[2].zIndex).toBe(3);
    expect(result!.nextZIndex).toBe(4);
  });

  it("defaults to 'dashboard' mode when mode is not persisted", () => {
    const persisted = makePersistedState();
    // Remove mode to simulate old format
    delete (persisted as Record<string, unknown>).mode;
    localStorage.setItem(
      `${STORAGE_PREFIX}dep-nomode`,
      JSON.stringify(persisted),
    );

    const result = loadCanvasState("dep-nomode");
    expect(result).not.toBeNull();
    expect(result!.mode).toBe("dashboard");
  });
});
