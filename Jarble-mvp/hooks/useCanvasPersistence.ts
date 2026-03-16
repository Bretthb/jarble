"use client";

/**
 * useCanvasPersistence — debounced save/restore for canvas state.
 *
 * Small props: localStorage (fast, sync).
 * Large props (sandbox, code_editor, etc.): IndexedDB (no size limit).
 * Max 2MB for localStorage portion. Expires after 7 days of inactivity.
 */

import { useEffect, useRef } from "react";
import type { CanvasState, CanvasAction, CanvasCard, CanvasMode, DrawStroke } from "@/components/workspace/types";

const STORAGE_PREFIX = "jarble-canvas-";
const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEBOUNCE_MS = 300;

/** Components whose props are too large for localStorage — stored in IndexedDB. */
const LARGE_PROP_COMPONENTS = new Set(["sandbox", "spreadsheet", "code_editor", "video", "audio"]);

/** Components with small-enough props to always persist in localStorage. */
const SMALL_PROP_COMPONENTS = new Set([
  "text_message", "card", "key_value", "stat_grid", "alert", "badge",
  "header", "blockquote", "metric_card", "result", "statistic",
]);

// ── IndexedDB helpers ──────────────────────────────────────────────────────

const IDB_NAME = "jarble-canvas";
const IDB_VERSION = 1;
const IDB_STORE = "large-props";

function openIDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Save large props for a deployment's cards into IndexedDB. */
async function saveLargeProps(
  deploymentId: string,
  cards: CanvasCard[]
): Promise<void> {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, "readwrite");
    const store = tx.objectStore(IDB_STORE);

    const propsMap: Record<string, { component: string; props: Record<string, unknown> }> = {};
    for (const card of cards) {
      if (LARGE_PROP_COMPONENTS.has(card.component) && card.props && Object.keys(card.props).length > 0) {
        propsMap[card.id] = { component: card.component, props: card.props };
      }
    }

    store.put(propsMap, `${STORAGE_PREFIX}${deploymentId}`);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // IndexedDB unavailable — silently fail
  }
}

/** Load large props for a deployment from IndexedDB. Returns map of cardId -> props. */
async function loadLargeProps(
  deploymentId: string
): Promise<Record<string, { component: string; props: Record<string, unknown> }>> {
  try {
    const db = await openIDB();
    const tx = db.transaction(IDB_STORE, "readonly");
    const store = tx.objectStore(IDB_STORE);

    const result = await new Promise<Record<string, { component: string; props: Record<string, unknown> }> | undefined>((resolve, reject) => {
      const req = store.get(`${STORAGE_PREFIX}${deploymentId}`);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return result || {};
  } catch {
    return {};
  }
}

// ── localStorage persistence (small props + layout) ────────────────────────

interface PersistedCard {
  id: string;
  component: string;
  props?: Record<string, unknown>;
  position: { x: number; y: number };
  size: { width: number; height: number };
  minimized: boolean;
  editable?: boolean;
  fileId?: string;
  saveMethod?: "mcp" | "chat";
  title?: string;
  createdAt: number;
  /** Marker: large props are in IndexedDB, not here. */
  propsInIDB?: boolean;
}

interface PersistedState {
  cards: PersistedCard[];
  viewportOffset: { x: number; y: number };
  zoom: number;
  savedAt: number;
  mode?: CanvasMode;
  strokes?: DrawStroke[];
}

function serializeCard(card: CanvasCard): PersistedCard {
  const base: PersistedCard = {
    id: card.id,
    component: card.component,
    position: card.position,
    size: card.size,
    minimized: card.minimized,
    createdAt: card.createdAt,
  };

  if (card.editable) base.editable = true;
  if (card.fileId) base.fileId = card.fileId;
  if (card.saveMethod) base.saveMethod = card.saveMethod;
  if (card.title) base.title = card.title;

  // Large-prop components: mark for IndexedDB, don't inline props
  if (LARGE_PROP_COMPONENTS.has(card.component) && !card.editable) {
    base.propsInIDB = true;
    return base;
  }

  // Always persist props for editable cards
  if (card.editable) {
    base.props = card.props;
  } else if (SMALL_PROP_COMPONENTS.has(card.component)) {
    base.props = card.props;
  } else {
    // Medium components: persist props if under 1KB
    const json = JSON.stringify(card.props);
    if (json.length < 1024) {
      base.props = card.props;
    }
  }

  return base;
}

function deserializeCard(pc: PersistedCard): CanvasCard {
  return {
    id: pc.id,
    component: pc.component,
    props: pc.props || {},
    position: pc.position,
    size: pc.size,
    zIndex: 0,
    minimized: pc.minimized,
    editable: pc.editable,
    fileId: pc.fileId,
    saveMethod: pc.saveMethod,
    createdAt: pc.createdAt,
    title: pc.title,
    propsLost: pc.propsInIDB ? true : undefined, // temporarily true until IDB loads
  };
}

function getStorageKey(deploymentId: string): string {
  return `${STORAGE_PREFIX}${deploymentId}`;
}

/** Load persisted state from localStorage. Cards with large props have propsLost=true until IDB loads. */
export function loadCanvasState(deploymentId: string): CanvasState | null {
  try {
    const raw = localStorage.getItem(getStorageKey(deploymentId));
    if (!raw) return null;

    const persisted: PersistedState = JSON.parse(raw);

    if (Date.now() - persisted.savedAt > EXPIRY_MS) {
      localStorage.removeItem(getStorageKey(deploymentId));
      return null;
    }

    const cards = persisted.cards.map(deserializeCard);
    cards.forEach((c, i) => { c.zIndex = i + 1; });

    return {
      cards,
      viewportOffset: persisted.viewportOffset,
      zoom: persisted.zoom,
      nextZIndex: cards.length + 1,
      focusedCardId: null,
      mode: persisted.mode || "dashboard",
      fixAttempts: {},
      dashboardGroups: {},
      strokes: persisted.strokes || [],
    };
  } catch {
    return null;
  }
}

/** Save canvas state: small props to localStorage, large props to IndexedDB.
 *  Positions are now always in CanvasState (no tldraw indirection). */
function saveCanvasState(deploymentId: string, state: CanvasState): void {
  try {
    const persisted: PersistedState = {
      cards: state.cards.map(serializeCard),
      viewportOffset: state.viewportOffset,
      zoom: state.zoom,
      savedAt: Date.now(),
      mode: state.mode,
      strokes: state.strokes.length > 0 ? state.strokes : undefined,
    };

    const json = JSON.stringify(persisted);

    if (json.length > MAX_BYTES) {
      while (persisted.cards.length > 0 && JSON.stringify(persisted).length > MAX_BYTES) {
        persisted.cards.shift();
      }
    }

    localStorage.setItem(getStorageKey(deploymentId), JSON.stringify(persisted));
  } catch {
    // localStorage full or unavailable
  }

  // Save large props to IndexedDB (fire-and-forget)
  saveLargeProps(deploymentId, state.cards);
}

/**
 * Hook: auto-saves canvas state with debouncing.
 * Small props in localStorage, large props in IndexedDB.
 */
export function useCanvasPersistence(
  deploymentId: string,
  state: CanvasState,
  dispatch: React.Dispatch<CanvasAction>,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasRestored = useRef(false);

  // Restore on mount (once)
  useEffect(() => {
    if (hasRestored.current) return;
    hasRestored.current = true;

    const saved = loadCanvasState(deploymentId);
    if (!saved || saved.cards.length === 0) return;

    // Restore layout immediately (sync)
    dispatch({ type: "RESTORE_STATE", state: saved });

    // Then hydrate large props from IndexedDB (async)
    const hasLargeCards = saved.cards.some((c) => c.propsLost);
    if (hasLargeCards) {
      loadLargeProps(deploymentId).then((largeProps) => {
        for (const card of saved.cards) {
          if (card.propsLost && largeProps[card.id]) {
            dispatch({
              type: "UPDATE_CARD_PROPS",
              id: card.id,
              props: largeProps[card.id].props,
              merge: false,
            });
          }
        }
        if (process.env.NODE_ENV === "development") {
          const restored = Object.keys(largeProps).length;
          if (restored > 0) console.log(`[Canvas] Hydrated ${restored} large-prop card(s) from IndexedDB`);
        }
      });
    }
  }, [deploymentId, dispatch]);

  // Debounced save on state change
  useEffect(() => {
    if (!hasRestored.current) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveCanvasState(deploymentId, state);
    }, DEBOUNCE_MS);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [deploymentId, state]);
}
