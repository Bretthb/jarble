"use client";

/**
 * useCanvasPersistence — debounced localStorage save/restore for canvas state.
 *
 * Persists: card positions, sizes, minimized state, component type, title, small props.
 * Does NOT persist: sandbox props, large data arrays.
 * Max 2MB per deployment, expires after 7 days of inactivity.
 */

import { useEffect, useRef, useCallback } from "react";
import type { CanvasState, CanvasAction, CanvasCard } from "@/components/workspace/types";

const STORAGE_PREFIX = "jarble-canvas-";
const MAX_BYTES = 2 * 1024 * 1024; // 2MB
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const DEBOUNCE_MS = 300;

/** Components whose props are too large to persist. */
const SKIP_PROPS_COMPONENTS = new Set(["sandbox", "spreadsheet", "code_editor", "video", "audio"]);

/** Components with small-enough props to persist. */
const SMALL_PROP_COMPONENTS = new Set([
  "text_message", "card", "key_value", "stat_grid", "alert", "badge",
  "header", "blockquote", "metric_card", "result", "statistic",
]);

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
}

interface PersistedState {
  cards: PersistedCard[];
  viewportOffset: { x: number; y: number };
  zoom: number;
  savedAt: number;
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

  // Only persist props for small-prop components
  if (SMALL_PROP_COMPONENTS.has(card.component)) {
    base.props = card.props;
  } else if (!SKIP_PROPS_COMPONENTS.has(card.component)) {
    // For medium components, persist props if they're under 1KB
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
    zIndex: 0, // Will be reassigned by reducer
    minimized: pc.minimized,
    editable: pc.editable,
    fileId: pc.fileId,
    saveMethod: pc.saveMethod,
    createdAt: pc.createdAt,
    title: pc.title,
  };
}

function getStorageKey(deploymentId: string): string {
  return `${STORAGE_PREFIX}${deploymentId}`;
}

/** Load persisted state from localStorage. Returns null if expired or missing. */
export function loadCanvasState(deploymentId: string): CanvasState | null {
  try {
    const raw = localStorage.getItem(getStorageKey(deploymentId));
    if (!raw) return null;

    const persisted: PersistedState = JSON.parse(raw);

    // Check expiry
    if (Date.now() - persisted.savedAt > EXPIRY_MS) {
      localStorage.removeItem(getStorageKey(deploymentId));
      return null;
    }

    // Filter out cards that require props we didn't persist
    const validCards = persisted.cards.filter((pc) => {
      // Skip components that need props but don't have them
      if (SKIP_PROPS_COMPONENTS.has(pc.component) && (!pc.props || Object.keys(pc.props).length === 0)) {
        if (process.env.NODE_ENV === "development") console.log(`[Canvas] Skipping restoration of ${pc.component} card - props not persisted`);
        return false;
      }
      return true;
    });

    const cards = validCards.map(deserializeCard);
    // Assign z-indexes in order
    cards.forEach((c, i) => { c.zIndex = i + 1; });

    return {
      cards,
      viewportOffset: persisted.viewportOffset,
      zoom: persisted.zoom,
      nextZIndex: cards.length + 1,
      focusedCardId: null,
    };
  } catch {
    return null;
  }
}

/** Save canvas state to localStorage (synchronous, called from debounce). */
function saveCanvasState(deploymentId: string, state: CanvasState): void {
  try {
    const persisted: PersistedState = {
      cards: state.cards.map(serializeCard),
      viewportOffset: state.viewportOffset,
      zoom: state.zoom,
      savedAt: Date.now(),
    };

    const json = JSON.stringify(persisted);

    // Enforce 2MB budget
    if (json.length > MAX_BYTES) {
      // Drop oldest cards until it fits
      while (persisted.cards.length > 0 && JSON.stringify(persisted).length > MAX_BYTES) {
        persisted.cards.shift();
      }
    }

    localStorage.setItem(getStorageKey(deploymentId), JSON.stringify(persisted));
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

/**
 * Hook: auto-saves canvas state to localStorage with debouncing.
 * Call this from the workspace component.
 */
export function useCanvasPersistence(
  deploymentId: string,
  state: CanvasState,
  dispatch: React.Dispatch<CanvasAction>
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasRestored = useRef(false);

  // Restore on mount (once)
  useEffect(() => {
    if (hasRestored.current) return;
    hasRestored.current = true;

    const saved = loadCanvasState(deploymentId);
    if (saved && saved.cards.length > 0) {
      dispatch({ type: "RESTORE_STATE", state: saved });
    }
  }, [deploymentId, dispatch]);

  // Debounced save on state change
  useEffect(() => {
    // Skip saving during initial restore
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
