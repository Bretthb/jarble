/**
 * Artifact API - CRUD endpoints for the pod workspace artifact system
 *
 * The bot pods have a workspace at /data/workspace/ with:
 *   - manifest.json  - array of ArtifactMeta (id, title, component, updatedAt, ...)
 *   - {id}.json      - full Artifact payload per artifact
 *
 * These endpoints exec into the pod to read/write those files, following the
 * same auth + ownership + pod-exec patterns used by canvasFiles.ts.
 *
 * Routes (all under /api/deployments):
 *   GET  /:id/artifact/list          - list all artifact metadata
 *   GET  /:id/artifact/:artifactId   - fetch a single artifact
 *   POST /:id/artifact/sync          - upsert an artifact from the frontend
 *   DELETE /:id/artifact/:artifactId - delete an artifact
 */

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { findPodForDeployment, execInPod } from "../k8s/index.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("artifact");
export const artifactRouter = Router();

/** Workspace base path on the pod PVC */
const WORKSPACE_DIR = "/data/workspace";
const MANIFEST_PATH = `${WORKSPACE_DIR}/manifest.json`;

/** Artifact ID must be 1-64 alphanumeric/dash/underscore chars */
const ARTIFACT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Per-ARTIFACT lock to serialize concurrent syncs of the same card.
 * Previously this was a per-deployment 1-second cooldown, which caused
 * the canvas persistence bug: when a bot rendered multiple components
 * in a single response, the frontend would fire multiple POST /sync
 * calls within milliseconds. The first succeeded; the rest got 429
 * and never persisted to the pod, so on reload the cards rehydrated
 * with empty props.
 *
 * New semantics:
 *  - Two different artifacts sync concurrently (no cooldown).
 *  - Two rapid syncs of the SAME artifact serialize via a promise lock,
 *    so the second waits for the first to finish. This prevents racing
 *    writes to the same file without losing data.
 */
const artifactLocks = new Map<string, Promise<void>>();

function artifactLockKey(deploymentId: string, artifactId: string): string {
  return `${deploymentId}:${artifactId}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Authenticate + extract user from bearer token */
async function authenticateRequest(req: any): Promise<{ id: string } | null> {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;
  if (!bearerToken) return null;
  try {
    const payload = await verifyToken(bearerToken);
    const user = await getUserFromToken(payload);
    return user ? { id: user.id } : null;
  } catch {
    return null;
  }
}

/** Verify user owns the deployment, return deployment row or null */
async function verifyOwnership(userId: string, deploymentId: string) {
  const dep = await db.query.deployments.findFirst({
    where: and(
      eq(tables.deployments.id, deploymentId),
      eq(tables.deployments.userId, userId)
    ),
  });
  return dep || null;
}

/** Exec read: cat a file from the pod, return content string or null */
async function execRead(
  podName: string,
  filePath: string
): Promise<string | null> {
  try {
    const result = await execInPod(podName, [
      "sh",
      "-c",
      `cat '${filePath}' 2>/dev/null || echo '__NOT_FOUND__'`,
    ]);
    if (result.trim() === "__NOT_FOUND__") return null;
    return result;
  } catch {
    return null;
  }
}

/** Exec write: base64-encode content and pipe into the target file */
async function execWrite(
  podName: string,
  filePath: string,
  content: string
): Promise<void> {
  const b64 = Buffer.from(content).toString("base64");
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  await execInPod(podName, [
    "sh",
    "-c",
    `mkdir -p '${dir}' && echo '${b64}' | base64 -d > '${filePath}'`,
  ]);
}

// ── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /:id/artifact/list
 * Returns { artifacts: ArtifactMeta[] }
 */
artifactRouter.get("/:id/artifact/list", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const deploymentId = req.params.id;
    const deployment = await verifyOwnership(user.id, deploymentId);
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    const podName = await findPodForDeployment(deploymentId);
    if (!podName) {
      // Pod not running - return empty list rather than error
      res.json({ artifacts: [] });
      return;
    }

    const raw = await execRead(podName, MANIFEST_PATH);
    if (!raw) {
      res.json({ artifacts: [] });
      return;
    }

    try {
      const manifest = JSON.parse(raw);
      const artifacts = Array.isArray(manifest.artifacts)
        ? manifest.artifacts
        : [];
      res.json({ artifacts });
    } catch {
      log.warn({ deploymentId }, "Failed to parse workspace manifest");
      res.json({ artifacts: [] });
    }
  } catch (err: unknown) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "artifact list error"
    );
    res.status(500).json({ error: "Failed to list artifacts" });
  }
});

/**
 * GET /:id/artifact/:artifactId
 * Returns the full artifact JSON
 */
artifactRouter.get("/:id/artifact/:artifactId", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id: deploymentId, artifactId } = req.params;

    if (!ARTIFACT_ID_RE.test(artifactId)) {
      res.status(400).json({ error: "Invalid artifact ID format" });
      return;
    }

    const deployment = await verifyOwnership(user.id, deploymentId);
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    const podName = await findPodForDeployment(deploymentId);
    if (!podName) {
      res.status(503).json({ error: "Pod not running" });
      return;
    }

    const raw = await execRead(podName, `${WORKSPACE_DIR}/${artifactId}.json`);
    if (!raw) {
      res.status(404).json({ error: "Artifact not found" });
      return;
    }

    try {
      const artifact = JSON.parse(raw);
      res.json(artifact);
    } catch {
      res.status(500).json({ error: "Corrupt artifact data" });
    }
  } catch (err: unknown) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "artifact get error"
    );
    res.status(500).json({ error: "Failed to get artifact" });
  }
});

/**
 * POST /:id/artifact/sync
 * Upsert an artifact from the frontend.
 * Body: { id, component, props, title }
 * Preserves createdAt and pinned from existing artifact if present.
 */
artifactRouter.post("/:id/artifact/sync", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const deploymentId = req.params.id;
    const deployment = await verifyOwnership(user.id, deploymentId);
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    // Validate body
    const { id: artifactId, component, props, title } = req.body;
    if (!artifactId || !component || !props || !title) {
      res
        .status(400)
        .json({ error: "Missing required fields: id, component, props, title" });
      return;
    }

    if (typeof artifactId !== "string" || !ARTIFACT_ID_RE.test(artifactId)) {
      res.status(400).json({ error: "Invalid artifact ID format" });
      return;
    }

    // Per-artifact serialization lock. Different artifacts sync in parallel;
    // multiple rapid syncs of the SAME artifact queue behind each other.
    // Replaces the old 1-second per-deployment cooldown that dropped
    // multi-component bot responses.
    const lockKey = artifactLockKey(deploymentId, artifactId);
    const previous = artifactLocks.get(lockKey) ?? Promise.resolve();
    let releaseLock!: () => void;
    const current = new Promise<void>((resolve) => { releaseLock = resolve; });
    // Chain our work behind the previous work. The stored promise is what
    // the next caller will wait on (so a third sync waits for us to finish).
    const chained = previous.then(() => current);
    artifactLocks.set(lockKey, chained);
    await previous;

    try {
    // Find pod
    const podName = await findPodForDeployment(deploymentId);
    if (!podName) {
      res.status(503).json({ error: "Pod not running" });
      return;
    }

    // Read existing artifact to preserve createdAt/pinned
    const existingRaw = await execRead(
      podName,
      `${WORKSPACE_DIR}/${artifactId}.json`
    );
    let createdAt = new Date().toISOString();
    let pinned = false;
    if (existingRaw) {
      try {
        const existing = JSON.parse(existingRaw);
        if (existing.createdAt) createdAt = existing.createdAt;
        if (existing.pinned) pinned = existing.pinned;
      } catch {
        // ignore parse errors on existing artifact
      }
    }

    // Build artifact
    const artifact = {
      id: artifactId,
      component,
      props,
      title,
      source: "user",
      createdAt,
      updatedAt: new Date().toISOString(),
      pinned,
    };

    // Write artifact file
    await execWrite(
      podName,
      `${WORKSPACE_DIR}/${artifactId}.json`,
      JSON.stringify(artifact, null, 2)
    );

    // Update manifest: read existing, upsert entry, write back
    let manifestArtifacts: any[] = [];
    const manifestRaw = await execRead(podName, MANIFEST_PATH);
    if (manifestRaw) {
      try {
        const manifest = JSON.parse(manifestRaw);
        manifestArtifacts = Array.isArray(manifest.artifacts)
          ? manifest.artifacts
          : [];
      } catch {
        // start fresh if manifest is corrupt
      }
    }

    // Build manifest entry (metadata only, no props)
    const metaEntry = {
      id: artifactId,
      title,
      component,
      source: "user",
      createdAt,
      updatedAt: artifact.updatedAt,
      pinned,
    };

    // Upsert: replace existing entry or append
    const existingIdx = manifestArtifacts.findIndex(
      (a: any) => a.id === artifactId
    );
    if (existingIdx >= 0) {
      manifestArtifacts[existingIdx] = metaEntry;
    } else {
      manifestArtifacts.push(metaEntry);
    }

    await execWrite(
      podName,
      MANIFEST_PATH,
      JSON.stringify({ artifacts: manifestArtifacts }, null, 2)
    );

    log.debug({ deploymentId, artifactId }, "Artifact synced");
    res.json({ ok: true, artifact });
    } finally {
      // Release the per-artifact lock so the next queued sync (if any) proceeds.
      releaseLock();
      // Best-effort cleanup: if no one queued behind us, drop the map entry
      // so it doesn't grow unbounded over time.
      if (artifactLocks.get(lockKey) === chained) {
        artifactLocks.delete(lockKey);
      }
    }
  } catch (err: unknown) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "artifact sync error"
    );
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to sync artifact" });
    }
  }
});

/**
 * DELETE /:id/artifact/:artifactId
 * Remove an artifact file and its manifest entry.
 */
artifactRouter.delete("/:id/artifact/:artifactId", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const { id: deploymentId, artifactId } = req.params;

    if (!ARTIFACT_ID_RE.test(artifactId)) {
      res.status(400).json({ error: "Invalid artifact ID format" });
      return;
    }

    const deployment = await verifyOwnership(user.id, deploymentId);
    if (!deployment) {
      res.status(404).json({ error: "Deployment not found" });
      return;
    }

    const podName = await findPodForDeployment(deploymentId);
    if (!podName) {
      res.status(503).json({ error: "Pod not running" });
      return;
    }

    // Delete artifact file (rm -f is idempotent)
    await execInPod(podName, [
      "sh",
      "-c",
      `rm -f '${WORKSPACE_DIR}/${artifactId}.json'`,
    ]);

    // Update manifest: filter out this artifact
    const manifestRaw = await execRead(podName, MANIFEST_PATH);
    if (manifestRaw) {
      try {
        const manifest = JSON.parse(manifestRaw);
        const artifacts = Array.isArray(manifest.artifacts)
          ? manifest.artifacts.filter((a: any) => a.id !== artifactId)
          : [];
        await execWrite(
          podName,
          MANIFEST_PATH,
          JSON.stringify({ artifacts }, null, 2)
        );
      } catch {
        // If manifest is corrupt, just leave it
        log.warn({ deploymentId }, "Failed to update manifest after delete");
      }
    }

    log.debug({ deploymentId, artifactId }, "Artifact deleted");
    res.json({ ok: true });
  } catch (err: unknown) {
    log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "artifact delete error"
    );
    res.status(500).json({ error: "Failed to delete artifact" });
  }
});
