/**
 * Component State Persistence — saves/loads component state to/from the pod's PVC.
 *
 * State is stored at /data/component-state/{cardId}.json on the pod.
 * PVC survives pod restarts and deletions (Longhorn persistent storage).
 *
 * Usage in components:
 *   const { saveState, loadState } = useComponentState(deploymentId);
 *   // On mount: const saved = await loadState(cardId);
 *   // On change: saveState(cardId, newState);  // debounced
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001";

const pendingSaves = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced save of component state to PVC. */
export function saveComponentState(
  deploymentId: string,
  cardId: string,
  state: unknown,
  token: string,
  delayMs = 1000,
): void {
  const key = `${deploymentId}:${cardId}`;
  const existing = pendingSaves.get(key);
  if (existing) clearTimeout(existing);

  pendingSaves.set(key, setTimeout(async () => {
    pendingSaves.delete(key);
    try {
      await fetch(`${API_URL}/api/deployments/${deploymentId}/component-state/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ cardId, state }),
      });
    } catch (err) {
      console.warn("[ComponentState] Save failed:", err);
    }
  }, delayMs));
}

/** Load saved component state from PVC. Returns null if no saved state. */
export async function loadComponentState(
  deploymentId: string,
  cardId: string,
  token: string,
): Promise<unknown | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/deployments/${deploymentId}/component-state/${encodeURIComponent(cardId)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data.state ?? null;
  } catch {
    return null;
  }
}
