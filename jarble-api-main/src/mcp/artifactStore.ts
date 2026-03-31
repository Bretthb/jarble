/**
 * Artifact Store - CRUD operations for artifacts stored as JSON files on the PVC.
 *
 * Artifacts are the persistent building blocks of a deployment's workspace.
 * Each artifact maps to a rendered canvas component (chart, table, sandbox, etc.)
 * and is stored as a JSON file alongside a manifest for fast listing.
 *
 * Directory structure on PVC:
 *   {workspaceDir}/
 *   ├── manifest.json           # { version: 1, artifacts: ArtifactMeta[] }
 *   └── artifacts/
 *       └── {id}.json           # Full Artifact object
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync, renameSync } from "fs";
import { join } from "path";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ArtifactMeta {
  id: string;
  component: string;
  title: string;
  createdAt: string; // ISO8601
  updatedAt: string; // ISO8601
  pinned: boolean;
}

export interface Artifact extends ArtifactMeta {
  props: Record<string, unknown>;
  source: "bot" | "user";
  dataSource?: {
    type: "file" | "skill";
    path?: string;
    skill?: string;
    args?: Record<string, unknown>;
    pollInterval?: number; // seconds, min 5, max 3600
    transform?: string; // dot-path to extract data
  } | null;
}

interface Manifest {
  version: number;
  artifacts: ArtifactMeta[];
}

/** Old format stored in /data/files/*.json */
interface OldFileFormat {
  component: string;
  props: Record<string, unknown>;
  name?: string;
  description?: string;
  tags?: string[];
  savedAt?: string;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ARTIFACT_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_ARTIFACT_SIZE = 1 * 1024 * 1024; // 1 MB
const MANIFEST_VERSION = 1;

// ─── Helpers ────────────────────────────────────────────────────────────────

function artifactsDir(workspaceDir: string): string {
  return join(workspaceDir, "artifacts");
}

function manifestPath(workspaceDir: string): string {
  return join(workspaceDir, "manifest.json");
}

function artifactPath(workspaceDir: string, id: string): string {
  return join(artifactsDir(workspaceDir), `${id}.json`);
}

function validateId(id: string): void {
  if (!ARTIFACT_ID_PATTERN.test(id)) {
    throw new Error(
      `Invalid artifact ID "${id}": must match /^[a-zA-Z0-9_-]{1,64}$/`
    );
  }
}

function metaFromArtifact(artifact: Artifact): ArtifactMeta {
  return {
    id: artifact.id,
    component: artifact.component,
    title: artifact.title,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    pinned: artifact.pinned,
  };
}

// ─── Workspace Initialization ───────────────────────────────────────────────

/**
 * Ensures the workspace directory, artifacts subdirectory, and manifest.json
 * all exist. Creates them if missing.
 */
function ensureWorkspace(workspaceDir: string): void {
  if (!existsSync(workspaceDir)) {
    mkdirSync(workspaceDir, { recursive: true });
  }
  const artDir = artifactsDir(workspaceDir);
  if (!existsSync(artDir)) {
    mkdirSync(artDir, { recursive: true });
  }
  const mPath = manifestPath(workspaceDir);
  if (!existsSync(mPath)) {
    const emptyManifest: Manifest = { version: MANIFEST_VERSION, artifacts: [] };
    writeFileSync(mPath, JSON.stringify(emptyManifest, null, 2), "utf-8");
  }
}

function rebuildManifest(workspaceDir: string): Manifest {
  const artDir = artifactsDir(workspaceDir);
  const artifacts: ArtifactMeta[] = [];

  if (existsSync(artDir)) {
    const files = readdirSync(artDir).filter(f => f.endsWith(".json") && !f.endsWith(".tmp"));
    for (const file of files) {
      try {
        const raw = readFileSync(join(artDir, file), "utf-8");
        const artifact = JSON.parse(raw) as Artifact;
        if (artifact.id && artifact.component) {
          artifacts.push(metaFromArtifact(artifact));
        }
      } catch {
        // Skip corrupted artifact files
      }
    }
  }

  const manifest: Manifest = { version: MANIFEST_VERSION, artifacts };
  writeManifest(workspaceDir, manifest);
  return manifest;
}

function readManifest(workspaceDir: string): Manifest {
  ensureWorkspace(workspaceDir);
  try {
    const raw = readFileSync(manifestPath(workspaceDir), "utf-8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return rebuildManifest(workspaceDir);
  }
}

function writeManifest(workspaceDir: string, manifest: Manifest): void {
  const mPath = manifestPath(workspaceDir);
  const tmpPath = mPath + ".tmp";
  writeFileSync(tmpPath, JSON.stringify(manifest, null, 2), "utf-8");
  renameSync(tmpPath, mPath);
}

function validateDataSource(ds: Artifact["dataSource"]): void {
  if (!ds) return;

  if (ds.pollInterval !== undefined) {
    if (ds.pollInterval < 5 || ds.pollInterval > 3600) {
      throw new Error(`pollInterval must be between 5 and 3600 seconds, got ${ds.pollInterval}`);
    }
  }

  if (ds.type === "file" && !ds.path) {
    throw new Error('dataSource type "file" requires a "path" field');
  }

  if (ds.type === "skill" && !ds.skill) {
    throw new Error('dataSource type "skill" requires a "skill" field');
  }
}

// ─── CRUD Operations ────────────────────────────────────────────────────────

export interface SaveArtifactInput {
  id: string;
  component: string;
  props: Record<string, unknown>;
  title: string;
  pinned?: boolean;
  source?: "bot" | "user";
  dataSource?: Artifact["dataSource"];
}

/**
 * Save (create or update) an artifact.
 *
 * - On create: sets createdAt, updatedAt, pinned defaults to false, source defaults to "bot"
 * - On update: preserves createdAt, bumps updatedAt, preserves pinned if not explicitly provided
 */
export function saveArtifact(
  workspaceDir: string,
  input: SaveArtifactInput
): Artifact {
  validateId(input.id);
  ensureWorkspace(workspaceDir);

  const now = new Date().toISOString();
  const manifest = readManifest(workspaceDir);
  const existingIdx = manifest.artifacts.findIndex((a) => a.id === input.id);

  // Load existing artifact if updating
  let existing: Artifact | null = null;
  const filePath = artifactPath(workspaceDir, input.id);
  if (existingIdx !== -1 && existsSync(filePath)) {
    try {
      existing = JSON.parse(readFileSync(filePath, "utf-8")) as Artifact;
    } catch {
      // Corrupted file - treat as new
    }
  }

  const artifact: Artifact = {
    id: input.id,
    component: input.component,
    props: input.props,
    title: input.title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    pinned:
      input.pinned !== undefined
        ? input.pinned
        : existing?.pinned ?? false,
    source: input.source ?? existing?.source ?? "bot",
    dataSource: input.dataSource !== undefined ? input.dataSource : (existing?.dataSource ?? null),
  };

  // Validate dataSource before writing
  validateDataSource(artifact.dataSource);

  // Validate size before writing
  const serialized = JSON.stringify(artifact, null, 2);
  const byteLength = Buffer.byteLength(serialized, "utf-8");
  if (byteLength > MAX_ARTIFACT_SIZE) {
    throw new Error(
      `Artifact "${input.id}" exceeds 1 MB limit (${byteLength} bytes)`
    );
  }

  // Write artifact file (atomic: write to .tmp then rename)
  const tmpFilePath = filePath + ".tmp";
  writeFileSync(tmpFilePath, serialized, "utf-8");
  renameSync(tmpFilePath, filePath);

  // Update manifest
  const meta = metaFromArtifact(artifact);
  if (existingIdx !== -1) {
    manifest.artifacts[existingIdx] = meta;
  } else {
    manifest.artifacts.push(meta);
  }
  writeManifest(workspaceDir, manifest);

  return artifact;
}

/**
 * Load a single artifact by ID. Returns null if not found.
 */
export function loadArtifact(
  workspaceDir: string,
  id: string
): Artifact | null {
  validateId(id);
  ensureWorkspace(workspaceDir);

  const filePath = artifactPath(workspaceDir, id);
  if (!existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Artifact;
  } catch {
    return null;
  }
}

/**
 * List all artifacts. Returns metadata sorted by updatedAt descending (most recent first).
 */
export function listArtifacts(workspaceDir: string): ArtifactMeta[] {
  const manifest = readManifest(workspaceDir);
  return [...manifest.artifacts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

/**
 * Delete an artifact by ID. Idempotent - returns false if the artifact did not exist.
 */
export function deleteArtifact(workspaceDir: string, id: string): boolean {
  validateId(id);
  ensureWorkspace(workspaceDir);

  const manifest = readManifest(workspaceDir);
  const idx = manifest.artifacts.findIndex((a) => a.id === id);

  // Remove file if it exists
  const filePath = artifactPath(workspaceDir, id);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }

  // Remove from manifest
  if (idx !== -1) {
    manifest.artifacts.splice(idx, 1);
    writeManifest(workspaceDir, manifest);
    return true;
  }

  return false;
}

// ─── Migration ──────────────────────────────────────────────────────────────

/**
 * Migrate old-format files from /data/files/ to the artifact workspace.
 *
 * Old format: { component, props, name, description, tags, savedAt }
 * New format: full Artifact with generated ID from filename.
 *
 * Returns the number of files successfully migrated.
 */
export function migrateOldFiles(
  filesDir: string,
  workspaceDir: string
): number {
  ensureWorkspace(workspaceDir);

  if (!existsSync(filesDir)) {
    return 0;
  }

  const entries = readdirSync(filesDir).filter((f) => f.endsWith(".json"));
  let migrated = 0;

  for (const entry of entries) {
    try {
      const raw = readFileSync(join(filesDir, entry), "utf-8");
      const old = JSON.parse(raw) as OldFileFormat;

      // Must have at least component and props
      if (!old.component || typeof old.props !== "object" || old.props === null) {
        continue;
      }

      // Derive ID from filename (strip .json, sanitize)
      const rawId = entry.replace(/\.json$/, "");
      const sanitizedId = rawId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
      if (!sanitizedId) continue;

      const now = new Date().toISOString();
      const artifact: Artifact = {
        id: sanitizedId,
        component: old.component,
        props: old.props,
        title: old.name || old.description || sanitizedId,
        createdAt: old.savedAt || now,
        updatedAt: now,
        pinned: false,
        source: "bot",
        dataSource: null,
      };

      const serialized = JSON.stringify(artifact, null, 2);
      if (Buffer.byteLength(serialized, "utf-8") > MAX_ARTIFACT_SIZE) {
        continue; // Skip oversized files
      }

      // Write artifact file
      writeFileSync(
        artifactPath(workspaceDir, sanitizedId),
        serialized,
        "utf-8"
      );

      // Update manifest
      const manifest = readManifest(workspaceDir);
      // Avoid duplicate IDs
      if (!manifest.artifacts.some((a) => a.id === sanitizedId)) {
        manifest.artifacts.push(metaFromArtifact(artifact));
        writeManifest(workspaceDir, manifest);
      }

      migrated++;
    } catch {
      // Skip malformed files
      continue;
    }
  }

  return migrated;
}
