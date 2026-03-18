/**
 * Chat Session Manager — In-memory tracker for active chat runs.
 *
 * Enables cross-channel coordination between the WS control channel
 * and SSE chat streams. Single-process only (no Redis needed yet).
 */

import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("chatSession");

export interface ActiveRun {
  runId: string;
  deploymentId: string;
  abortController: AbortController;
  startedAt: number;
  /** Human-readable status of the current tool (e.g. "Searching the web...") */
  toolStatus?: string;
  /** Whether the user is currently typing */
  typing?: boolean;
}

class ChatSessionManager {
  private activeRuns = new Map<string, ActiveRun>(); // deploymentId → run

  registerRun(deploymentId: string, runId: string, abortController: AbortController): void {
    // Abort any existing run for this deployment first
    const existing = this.activeRuns.get(deploymentId);
    if (existing) {
      log.debug({ deploymentId, oldRunId: existing.runId, newRunId: runId }, "Replacing existing run");
      try { existing.abortController.abort(); } catch {}
    }
    this.activeRuns.set(deploymentId, {
      runId,
      deploymentId,
      abortController,
      startedAt: Date.now(),
    });
    log.debug({ deploymentId, runId }, "Run registered");
  }

  unregisterRun(deploymentId: string): void {
    const run = this.activeRuns.get(deploymentId);
    if (run) {
      this.activeRuns.delete(deploymentId);
      log.debug({ deploymentId, runId: run.runId }, "Run unregistered");
    }
  }

  getActiveRun(deploymentId: string): ActiveRun | undefined {
    return this.activeRuns.get(deploymentId);
  }

  abortRun(deploymentId: string): boolean {
    const run = this.activeRuns.get(deploymentId);
    if (!run) return false;
    log.info({ deploymentId, runId: run.runId }, "Run aborted via session manager");
    try {
      run.abortController.abort();
    } catch {}
    this.activeRuns.delete(deploymentId);
    return true;
  }

  setToolStatus(deploymentId: string, status: string | undefined): void {
    const run = this.activeRuns.get(deploymentId);
    if (run) {
      run.toolStatus = status;
    }
  }

  setTyping(deploymentId: string, isTyping: boolean): void {
    const run = this.activeRuns.get(deploymentId);
    if (run) {
      run.typing = isTyping;
    }
  }
}

export const sessionManager = new ChatSessionManager();
