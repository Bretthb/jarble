/**
 * Knowledge Base Routes - Document ingestion + collection management
 *
 * POST /api/deployments/:id/knowledge/ingest - Ingest document text
 * GET  /api/deployments/:id/knowledge/collections - List collections
 * DELETE /api/deployments/:id/knowledge/collections/:collectionId - Delete collection
 *
 * In dev mode, stores files locally at jarble-api-main/data/knowledge/.
 * In prod, writes to the pod PVC at /data/knowledge/.
 */

import { Router } from "express";
import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { eq, and } from "drizzle-orm";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import { parseDocument } from "../services/documentParser.js";
import { createModuleLogger } from "../utils/logger.js";
import { env } from "../utils/env.js";

const log = createModuleLogger("knowledge");

export const knowledgeRouter = Router();

// ── Storage paths ────────────────────────────────────────────────────────

function getKnowledgeDir(deploymentId: string): string {
  if (env.NODE_ENV === "development") {
    // Local dev - store under jarble-api-main/data/knowledge/{deploymentId}
    const dir = join(process.cwd(), "data", "knowledge", deploymentId);
    mkdirSync(join(dir, "chunks"), { recursive: true });
    return dir;
  }
  // Prod - pod PVC
  const dir = `/data/knowledge`;
  mkdirSync(join(dir, "chunks"), { recursive: true });
  return dir;
}

function getManifestPath(knowledgeDir: string): string {
  return join(knowledgeDir, "manifest.json");
}

interface CollectionManifest {
  collections: Array<{
    id: string;
    filename: string;
    chunkCount: number;
    uploadedAt: string;
    detectedType: string;
    fileSize: number;
  }>;
}

function readManifest(knowledgeDir: string): CollectionManifest {
  const manifestPath = getManifestPath(knowledgeDir);
  if (existsSync(manifestPath)) {
    try {
      return JSON.parse(readFileSync(manifestPath, "utf-8"));
    } catch {
      return { collections: [] };
    }
  }
  return { collections: [] };
}

function writeManifest(knowledgeDir: string, manifest: CollectionManifest): void {
  writeFileSync(getManifestPath(knowledgeDir), JSON.stringify(manifest, null, 2), "utf-8");
}

// ── Auth helper ──────────────────────────────────────────────────────────

async function authenticateAndAuthorize(req: any, res: any): Promise<{ userId: string } | null> {
  const authHeader = req.headers.authorization;
  const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!bearerToken) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  let user;
  try {
    const payload = await verifyToken(bearerToken);
    user = await getUserFromToken(payload);
  } catch (err) {
    log.warn({ err, deploymentId: req.params.id }, "knowledge: JWT verification failed");
    res.status(401).json({ error: "Invalid token" });
    return null;
  }

  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  // Verify deployment ownership
  const deploymentId = req.params.id;
  const [deployment] = await db
    .select({ id: tables.deployments.id })
    .from(tables.deployments)
    .where(
      and(
        eq(tables.deployments.id, deploymentId),
        eq(tables.deployments.userId, user.id)
      )
    )
    .limit(1);

  if (!deployment) {
    res.status(404).json({ error: "Deployment not found" });
    return null;
  }

  return { userId: user.id };
}

// ── POST /ingest ─────────────────────────────────────────────────────────

const MAX_CONTENT_SIZE = 5 * 1024 * 1024; // 5MB max

knowledgeRouter.post("/:id/knowledge/ingest", async (req, res) => {
  try {
    const auth = await authenticateAndAuthorize(req, res);
    if (!auth) return;

    const { content, filename } = req.body;

    if (!content || typeof content !== "string") {
      res.status(400).json({ error: "Missing 'content' field (string)" });
      return;
    }

    if (!filename || typeof filename !== "string") {
      res.status(400).json({ error: "Missing 'filename' field (string)" });
      return;
    }

    if (content.length > MAX_CONTENT_SIZE) {
      res.status(413).json({ error: `Content too large (max ${MAX_CONTENT_SIZE / 1024 / 1024}MB)` });
      return;
    }

    // Validate file extension
    const ext = filename.toLowerCase().split(".").pop() || "";
    const allowedExts = ["txt", "md", "markdown", "json", "csv"];
    if (!allowedExts.includes(ext)) {
      res.status(400).json({ error: `Unsupported file type: .${ext}. Allowed: ${allowedExts.join(", ")}` });
      return;
    }

    const deploymentId = req.params.id;
    const knowledgeDir = getKnowledgeDir(deploymentId);

    // Parse document into chunks
    const parseResult = parseDocument(content, filename);

    if (parseResult.chunks.length === 0) {
      res.status(400).json({ error: "Document produced no chunks (empty or too small)" });
      return;
    }

    // Generate collection ID
    const collectionId = createHash("sha256")
      .update(`${deploymentId}:${filename}:${Date.now()}`)
      .digest("hex")
      .slice(0, 12);

    // Write chunks to file
    const chunksPath = join(knowledgeDir, "chunks", `${collectionId}.json`);
    writeFileSync(chunksPath, JSON.stringify(parseResult.chunks, null, 2), "utf-8");

    // Update manifest
    const manifest = readManifest(knowledgeDir);
    manifest.collections.push({
      id: collectionId,
      filename,
      chunkCount: parseResult.chunks.length,
      uploadedAt: new Date().toISOString(),
      detectedType: parseResult.detectedType,
      fileSize: Buffer.byteLength(content, "utf-8"),
    });
    writeManifest(knowledgeDir, manifest);

    log.info(
      { deploymentId, collectionId, filename, chunkCount: parseResult.chunks.length },
      "knowledge: document ingested"
    );

    res.json({
      collectionId,
      chunkCount: parseResult.chunks.length,
      filename,
      detectedType: parseResult.detectedType,
    });
  } catch (err) {
    log.error({ err, deploymentId: req.params.id }, "knowledge: ingest failed");
    res.status(500).json({ error: "Failed to ingest document" });
  }
});

// ── GET /collections ─────────────────────────────────────────────────────

knowledgeRouter.get("/:id/knowledge/collections", async (req, res) => {
  try {
    const auth = await authenticateAndAuthorize(req, res);
    if (!auth) return;

    const deploymentId = req.params.id;
    const knowledgeDir = getKnowledgeDir(deploymentId);
    const manifest = readManifest(knowledgeDir);

    res.json({ collections: manifest.collections });
  } catch (err) {
    log.error({ err, deploymentId: req.params.id }, "knowledge: list collections failed");
    res.status(500).json({ error: "Failed to list collections" });
  }
});

// ── DELETE /collections/:collectionId ────────────────────────────────────

knowledgeRouter.delete("/:id/knowledge/collections/:collectionId", async (req, res) => {
  try {
    const auth = await authenticateAndAuthorize(req, res);
    if (!auth) return;

    const deploymentId = req.params.id;
    const { collectionId } = req.params;
    const knowledgeDir = getKnowledgeDir(deploymentId);

    // Remove from manifest
    const manifest = readManifest(knowledgeDir);
    const idx = manifest.collections.findIndex((c) => c.id === collectionId);
    if (idx === -1) {
      res.status(404).json({ error: "Collection not found" });
      return;
    }

    manifest.collections.splice(idx, 1);
    writeManifest(knowledgeDir, manifest);

    // Delete chunk file
    const chunksPath = join(knowledgeDir, "chunks", `${collectionId}.json`);
    try {
      rmSync(chunksPath);
    } catch {
      // File might already be gone
    }

    log.info({ deploymentId, collectionId }, "knowledge: collection deleted");
    res.json({ success: true });
  } catch (err) {
    log.error({ err, deploymentId: req.params.id }, "knowledge: delete collection failed");
    res.status(500).json({ error: "Failed to delete collection" });
  }
});
