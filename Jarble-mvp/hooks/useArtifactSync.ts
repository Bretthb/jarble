"use client";

import { useEffect, useRef, useCallback } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { API_URL } from "@/lib/trpc";
import type { CanvasState, CanvasCard } from "@/components/workspace/types";

/** Components substantial enough to persist to the pod's artifact store */
export const ARTIFACT_WORTHY = new Set([
  "spreadsheet", "code_editor", "data_table", "chart",
  "sandbox", "code_block", "embed",
]);

export function isArtifactWorthy(component: string): boolean {
  return ARTIFACT_WORTHY.has(component);
}

export const SYNC_DEBOUNCE_MS = 2000;

interface ArtifactMeta {
  id: string;
  component: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
}

/**
 * useArtifactSync — auto-saves artifact-worthy canvas cards to the pod,
 * restores pinned artifacts on session start.
 */
export function useArtifactSync(
  deploymentId: string | undefined,
  state: CanvasState,
  dispatch: React.Dispatch<any>,
) {
  const { getAccessTokenSilently } = useAuth0();
  const syncTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const prevPropsRef = useRef<Map<string, string>>(new Map());
  const restoredRef = useRef(false);

  // ── Session Restore: fetch manifest, hydrate pinned artifacts ──────
  useEffect(() => {
    if (!deploymentId || restoredRef.current) return;
    restoredRef.current = true;

    (async () => {
      try {
        const token = await getAccessTokenSilently();
        if (!token) return;

        const res = await fetch(`${API_URL}/api/deployments/${deploymentId}/artifact/list`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;

        const { artifacts } = (await res.json()) as { artifacts: ArtifactMeta[] };
        const pinned = artifacts.filter((a) => a.pinned);

        for (const meta of pinned) {
          // Skip if card already on canvas (from localStorage restore)
          if (state.cards.some((c) => c.id === meta.id)) continue;

          const artRes = await fetch(
            `${API_URL}/api/deployments/${deploymentId}/artifact/${meta.id}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!artRes.ok) continue;
          const artifact = await artRes.json();

          dispatch({
            type: "ADD_CARD",
            card: {
              id: artifact.id,
              component: artifact.component,
              props: artifact.props,
              title: artifact.title,
              pinned: true,
            },
          });
        }
      } catch {
        // Silent — pod may not be running
      }
    })();
  }, [deploymentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-Save: debounced sync of artifact-worthy card changes ──────
  const syncToServer = useCallback(
    async (card: CanvasCard) => {
      if (!deploymentId) return;
      try {
        const token = await getAccessTokenSilently();
        if (!token) return;

        await fetch(`${API_URL}/api/deployments/${deploymentId}/artifact/sync`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            id: card.id,
            component: card.component,
            props: card.props,
            title: card.title || card.component,
          }),
        });
      } catch {
        // Silent failure — localStorage still has the data
      }
    },
    [deploymentId, getAccessTokenSilently],
  );

  useEffect(() => {
    for (const card of state.cards) {
      if (!isArtifactWorthy(card.component)) continue;

      const propsHash = JSON.stringify(card.props);
      const prev = prevPropsRef.current.get(card.id);
      if (prev === propsHash) continue;

      prevPropsRef.current.set(card.id, propsHash);

      // Debounced sync
      const existing = syncTimers.current.get(card.id);
      if (existing) clearTimeout(existing);

      syncTimers.current.set(
        card.id,
        setTimeout(() => {
          syncToServer(card);
          syncTimers.current.delete(card.id);
        }, SYNC_DEBOUNCE_MS),
      );
    }

    // Cleanup timers for removed cards
    for (const [id] of syncTimers.current) {
      if (!state.cards.some((c) => c.id === id)) {
        clearTimeout(syncTimers.current.get(id));
        syncTimers.current.delete(id);
      }
    }
  }, [state.cards, syncToServer]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timer of syncTimers.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);
}
