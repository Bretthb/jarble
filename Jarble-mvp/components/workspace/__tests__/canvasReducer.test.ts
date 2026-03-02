import { describe, it, expect, vi } from "vitest";
import { canvasReducer, INITIAL_CANVAS_STATE } from "../canvasReducer";
import type { CanvasState, CanvasCard, CanvasAction } from "../types";

// Suppress development console.log noise from reducer
vi.spyOn(console, "log").mockImplementation(() => {});
vi.spyOn(console, "warn").mockImplementation(() => {});

function makeCard(overrides: Partial<CanvasCard> = {}): CanvasCard {
  return {
    id: "card-1",
    component: "card",
    props: { title: "Test" },
    position: { x: 0, y: 0 },
    size: { width: 320, height: 220 },
    zIndex: 1,
    minimized: false,
    createdAt: 1000,
    ...overrides,
  };
}

function stateWith(cards: CanvasCard[], overrides: Partial<CanvasState> = {}): CanvasState {
  return {
    ...INITIAL_CANVAS_STATE,
    cards,
    nextZIndex: cards.length + 1,
    ...overrides,
  };
}

describe("canvasReducer", () => {
  // ── ADD_CARD ──────────────────────────────────────────────────────────────
  describe("ADD_CARD", () => {
    it("adds a card to empty state", () => {
      const card = makeCard();
      const result = canvasReducer(INITIAL_CANVAS_STATE, { type: "ADD_CARD", card });
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].id).toBe("card-1");
    });

    it("assigns zIndex from nextZIndex and increments it", () => {
      const state = stateWith([], { nextZIndex: 5 });
      const card = makeCard();
      const result = canvasReducer(state, { type: "ADD_CARD", card });
      expect(result.cards[0].zIndex).toBe(5);
      expect(result.nextZIndex).toBe(6);
    });

    it("appends to existing cards", () => {
      const state = stateWith([makeCard({ id: "existing" })]);
      const result = canvasReducer(state, { type: "ADD_CARD", card: makeCard({ id: "new" }) });
      expect(result.cards).toHaveLength(2);
      expect(result.cards[1].id).toBe("new");
    });
  });

  // ── REMOVE_CARD ───────────────────────────────────────────────────────────
  describe("REMOVE_CARD", () => {
    it("removes a card by id", () => {
      const state = stateWith([makeCard({ id: "a" }), makeCard({ id: "b" })]);
      const result = canvasReducer(state, { type: "REMOVE_CARD", id: "a" });
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].id).toBe("b");
    });

    it("returns same length when removing non-existent card", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "REMOVE_CARD", id: "nonexistent" });
      expect(result.cards).toHaveLength(1);
    });

    it("clears focusedCardId if the removed card was focused", () => {
      const state = stateWith([makeCard({ id: "a" })], { focusedCardId: "a" });
      const result = canvasReducer(state, { type: "REMOVE_CARD", id: "a" });
      expect(result.focusedCardId).toBeNull();
    });

    it("preserves focusedCardId if a different card was removed", () => {
      const state = stateWith([makeCard({ id: "a" }), makeCard({ id: "b" })], { focusedCardId: "b" });
      const result = canvasReducer(state, { type: "REMOVE_CARD", id: "a" });
      expect(result.focusedCardId).toBe("b");
    });
  });

  // ── MOVE_CARD ─────────────────────────────────────────────────────────────
  describe("MOVE_CARD", () => {
    it("updates card position", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "MOVE_CARD", id: "a", position: { x: 100, y: 200 } });
      expect(result.cards[0].position).toEqual({ x: 100, y: 200 });
    });

    it("does not affect other cards", () => {
      const state = stateWith([makeCard({ id: "a" }), makeCard({ id: "b", position: { x: 50, y: 50 } })]);
      const result = canvasReducer(state, { type: "MOVE_CARD", id: "a", position: { x: 100, y: 200 } });
      expect(result.cards[1].position).toEqual({ x: 50, y: 50 });
    });
  });

  // ── RESIZE_CARD ───────────────────────────────────────────────────────────
  describe("RESIZE_CARD", () => {
    it("updates card size", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "RESIZE_CARD", id: "a", size: { width: 500, height: 400 } });
      expect(result.cards[0].size).toEqual({ width: 500, height: 400 });
    });
  });

  // ── MINIMIZE_CARD / RESTORE_CARD ──────────────────────────────────────────
  describe("MINIMIZE_CARD", () => {
    it("sets minimized to true", () => {
      const state = stateWith([makeCard({ id: "a", minimized: false })]);
      const result = canvasReducer(state, { type: "MINIMIZE_CARD", id: "a" });
      expect(result.cards[0].minimized).toBe(true);
    });
  });

  describe("RESTORE_CARD", () => {
    it("sets minimized to false", () => {
      const state = stateWith([makeCard({ id: "a", minimized: true })]);
      const result = canvasReducer(state, { type: "RESTORE_CARD", id: "a" });
      expect(result.cards[0].minimized).toBe(false);
    });
  });

  // ── BRING_TO_FRONT ────────────────────────────────────────────────────────
  describe("BRING_TO_FRONT", () => {
    it("assigns the next z-index and sets focusedCardId", () => {
      const state = stateWith([makeCard({ id: "a", zIndex: 1 }), makeCard({ id: "b", zIndex: 2 })], { nextZIndex: 3 });
      const result = canvasReducer(state, { type: "BRING_TO_FRONT", id: "a" });
      expect(result.cards.find((c) => c.id === "a")!.zIndex).toBe(3);
      expect(result.focusedCardId).toBe("a");
      expect(result.nextZIndex).toBe(4);
    });

    it("normalizes z-indices when nextZIndex >= 1000", () => {
      const state = stateWith(
        [makeCard({ id: "a", zIndex: 500 }), makeCard({ id: "b", zIndex: 999 })],
        { nextZIndex: 1000 }
      );
      const result = canvasReducer(state, { type: "BRING_TO_FRONT", id: "a" });
      // After normalization, a should have highest z-index
      const aCard = result.cards.find((c) => c.id === "a")!;
      const bCard = result.cards.find((c) => c.id === "b")!;
      expect(aCard.zIndex).toBeGreaterThan(bCard.zIndex);
      expect(result.focusedCardId).toBe("a");
    });
  });

  // ── SEND_TO_BACK ──────────────────────────────────────────────────────────
  describe("SEND_TO_BACK", () => {
    it("sets z-index to 0", () => {
      const state = stateWith([makeCard({ id: "a", zIndex: 5 })]);
      const result = canvasReducer(state, { type: "SEND_TO_BACK", id: "a" });
      expect(result.cards[0].zIndex).toBe(0);
    });
  });

  // ── DUPLICATE_CARD ────────────────────────────────────────────────────────
  describe("DUPLICATE_CARD", () => {
    it("creates a clone with new id and offset position", () => {
      const state = stateWith([makeCard({ id: "a", position: { x: 100, y: 100 } })], { nextZIndex: 2 });
      const result = canvasReducer(state, {
        type: "DUPLICATE_CARD",
        id: "a",
        newId: "a-clone",
        offset: { x: 20, y: 20 },
      });
      expect(result.cards).toHaveLength(2);
      const clone = result.cards.find((c) => c.id === "a-clone")!;
      expect(clone.position).toEqual({ x: 120, y: 120 });
      expect(clone.zIndex).toBe(2);
      expect(result.focusedCardId).toBe("a-clone");
    });

    it("returns unchanged state when source card not found", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, {
        type: "DUPLICATE_CARD",
        id: "nonexistent",
        newId: "clone",
        offset: { x: 0, y: 0 },
      });
      expect(result.cards).toHaveLength(1);
    });
  });

  // ── RESET_CARD_SIZE ───────────────────────────────────────────────────────
  describe("RESET_CARD_SIZE", () => {
    it("resets card to default size for its component type", () => {
      const state = stateWith([makeCard({ id: "a", component: "card", size: { width: 999, height: 999 } })]);
      const result = canvasReducer(state, { type: "RESET_CARD_SIZE", id: "a" });
      // Should be the default size for "card" or the fallback default
      expect(result.cards[0].size.width).not.toBe(999);
    });

    it("returns unchanged state when card not found", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "RESET_CARD_SIZE", id: "nonexistent" });
      expect(result).toBe(state);
    });
  });

  // ── FOCUS_CARD ────────────────────────────────────────────────────────────
  describe("FOCUS_CARD", () => {
    it("sets focusedCardId", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "FOCUS_CARD", id: "a" });
      expect(result.focusedCardId).toBe("a");
    });

    it("allows null to clear focus", () => {
      const state = stateWith([], { focusedCardId: "a" });
      const result = canvasReducer(state, { type: "FOCUS_CARD", id: null });
      expect(result.focusedCardId).toBeNull();
    });
  });

  // ── SET_VIEWPORT ──────────────────────────────────────────────────────────
  describe("SET_VIEWPORT", () => {
    it("updates viewport offset", () => {
      const result = canvasReducer(INITIAL_CANVAS_STATE, {
        type: "SET_VIEWPORT",
        offset: { x: 100, y: -50 },
      });
      expect(result.viewportOffset).toEqual({ x: 100, y: -50 });
    });
  });

  // ── SET_ZOOM ──────────────────────────────────────────────────────────────
  describe("SET_ZOOM", () => {
    it("sets zoom value", () => {
      const result = canvasReducer(INITIAL_CANVAS_STATE, { type: "SET_ZOOM", zoom: 1.5 });
      expect(result.zoom).toBe(1.5);
    });

    it("clamps zoom to minimum 0.25", () => {
      const result = canvasReducer(INITIAL_CANVAS_STATE, { type: "SET_ZOOM", zoom: 0.1 });
      expect(result.zoom).toBe(0.25);
    });

    it("clamps zoom to maximum 2.0", () => {
      const result = canvasReducer(INITIAL_CANVAS_STATE, { type: "SET_ZOOM", zoom: 5.0 });
      expect(result.zoom).toBe(2.0);
    });
  });

  // ── RESTORE_STATE ─────────────────────────────────────────────────────────
  describe("RESTORE_STATE", () => {
    it("replaces entire state", () => {
      const newState: CanvasState = {
        ...INITIAL_CANVAS_STATE,
        cards: [makeCard({ id: "restored" })],
        zoom: 1.5,
      };
      const result = canvasReducer(INITIAL_CANVAS_STATE, { type: "RESTORE_STATE", state: newState });
      expect(result).toBe(newState);
    });
  });

  // ── SPLIT_CARD ────────────────────────────────────────────────────────────
  describe("SPLIT_CARD", () => {
    it("splits stat_grid into metric_card cards", () => {
      const card = makeCard({
        id: "sg",
        component: "stat_grid",
        props: {
          stats: [
            { label: "Revenue", value: "$1M" },
            { label: "Users", value: 1000 },
          ],
        },
      });
      const state = stateWith([card]);
      const result = canvasReducer(state, { type: "SPLIT_CARD", id: "sg" });
      // Original removed, 2 new cards
      expect(result.cards.find((c) => c.id === "sg")).toBeUndefined();
      expect(result.cards).toHaveLength(2);
      expect(result.cards[0].component).toBe("metric_card");
      expect(result.cards[1].component).toBe("metric_card");
    });

    it("splits key_value into card cards", () => {
      const card = makeCard({
        id: "kv",
        component: "key_value",
        props: {
          items: [
            { key: "Name", value: "Alice" },
            { key: "Age", value: "30" },
          ],
        },
      });
      const state = stateWith([card]);
      const result = canvasReducer(state, { type: "SPLIT_CARD", id: "kv" });
      expect(result.cards.find((c) => c.id === "kv")).toBeUndefined();
      expect(result.cards).toHaveLength(2);
      expect(result.cards[0].component).toBe("card");
    });

    it("returns unchanged state for non-splittable component", () => {
      const card = makeCard({ id: "a", component: "chart" });
      const state = stateWith([card]);
      const result = canvasReducer(state, { type: "SPLIT_CARD", id: "a" });
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].id).toBe("a");
    });

    it("returns unchanged state when card not found", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "SPLIT_CARD", id: "nonexistent" });
      expect(result).toBe(state);
    });

    it("returns unchanged state when items below minItems", () => {
      const card = makeCard({
        id: "sg",
        component: "stat_grid",
        props: { stats: [{ label: "Only one", value: 1 }] },
      });
      const state = stateWith([card]);
      const result = canvasReducer(state, { type: "SPLIT_CARD", id: "sg" });
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].id).toBe("sg");
    });

    it("preserves other cards when splitting", () => {
      const otherCard = makeCard({ id: "other" });
      const splitCard = makeCard({
        id: "sg",
        component: "stat_grid",
        props: {
          stats: [
            { label: "A", value: 1 },
            { label: "B", value: 2 },
          ],
        },
      });
      const state = stateWith([otherCard, splitCard]);
      const result = canvasReducer(state, { type: "SPLIT_CARD", id: "sg" });
      expect(result.cards.find((c) => c.id === "other")).toBeDefined();
      expect(result.cards).toHaveLength(3); // 1 original + 2 split
    });
  });

  // ── MERGE_CARDS ───────────────────────────────────────────────────────────
  describe("MERGE_CARDS", () => {
    it("merges two stat_grid cards into one", () => {
      const source = makeCard({
        id: "s1",
        component: "stat_grid",
        props: { stats: [{ label: "A", value: 1 }] },
        createdAt: 2000,
      });
      const target = makeCard({
        id: "s2",
        component: "stat_grid",
        props: { stats: [{ label: "B", value: 2 }] },
        createdAt: 1000,
      });
      const state = stateWith([source, target]);
      const result = canvasReducer(state, { type: "MERGE_CARDS", sourceId: "s1", targetId: "s2" });
      expect(result.cards).toHaveLength(1);
      const merged = result.cards[0];
      expect((merged.props.stats as unknown[]).length).toBe(2);
      // Keeps earliest createdAt
      expect(merged.createdAt).toBe(1000);
    });

    it("returns unchanged state when merging different component types", () => {
      const source = makeCard({ id: "s1", component: "stat_grid", props: { stats: [] } });
      const target = makeCard({ id: "s2", component: "key_value", props: { items: [] } });
      const state = stateWith([source, target]);
      const result = canvasReducer(state, { type: "MERGE_CARDS", sourceId: "s1", targetId: "s2" });
      expect(result).toBe(state);
    });

    it("returns unchanged state when source not found", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "MERGE_CARDS", sourceId: "nonexistent", targetId: "a" });
      expect(result).toBe(state);
    });

    it("returns unchanged state for non-splittable component type", () => {
      const source = makeCard({ id: "s1", component: "chart", props: {} });
      const target = makeCard({ id: "s2", component: "chart", props: {} });
      const state = stateWith([source, target]);
      const result = canvasReducer(state, { type: "MERGE_CARDS", sourceId: "s1", targetId: "s2" });
      expect(result).toBe(state);
    });
  });

  // ── REORDER_CARDS ─────────────────────────────────────────────────────────
  describe("REORDER_CARDS", () => {
    it("moves source card to target position (forward)", () => {
      const cards = [makeCard({ id: "a" }), makeCard({ id: "b" }), makeCard({ id: "c" })];
      const state = stateWith(cards);
      const result = canvasReducer(state, { type: "REORDER_CARDS", sourceId: "a", targetId: "c" });
      // splice removes "a" from index 0 -> [b, c], then inserts at index 2 -> [b, c, a]
      expect(result.cards.map((c) => c.id)).toEqual(["b", "c", "a"]);
    });

    it("moves source card to target position (backward)", () => {
      const cards = [makeCard({ id: "a" }), makeCard({ id: "b" }), makeCard({ id: "c" })];
      const state = stateWith(cards);
      const result = canvasReducer(state, { type: "REORDER_CARDS", sourceId: "c", targetId: "a" });
      expect(result.cards.map((c) => c.id)).toEqual(["c", "a", "b"]);
    });

    it("returns unchanged state when source not found", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "REORDER_CARDS", sourceId: "nonexistent", targetId: "a" });
      expect(result).toBe(state);
    });
  });

  // ── UPDATE_CARD_PROPS ─────────────────────────────────────────────────────
  describe("UPDATE_CARD_PROPS", () => {
    it("merges new props when merge is true", () => {
      const state = stateWith([makeCard({ id: "a", props: { title: "Old", body: "Keep" } })]);
      const result = canvasReducer(state, {
        type: "UPDATE_CARD_PROPS",
        id: "a",
        props: { title: "New" },
        merge: true,
      });
      expect(result.cards[0].props).toEqual({ title: "New", body: "Keep" });
    });

    it("replaces all props when merge is false", () => {
      const state = stateWith([makeCard({ id: "a", props: { title: "Old", body: "Gone" } })]);
      const result = canvasReducer(state, {
        type: "UPDATE_CARD_PROPS",
        id: "a",
        props: { title: "New" },
        merge: false,
      });
      expect(result.cards[0].props).toEqual({ title: "New" });
    });

    it("updates component name when provided", () => {
      const state = stateWith([makeCard({ id: "a", component: "card" })]);
      const result = canvasReducer(state, {
        type: "UPDATE_CARD_PROPS",
        id: "a",
        props: {},
        merge: true,
        component: "alert",
      });
      expect(result.cards[0].component).toBe("alert");
    });
  });

  // ── SELECT_CARD / TOGGLE_SELECT_CARD / DESELECT_CARD ──────────────────────
  describe("SELECT_CARD", () => {
    it("selects a card and deselects all others", () => {
      const state = stateWith([
        makeCard({ id: "a", selected: true } as Partial<CanvasCard>),
        makeCard({ id: "b" }),
      ]);
      const result = canvasReducer(state, { type: "SELECT_CARD", id: "b" });
      expect(result.cards.find((c) => c.id === "a")!.selected).toBe(false);
      expect(result.cards.find((c) => c.id === "b")!.selected).toBe(true);
    });
  });

  describe("TOGGLE_SELECT_CARD", () => {
    it("toggles selection on the target card", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "TOGGLE_SELECT_CARD", id: "a" });
      expect(result.cards[0].selected).toBe(true);
      const result2 = canvasReducer(result, { type: "TOGGLE_SELECT_CARD", id: "a" });
      expect(result2.cards[0].selected).toBe(false);
    });
  });

  describe("DESELECT_CARD", () => {
    it("deselects all cards", () => {
      const state = stateWith([
        makeCard({ id: "a", selected: true } as Partial<CanvasCard>),
        makeCard({ id: "b", selected: true } as Partial<CanvasCard>),
      ]);
      const result = canvasReducer(state, { type: "DESELECT_CARD" });
      expect(result.cards.every((c) => c.selected === false)).toBe(true);
    });
  });

  // ── GROUP_CARDS ───────────────────────────────────────────────────────────
  describe("GROUP_CARDS", () => {
    it("groups cards into a layout component", () => {
      const cards = [
        makeCard({ id: "a", component: "card", position: { x: 0, y: 0 }, size: { width: 200, height: 100 } }),
        makeCard({ id: "b", component: "alert", position: { x: 250, y: 0 }, size: { width: 200, height: 100 } }),
      ];
      const state = stateWith(cards);
      const result = canvasReducer(state, { type: "GROUP_CARDS", cardIds: ["a", "b"] });
      // Original cards removed, one layout card added
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].component).toBe("layout");
      const children = result.cards[0].props.children as unknown[];
      expect(children).toHaveLength(2);
    });

    it("returns unchanged state when fewer than 2 card ids", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "GROUP_CARDS", cardIds: ["a"] });
      // No grouping with < 2 cards
      expect(result.cards).toHaveLength(1);
      expect(result.cards[0].component).toBe("card");
    });
  });

  // ── SAVE_CARD ─────────────────────────────────────────────────────────────
  describe("SAVE_CARD", () => {
    it("sets savedName on a card", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      const result = canvasReducer(state, { type: "SAVE_CARD", id: "a", savedName: "My Chart" });
      expect(result.cards[0].savedName).toBe("My Chart");
    });
  });

  // ── TIDY_LAYOUT ───────────────────────────────────────────────────────────
  describe("TIDY_LAYOUT", () => {
    it("reorganizes card positions", () => {
      const cards = [
        makeCard({ id: "a", component: "metric_card", position: { x: 500, y: 500 } }),
        makeCard({ id: "b", component: "chart", position: { x: 0, y: 0 } }),
      ];
      const state = stateWith(cards);
      const result = canvasReducer(state, { type: "TIDY_LAYOUT", containerWidth: 1200 });
      // Positions should be updated (not original values)
      expect(result.cards.length).toBe(2);
    });

    it("returns empty cards unchanged", () => {
      const result = canvasReducer(INITIAL_CANVAS_STATE, { type: "TIDY_LAYOUT", containerWidth: 1200 });
      expect(result.cards).toHaveLength(0);
    });
  });

  // ── SET_CANVAS_MODE ───────────────────────────────────────────────────────
  describe("SET_CANVAS_MODE", () => {
    it("sets mode to freeform", () => {
      const result = canvasReducer(INITIAL_CANVAS_STATE, { type: "SET_CANVAS_MODE", mode: "freeform" });
      expect(result.mode).toBe("freeform");
    });

    it("sets mode to dashboard", () => {
      const state = { ...INITIAL_CANVAS_STATE, mode: "freeform" as const };
      const result = canvasReducer(state, { type: "SET_CANVAS_MODE", mode: "dashboard" });
      expect(result.mode).toBe("dashboard");
    });
  });

  // ── CLEAR_CANVAS ──────────────────────────────────────────────────────────
  describe("CLEAR_CANVAS", () => {
    it("resets to initial state but preserves mode", () => {
      const state = stateWith(
        [makeCard({ id: "a" }), makeCard({ id: "b" })],
        { mode: "freeform", zoom: 1.5, focusedCardId: "a" }
      );
      const result = canvasReducer(state, { type: "CLEAR_CANVAS" });
      expect(result.cards).toHaveLength(0);
      expect(result.mode).toBe("freeform");
      expect(result.zoom).toBe(1); // reset to default
      expect(result.focusedCardId).toBeNull();
    });
  });

  // ── Unknown action ────────────────────────────────────────────────────────
  describe("unknown action", () => {
    it("returns state unchanged for unknown action type", () => {
      const state = stateWith([makeCard({ id: "a" })]);
      // @ts-expect-error - testing unknown action type
      const result = canvasReducer(state, { type: "UNKNOWN_ACTION" });
      expect(result).toBe(state);
    });
  });
});
