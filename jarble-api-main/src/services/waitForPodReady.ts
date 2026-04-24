/**
 * waitForPodReady — poll a deployment's pod until it reports `running`,
 * `failed`, or the timeout fires. Extracted from configSync.ts (JAR-89 §9)
 * where two near-identical loops open-coded this pattern:
 *
 *   - Tier 2 (process restart): fixed 2s interval, 60s max.
 *   - Tier 3 (full pod restart): adaptive 1s/2s/3s, 180s max.
 *
 * Callers pass `intervalFn` to control pacing. Default is a fixed 2s.
 */

import { getDeploymentPodStatus } from "../k8s/index.js";
import type { ManagedBy } from "../k8s/constants.js";

export interface WaitForPodReadyOptions {
  /** Hard timeout; when exceeded, returns `{ ready: false }` with no error. */
  timeoutMs: number;
  /**
   * Optional function that returns the next poll interval (ms) given how
   * many ms have elapsed since polling started. Default: fixed 2s.
   */
  intervalFn?: (elapsedMs: number) => number;
}

export interface WaitForPodReadyResult {
  ready: boolean;
  /**
   * When the pod's status transitioned to `failed` during polling, this
   * carries the error reported by `getDeploymentPodStatus`. On timeout
   * without a transition it is undefined — the caller can supply a
   * timeout-specific message.
   */
  error?: string;
}

/**
 * Adaptive interval used by Tier 3 — short polls while the pod might be
 * a warm boot (.initialized present → ready in ~15s), stretching out to
 * match cold-boot npm install windows (~2-3 min).
 */
export const ADAPTIVE_POLL_INTERVAL = (elapsedMs: number): number =>
  elapsedMs < 20_000 ? 1000 : elapsedMs < 60_000 ? 2000 : 3000;

export async function waitForPodReady(
  deploymentId: string,
  managedBy: ManagedBy,
  opts: WaitForPodReadyOptions,
): Promise<WaitForPodReadyResult> {
  const intervalFn = opts.intervalFn ?? (() => 2000);
  const startMs = Date.now();

  while (Date.now() - startMs < opts.timeoutMs) {
    const status = await getDeploymentPodStatus(deploymentId, managedBy);
    if (status.status === "running") {
      return { ready: true };
    }
    if (status.status === "failed") {
      return { ready: false, error: status.error || "Pod failed" };
    }
    const elapsedMs = Date.now() - startMs;
    await new Promise((r) => setTimeout(r, intervalFn(elapsedMs)));
  }

  return { ready: false };
}
