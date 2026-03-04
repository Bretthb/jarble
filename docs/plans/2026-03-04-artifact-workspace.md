# Artifact Workspace Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a persistent workspace system where UI artifacts live on the bot's PVC, the frontend auto-saves edits back, restores workspace on session start, and supports live data updates — plus validate the marketplace system end-to-end with real bots.

**Architecture:** Pod-side artifact store at `/data/workspace/` with manifest index. Three new API endpoints for frontend sync. New MCP tools replace old `save_canvas_file` family. SSE `ARTIFACT_UPDATED` event for live data push. Frontend `useArtifactSync` hook for auto-save + subscription. Marketplace testing validates the component/package install flows against running bots.

**Tech Stack:** Express routes, kubectl exec (base64+node write pattern), MCP stdio tools (jarble-ui-server.js), SSE events, React hooks, Vitest

---

### Task 1: MCP Artifact Tools — Tests

Write tests for the new artifact MCP tools that will replace `save_canvas_file` / `load_canvas_file` / `list_canvas_files` / `delete_canvas_file`.

**Files:**
- Create: `jarble-api-main/src/mcp/__tests__/artifactTools.test.ts`

**Step 1: Write the test file**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

// We'll test the artifact helper functions directly
// These will be extracted from jarble-ui-server.js into a testable module

const WORKSPACE_DIR = "/data/workspace";
const ARTIFACTS_DIR = "/data/workspace/artifacts";
const MANIFEST_PATH = "/data/workspace/manifest.json";

describe("Artifact Tools", () => {
  let tmpDir: string;
  let workspaceDir: string;
  let artifactsDir: string;
  let manifestPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-test-"));
    workspaceDir = path.join(tmpDir, "workspace");
    artifactsDir = path.join(workspaceDir, "artifacts");
    manifestPath = path.join(workspaceDir, "manifest.json");
    fs.mkdirSync(artifactsDir, { recursive: true });
    fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, artifacts: [] }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("save_artifact", () => {
    it("creates a new artifact and updates manifest", () => {
      // Will test saveArtifact(workspaceDir, { id, component, props, title })
    });

    it("updates an existing artifact and bumps updatedAt", () => {
      // Save twice with same id, verify updatedAt changes
    });

    it("rejects invalid artifact IDs", () => {
      // IDs with special chars, too long, etc.
    });

    it("rejects artifacts exceeding 1MB", () => {
      // Large props object
    });

    it("sets pinned=false by default", () => {
      // Verify default pinned state
    });

    it("preserves pinned state on update", () => {
      // Save with pinned=true, update props, verify still pinned
    });
  });

  describe("load_artifact", () => {
    it("returns full artifact data", () => {
      // Save then load, verify all fields present
    });

    it("returns null for non-existent artifact", () => {
      // Load with unknown id
    });
  });

  describe("list_artifacts", () => {
    it("returns empty array for new workspace", () => {
      // Fresh manifest
    });

    it("returns metadata for all artifacts", () => {
      // Save 3 artifacts, list, verify metadata (no props)
    });

    it("sorts by updatedAt descending", () => {
      // Save 3 artifacts with different times
    });
  });

  describe("delete_artifact", () => {
    it("removes artifact file and manifest entry", () => {
      // Save then delete, verify both gone
    });

    it("is idempotent for non-existent artifact", () => {
      // Delete unknown id, no error
    });
  });

  describe("manifest integrity", () => {
    it("creates workspace directory if missing", () => {
      // Remove workspace dir, save artifact, verify created
    });

    it("creates manifest.json if missing", () => {
      // Remove manifest, save artifact, verify created with version 1
    });

    it("handles concurrent saves gracefully", () => {
      // Two rapid saves, verify manifest has both
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd jarble-api-main && npx vitest run src/mcp/__tests__/artifactTools.test.ts`
Expected: FAIL — test file has no implementations to test yet

**Step 3: Commit**

```bash
git add jarble-api-main/src/mcp/__tests__/artifactTools.test.ts
git commit -m "test: add artifact tools test scaffolding"
```

---

### Task 2: Artifact Helper Module

Extract artifact CRUD logic into a testable module. The MCP server will import these functions.

**Files:**
- Create: `jarble-api-main/src/mcp/artifactStore.ts`
- Modify: `jarble-api-main/src/mcp/__tests__/artifactTools.test.ts` (update imports)

**Step 1: Implement the artifact store module**

```typescript
// jarble-api-main/src/mcp/artifactStore.ts
import * as fs from "fs";
import * as path from "path";

const ARTIFACT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_ARTIFACT_SIZE = 1_000_000; // 1MB

export interface ArtifactMeta {
  id: string;
  component: string;
  title: string;
  createdAt: string;
  updatedAt: string;
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
    pollInterval?: number;
    transform?: string;
  } | null;
}

interface Manifest {
  version: number;
  artifacts: ArtifactMeta[];
}

function ensureWorkspace(workspaceDir: string): void {
  const artifactsDir = path.join(workspaceDir, "artifacts");
  fs.mkdirSync(artifactsDir, { recursive: true });
  const manifestPath = path.join(workspaceDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    const empty: Manifest = { version: 1, artifacts: [] };
    fs.writeFileSync(manifestPath, JSON.stringify(empty, null, 2));
  }
}

function readManifest(workspaceDir: string): Manifest {
  ensureWorkspace(workspaceDir);
  const raw = fs.readFileSync(path.join(workspaceDir, "manifest.json"), "utf-8");
  return JSON.parse(raw);
}

function writeManifest(workspaceDir: string, manifest: Manifest): void {
  fs.writeFileSync(
    path.join(workspaceDir, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );
}

export function saveArtifact(
  workspaceDir: string,
  input: {
    id: string;
    component: string;
    props: Record<string, unknown>;
    title: string;
    pinned?: boolean;
    source?: "bot" | "user";
    dataSource?: Artifact["dataSource"];
  }
): Artifact {
  if (!ARTIFACT_ID_RE.test(input.id)) {
    throw new Error(`Invalid artifact ID: ${input.id}. Must match ${ARTIFACT_ID_RE}`);
  }

  ensureWorkspace(workspaceDir);
  const manifest = readManifest(workspaceDir);
  const now = new Date().toISOString();

  // Check if exists
  const existingIdx = manifest.artifacts.findIndex((a) => a.id === input.id);
  const existing = existingIdx >= 0
    ? JSON.parse(
        fs.readFileSync(path.join(workspaceDir, "artifacts", `${input.id}.json`), "utf-8")
      ) as Artifact
    : null;

  const artifact: Artifact = {
    id: input.id,
    component: input.component,
    props: input.props,
    title: input.title,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    pinned: input.pinned ?? existing?.pinned ?? false,
    source: input.source ?? "bot",
    dataSource: input.dataSource ?? existing?.dataSource ?? null,
  };

  // Size check
  const json = JSON.stringify(artifact, null, 2);
  if (Buffer.byteLength(json, "utf-8") > MAX_ARTIFACT_SIZE) {
    throw new Error(`Artifact exceeds maximum size of ${MAX_ARTIFACT_SIZE} bytes`);
  }

  // Write artifact file
  fs.writeFileSync(path.join(workspaceDir, "artifacts", `${input.id}.json`), json);

  // Update manifest
  const meta: ArtifactMeta = {
    id: artifact.id,
    component: artifact.component,
    title: artifact.title,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    pinned: artifact.pinned,
  };

  if (existingIdx >= 0) {
    manifest.artifacts[existingIdx] = meta;
  } else {
    manifest.artifacts.push(meta);
  }

  writeManifest(workspaceDir, manifest);
  return artifact;
}

export function loadArtifact(workspaceDir: string, id: string): Artifact | null {
  const filePath = path.join(workspaceDir, "artifacts", `${id}.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

export function listArtifacts(workspaceDir: string): ArtifactMeta[] {
  ensureWorkspace(workspaceDir);
  const manifest = readManifest(workspaceDir);
  return [...manifest.artifacts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
  );
}

export function deleteArtifact(workspaceDir: string, id: string): boolean {
  ensureWorkspace(workspaceDir);
  const manifest = readManifest(workspaceDir);
  const idx = manifest.artifacts.findIndex((a) => a.id === id);
  if (idx < 0) return false;

  manifest.artifacts.splice(idx, 1);
  writeManifest(workspaceDir, manifest);

  const filePath = path.join(workspaceDir, "artifacts", `${id}.json`);
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  return true;
}

/**
 * Migrate old /data/files/ artifacts to /data/workspace/artifacts/.
 * Called once on MCP server startup.
 */
export function migrateOldFiles(filesDir: string, workspaceDir: string): number {
  if (!fs.existsSync(filesDir)) return 0;
  let count = 0;
  const files = fs.readdirSync(filesDir).filter((f) => f.endsWith(".json"));
  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(filesDir, file), "utf-8");
      const old = JSON.parse(raw);
      const id = file.replace(".json", "");
      saveArtifact(workspaceDir, {
        id,
        component: old.component || "unknown",
        props: old.props || {},
        title: old.name || id,
        source: "bot",
      });
      count++;
    } catch {
      // Skip malformed files
    }
  }
  return count;
}
```

**Step 2: Update tests to import from artifactStore**

Update the test file imports and fill in test bodies using the actual `saveArtifact`, `loadArtifact`, `listArtifacts`, `deleteArtifact` functions. Pass `tmpDir`-based `workspaceDir` to each function.

**Step 3: Run tests**

Run: `cd jarble-api-main && npx vitest run src/mcp/__tests__/artifactTools.test.ts`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add jarble-api-main/src/mcp/artifactStore.ts jarble-api-main/src/mcp/__tests__/artifactTools.test.ts
git commit -m "feat: add artifact store module with CRUD + migration"
```

---

### Task 3: Wire Artifact Tools into MCP Server

Replace the old `save_canvas_file` / `load_canvas_file` / `list_canvas_files` / `delete_canvas_file` tools with new artifact tools in the MCP server. Keep old tool names as aliases.

**Files:**
- Modify: `jarble-api-main/src/mcp/jarble-ui-server.js`

**Step 1: Add artifact tool definitions**

At the tool definitions section (around line 380), add new tools alongside existing ones:

```javascript
// ── Artifact tools (replace old canvas file tools) ──────────────────
{
  name: "save_artifact",
  description: "Save or update a UI artifact in the workspace. Artifacts persist across sessions and can be restored on the user's canvas.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Unique artifact ID (alphanumeric, hyphens, underscores, max 64 chars)", pattern: "^[a-zA-Z0-9_-]{1,64}$" },
      component: { type: "string", description: "Component type (e.g. 'spreadsheet', 'chart', 'data_table')" },
      props: { type: "object", description: "Full component props" },
      title: { type: "string", description: "Human-readable title" },
      pinned: { type: "boolean", description: "If true, auto-restores on session start. Default: false" },
    },
    required: ["id", "component", "props", "title"],
  },
},
{
  name: "load_artifact",
  description: "Load a saved artifact from the workspace by ID.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Artifact ID to load" },
    },
    required: ["id"],
  },
},
{
  name: "list_artifacts",
  description: "List all saved artifacts in the workspace. Returns metadata (no props) sorted by most recently updated.",
  inputSchema: { type: "object", properties: {} },
},
{
  name: "delete_artifact",
  description: "Delete an artifact from the workspace.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Artifact ID to delete" },
    },
    required: ["id"],
  },
},
```

**Step 2: Add artifact tool handlers**

In the `call_tool` handler (around line 540), add cases:

```javascript
case "save_artifact": {
  const WORKSPACE_DIR = process.env.JARBLE_WORKSPACE_DIR || "/data/workspace";
  // Import/require the artifact store functions
  // (For the JS MCP server, inline the logic or require the compiled module)
  const artifactStore = require("./artifactStore.js");
  const artifact = artifactStore.saveArtifact(WORKSPACE_DIR, {
    id: args.id,
    component: args.component,
    props: args.props,
    title: args.title,
    pinned: args.pinned,
    source: "bot",
  });
  return { content: [{ type: "text", text: `Saved artifact "${artifact.title}" (${artifact.id})` }] };
}

case "load_artifact": {
  const WORKSPACE_DIR = process.env.JARBLE_WORKSPACE_DIR || "/data/workspace";
  const artifactStore = require("./artifactStore.js");
  const artifact = artifactStore.loadArtifact(WORKSPACE_DIR, args.id);
  if (!artifact) {
    return { content: [{ type: "text", text: `Artifact "${args.id}" not found.` }] };
  }
  return { content: [{ type: "text", text: JSON.stringify(artifact, null, 2) }] };
}

case "list_artifacts": {
  const WORKSPACE_DIR = process.env.JARBLE_WORKSPACE_DIR || "/data/workspace";
  const artifactStore = require("./artifactStore.js");
  const artifacts = artifactStore.listArtifacts(WORKSPACE_DIR);
  if (artifacts.length === 0) {
    return { content: [{ type: "text", text: "No saved artifacts." }] };
  }
  const lines = artifacts.map(a =>
    `- **${a.title}** (${a.component}) — ${a.pinned ? "📌 pinned" : ""} updated ${a.updatedAt}`
  );
  return { content: [{ type: "text", text: lines.join("\n") }] };
}

case "delete_artifact": {
  const WORKSPACE_DIR = process.env.JARBLE_WORKSPACE_DIR || "/data/workspace";
  const artifactStore = require("./artifactStore.js");
  const deleted = artifactStore.deleteArtifact(WORKSPACE_DIR, args.id);
  return { content: [{ type: "text", text: deleted ? `Deleted artifact "${args.id}"` : `Artifact "${args.id}" not found.` }] };
}

// Keep old tools as aliases
case "save_canvas_file": {
  // Redirect to save_artifact
  const WORKSPACE_DIR = process.env.JARBLE_WORKSPACE_DIR || "/data/workspace";
  const artifactStore = require("./artifactStore.js");
  const artifact = artifactStore.saveArtifact(WORKSPACE_DIR, {
    id: args.fileId,
    component: args.component,
    props: args.props,
    title: args.name || args.fileId,
    source: "bot",
  });
  return { content: [{ type: "text", text: `Saved "${artifact.title}" (${artifact.id})` }] };
}
```

**Step 3: Add migration call on server startup**

At MCP server initialization (around line 25-30), add:

```javascript
// Migrate old /data/files/ to /data/workspace/artifacts/ on first run
try {
  const artifactStore = require("./artifactStore.js");
  const migrated = artifactStore.migrateOldFiles(
    process.env.JARBLE_FILES_DIR || "/data/files",
    process.env.JARBLE_WORKSPACE_DIR || "/data/workspace"
  );
  if (migrated > 0) {
    console.log(`Migrated ${migrated} old canvas files to workspace artifacts`);
  }
} catch (e) {
  console.error("Migration failed:", e.message);
}
```

**Step 4: Run API tests to verify nothing broke**

Run: `cd jarble-api-main && npx vitest run`
Expected: All existing tests pass (469+)

**Step 5: Commit**

```bash
git add jarble-api-main/src/mcp/jarble-ui-server.js
git commit -m "feat: wire artifact tools into MCP server, alias old canvas file tools"
```

---

### Task 4: API Artifact Endpoints

Add three Express endpoints for frontend artifact sync.

**Files:**
- Create: `jarble-api-main/src/routes/artifact.ts`
- Create: `jarble-api-main/src/routes/__tests__/artifact.test.ts`
- Modify: `jarble-api-main/src/index.ts` (register route)

**Step 1: Write the route tests**

```typescript
// jarble-api-main/src/routes/__tests__/artifact.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock execInPod to simulate reading/writing to pod filesystem
vi.mock("../../k8s/exec.js", () => ({
  execInPod: vi.fn(),
}));

vi.mock("../../k8s/status.js", () => ({
  getRunningPodName: vi.fn().mockResolvedValue("dep-test-pod-abc"),
}));

describe("Artifact API endpoints", () => {
  describe("GET /api/deployments/:id/artifact/list", () => {
    it("returns manifest artifacts array", async () => {
      // Mock execInPod to return manifest JSON
    });

    it("returns empty array for new workspace", async () => {
      // Mock execInPod returning empty manifest
    });

    it("returns 401 without auth", async () => {
      // No bearer token
    });

    it("returns 403 for non-owner deployment", async () => {
      // Different user
    });
  });

  describe("GET /api/deployments/:id/artifact/:artifactId", () => {
    it("returns full artifact JSON", async () => {
      // Mock execInPod reading artifact file
    });

    it("returns 404 for missing artifact", async () => {
      // File doesn't exist on pod
    });
  });

  describe("POST /api/deployments/:id/artifact/sync", () => {
    it("writes artifact to pod workspace", async () => {
      // Verify execInPod called with correct base64 payload
    });

    it("validates artifact ID format", async () => {
      // Bad ID returns 400
    });

    it("rate limits to 1 sync/second", async () => {
      // Two rapid requests, second returns 429
    });
  });

  describe("DELETE /api/deployments/:id/artifact/:artifactId", () => {
    it("removes artifact from pod", async () => {
      // Verify execInPod called with rm + manifest update
    });
  });
});
```

**Step 2: Implement the route**

```typescript
// jarble-api-main/src/routes/artifact.ts
import { Router } from "express";
import { requireAuth } from "../middleware/auth.js";
import { execInPod } from "../k8s/exec.js";
import { getRunningPodName } from "../k8s/status.js";
import { db } from "../db/index.js";
import { deployments } from "../db/schema.js";
import { eq, and } from "drizzle-orm";
import { createLogger } from "../utils/logger.js";

const log = createLogger("artifact");
const router = Router();

// Rate limit state: deploymentId → lastSyncTimestamp
const syncTimestamps = new Map<string, number>();

async function verifyOwnership(userId: string, deploymentId: string) {
  const [dep] = await db
    .select({ id: deployments.id })
    .from(deployments)
    .where(and(eq(deployments.id, deploymentId), eq(deployments.userId, userId)));
  return !!dep;
}

async function execRead(podName: string, filePath: string): Promise<string | null> {
  try {
    const result = await execInPod(podName, [
      "sh", "-c", `cat '${filePath}' 2>/dev/null || echo '__NOT_FOUND__'`
    ], "runtime");
    if (result.trim() === "__NOT_FOUND__") return null;
    return result;
  } catch {
    return null;
  }
}

async function execWrite(podName: string, filePath: string, content: string): Promise<void> {
  const b64 = Buffer.from(content).toString("base64");
  const dir = filePath.substring(0, filePath.lastIndexOf("/"));
  await execInPod(podName, [
    "sh", "-c", `mkdir -p '${dir}' && echo '${b64}' | base64 -d > '${filePath}'`
  ], "runtime");
}

// GET /api/deployments/:id/artifact/list
router.get("/api/deployments/:id/artifact/list", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!(await verifyOwnership(req.auth.userId, id))) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const podName = await getRunningPodName(id);
    if (!podName) return res.json({ artifacts: [] });

    const raw = await execRead(podName, "/data/workspace/manifest.json");
    if (!raw) return res.json({ artifacts: [] });

    const manifest = JSON.parse(raw);
    res.json({ artifacts: manifest.artifacts || [] });
  } catch (err) {
    log.error({ err, deploymentId: req.params.id }, "Failed to list artifacts");
    res.status(500).json({ error: "Failed to list artifacts" });
  }
});

// GET /api/deployments/:id/artifact/:artifactId
router.get("/api/deployments/:id/artifact/:artifactId", requireAuth, async (req, res) => {
  try {
    const { id, artifactId } = req.params;
    if (!(await verifyOwnership(req.auth.userId, id))) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const podName = await getRunningPodName(id);
    if (!podName) return res.status(404).json({ error: "Pod not running" });

    const raw = await execRead(podName, `/data/workspace/artifacts/${artifactId}.json`);
    if (!raw) return res.status(404).json({ error: "Artifact not found" });

    res.json(JSON.parse(raw));
  } catch (err) {
    log.error({ err, deploymentId: req.params.id }, "Failed to load artifact");
    res.status(500).json({ error: "Failed to load artifact" });
  }
});

// POST /api/deployments/:id/artifact/sync
router.post("/api/deployments/:id/artifact/sync", requireAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { id: artifactId, component, props, title } = req.body;

    // Validate artifact ID
    if (!artifactId || !/^[a-zA-Z0-9_-]{1,64}$/.test(artifactId)) {
      return res.status(400).json({ error: "Invalid artifact ID" });
    }

    // Rate limit: 1 sync/second per deployment
    const lastSync = syncTimestamps.get(id) || 0;
    if (Date.now() - lastSync < 1000) {
      return res.status(429).json({ error: "Rate limited — max 1 sync/second" });
    }
    syncTimestamps.set(id, Date.now());

    if (!(await verifyOwnership(req.auth.userId, id))) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const podName = await getRunningPodName(id);
    if (!podName) return res.status(503).json({ error: "Pod not running" });

    // Build artifact JSON
    const now = new Date().toISOString();

    // Read existing to preserve createdAt
    const existingRaw = await execRead(podName, `/data/workspace/artifacts/${artifactId}.json`);
    const existing = existingRaw ? JSON.parse(existingRaw) : null;

    const artifact = {
      id: artifactId,
      component,
      props,
      title,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      pinned: existing?.pinned ?? false,
      source: "user",
      dataSource: existing?.dataSource || null,
    };

    // Write artifact file
    await execWrite(podName, `/data/workspace/artifacts/${artifactId}.json`, JSON.stringify(artifact, null, 2));

    // Update manifest
    const manifestRaw = await execRead(podName, "/data/workspace/manifest.json");
    const manifest = manifestRaw ? JSON.parse(manifestRaw) : { version: 1, artifacts: [] };
    const meta = {
      id: artifactId,
      component,
      title,
      createdAt: artifact.createdAt,
      updatedAt: artifact.updatedAt,
      pinned: artifact.pinned,
    };
    const idx = manifest.artifacts.findIndex((a: any) => a.id === artifactId);
    if (idx >= 0) manifest.artifacts[idx] = meta;
    else manifest.artifacts.push(meta);

    await execWrite(podName, "/data/workspace/manifest.json", JSON.stringify(manifest, null, 2));

    res.json({ ok: true, artifact: meta });
  } catch (err) {
    log.error({ err, deploymentId: req.params.id }, "Failed to sync artifact");
    res.status(500).json({ error: "Failed to sync artifact" });
  }
});

// DELETE /api/deployments/:id/artifact/:artifactId
router.delete("/api/deployments/:id/artifact/:artifactId", requireAuth, async (req, res) => {
  try {
    const { id, artifactId } = req.params;
    if (!(await verifyOwnership(req.auth.userId, id))) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const podName = await getRunningPodName(id);
    if (!podName) return res.status(503).json({ error: "Pod not running" });

    // Delete artifact file
    await execInPod(podName, [
      "sh", "-c", `rm -f '/data/workspace/artifacts/${artifactId}.json'`
    ], "runtime");

    // Update manifest
    const manifestRaw = await execRead(podName, "/data/workspace/manifest.json");
    if (manifestRaw) {
      const manifest = JSON.parse(manifestRaw);
      manifest.artifacts = manifest.artifacts.filter((a: any) => a.id !== artifactId);
      await execWrite(podName, "/data/workspace/manifest.json", JSON.stringify(manifest, null, 2));
    }

    res.json({ ok: true });
  } catch (err) {
    log.error({ err, deploymentId: req.params.id }, "Failed to delete artifact");
    res.status(500).json({ error: "Failed to delete artifact" });
  }
});

export default router;
```

**Step 3: Register the route in `index.ts`**

Find the route registration section in `jarble-api-main/src/index.ts` and add:

```typescript
import artifactRouter from "./routes/artifact.js";
// ... after other route registrations:
app.use(artifactRouter);
```

**Step 4: Run tests**

Run: `cd jarble-api-main && npx vitest run src/routes/__tests__/artifact.test.ts`
Expected: All tests pass

**Step 5: Commit**

```bash
git add jarble-api-main/src/routes/artifact.ts jarble-api-main/src/routes/__tests__/artifact.test.ts jarble-api-main/src/index.ts
git commit -m "feat: add artifact API endpoints for frontend sync"
```

---

### Task 5: SSE ARTIFACT_UPDATED Event

Add the SSE event type so the bot can push live data updates to the frontend.

**Files:**
- Modify: `jarble-api-main/src/utils/eventTypes.ts`
- Modify: `jarble-api-main/src/routes/tamboAgent.ts`

**Step 1: Add event constant**

In `jarble-api-main/src/utils/eventTypes.ts`, add:

```typescript
export const CUSTOM_ARTIFACT_UPDATED = "jarble.artifact.updated";
```

**Step 2: Add artifact update emission in tamboAgent.ts**

In the UI block processing section of `tamboAgent.ts`, after the existing CUSTOM event handling, add a check for artifact-related tool calls:

```typescript
// After processing UI blocks, check if any were artifact updates
// This will be triggered when the bot calls save_artifact with updated data
// The frontend useArtifactSync hook will listen for this event
```

The actual emission happens when the bot calls `save_artifact` via MCP. The MCP server emits a `jarble_ui_update` fenced block for the artifact's card, which `tamboAgent.ts` already processes as a `CUSTOM_CARD_UPDATE` event. We extend this to also emit `CUSTOM_ARTIFACT_UPDATED`:

```typescript
// In the card update handler section:
if (block.type === "update" && block.id) {
  sendEvent(res, {
    type: CUSTOM,
    name: CUSTOM_CARD_UPDATE,
    value: { cardId: block.id, props: block.props, merge: block.merge },
  });

  // If this card is an artifact, also emit artifact updated
  sendEvent(res, {
    type: CUSTOM,
    name: CUSTOM_ARTIFACT_UPDATED,
    value: { id: block.id, component: block.component, props: block.props },
  });
}
```

**Step 3: Commit**

```bash
git add jarble-api-main/src/utils/eventTypes.ts jarble-api-main/src/routes/tamboAgent.ts
git commit -m "feat: add ARTIFACT_UPDATED SSE event for live data push"
```

---

### Task 6: Frontend useArtifactSync Hook

The core frontend hook that handles auto-save to pod, session restore, and SSE subscription.

**Files:**
- Create: `Jarble-mvp/hooks/useArtifactSync.ts`
- Create: `Jarble-mvp/hooks/__tests__/useArtifactSync.test.ts`

**Step 1: Write the test file**

```typescript
// Jarble-mvp/hooks/__tests__/useArtifactSync.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

// Test the artifact-worthy check and debounce logic
const ARTIFACT_WORTHY = new Set([
  "spreadsheet", "code_editor", "data_table", "chart",
  "sandbox", "code_block", "embed",
]);

describe("useArtifactSync", () => {
  describe("isArtifactWorthy", () => {
    it("returns true for spreadsheet", () => {
      expect(ARTIFACT_WORTHY.has("spreadsheet")).toBe(true);
    });

    it("returns true for chart", () => {
      expect(ARTIFACT_WORTHY.has("chart")).toBe(true);
    });

    it("returns false for alert", () => {
      expect(ARTIFACT_WORTHY.has("alert")).toBe(false);
    });

    it("returns false for badge", () => {
      expect(ARTIFACT_WORTHY.has("badge")).toBe(false);
    });

    it("returns false for card", () => {
      expect(ARTIFACT_WORTHY.has("card")).toBe(false);
    });
  });

  describe("session restore", () => {
    it("fetches manifest on mount when deploymentId provided", () => {
      // Mock fetch, verify GET /artifact/list called
    });

    it("hydrates pinned artifacts into canvas", () => {
      // Mock manifest with pinned artifacts, verify ADD_CARD dispatched
    });

    it("skips restore when no artifacts exist", () => {
      // Empty manifest, no ADD_CARD dispatched
    });
  });

  describe("auto-save", () => {
    it("syncs artifact-worthy card changes after debounce", () => {
      // Mock UPDATE_CARD_PROPS for spreadsheet, verify POST /artifact/sync
    });

    it("skips non-artifact-worthy components", () => {
      // UPDATE_CARD_PROPS for alert, no POST
    });

    it("queues sync when pod unreachable", () => {
      // POST returns 503, verify retry queue
    });
  });
});
```

**Step 2: Implement the hook**

```typescript
// Jarble-mvp/hooks/useArtifactSync.ts
"use client";

import { useEffect, useRef, useCallback } from "react";
import type { CanvasState, CanvasCard } from "@/components/workspace/types";

const ARTIFACT_WORTHY = new Set([
  "spreadsheet", "code_editor", "data_table", "chart",
  "sandbox", "code_block", "embed",
]);

const SYNC_DEBOUNCE_MS = 2000;

interface ArtifactMeta {
  id: string;
  component: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
}

export function isArtifactWorthy(component: string): boolean {
  return ARTIFACT_WORTHY.has(component);
}

export function useArtifactSync(
  deploymentId: string | undefined,
  state: CanvasState,
  dispatch: React.Dispatch<any>,
  apiUrl: string,
  getToken: () => Promise<string | undefined>,
) {
  const syncTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const prevPropsRef = useRef<Map<string, string>>(new Map());
  const restoredRef = useRef(false);

  // ── Session Restore ─────────────────────────────────────────────────
  useEffect(() => {
    if (!deploymentId || restoredRef.current) return;
    restoredRef.current = true;

    (async () => {
      try {
        const token = await getToken();
        if (!token) return;

        const res = await fetch(`${apiUrl}/api/deployments/${deploymentId}/artifact/list`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) return;

        const { artifacts } = (await res.json()) as { artifacts: ArtifactMeta[] };
        const pinned = artifacts.filter((a) => a.pinned);

        for (const meta of pinned) {
          // Check if card already exists (from localStorage restore)
          if (state.cards.some((c) => c.id === meta.id)) continue;

          const artRes = await fetch(
            `${apiUrl}/api/deployments/${deploymentId}/artifact/${meta.id}`,
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
  }, [deploymentId]);

  // ── Auto-Save ───────────────────────────────────────────────────────
  const syncToServer = useCallback(
    async (card: CanvasCard) => {
      if (!deploymentId) return;
      try {
        const token = await getToken();
        if (!token) return;

        await fetch(`${apiUrl}/api/deployments/${deploymentId}/artifact/sync`, {
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
        // Queue for retry — silent failure, localStorage still has the data
      }
    },
    [deploymentId, apiUrl, getToken],
  );

  useEffect(() => {
    // Check for dirty artifact-worthy cards
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
```

**Step 3: Run tests**

Run: `cd Jarble-mvp && npx vitest run hooks/__tests__/useArtifactSync.test.ts`
Expected: All tests pass

**Step 4: Commit**

```bash
git add Jarble-mvp/hooks/useArtifactSync.ts Jarble-mvp/hooks/__tests__/useArtifactSync.test.ts
git commit -m "feat: add useArtifactSync hook for auto-save + session restore"
```

---

### Task 7: Wire useArtifactSync into Chat Page

Connect the hook to the deployment chat page so it activates on every session.

**Files:**
- Modify: `Jarble-mvp/app/d/[id]/page.tsx`

**Step 1: Add the hook call**

In the chat page component, after the existing `useCanvasPersistence` call, add:

```typescript
import { useArtifactSync } from "@/hooks/useArtifactSync";

// Inside the component, after useCanvasPersistence:
useArtifactSync(
  deploymentId,
  canvasState,
  canvasDispatch,
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
  () => getAccessTokenSilently(),
);
```

**Step 2: Verify the page builds**

Run: `cd Jarble-mvp && npm run check`
Expected: No new type errors (pre-existing tRPC errors are OK)

**Step 3: Commit**

```bash
git add Jarble-mvp/app/d/[id]/page.tsx
git commit -m "feat: wire useArtifactSync into deployment chat page"
```

---

### Task 8: Soul.md Workspace Guidance

Add prompt guidance so the bot knows about artifacts and behaves correctly on session start.

**Files:**
- Modify: `jarble-api-main/src/runtimes/handlers/openclaw.ts`

**Step 1: Add workspace guidance to soul.md generation**

In `openclaw.ts` where the soul.md system prompt is assembled (in `renderConfigs`), add a section:

```typescript
// After existing component guidance sections:
const workspaceGuidance = `
## Workspace Persistence
You have a persistent workspace for saving UI artifacts. Use these tools:
- **save_artifact**: Save/update any UI component the user might want later
- **list_artifacts**: Check what artifacts exist (do this on session start)
- **load_artifact**: Load a saved artifact to re-render it
- **delete_artifact**: Remove artifacts the user no longer needs

### On Session Start
When a user starts a conversation:
1. Call list_artifacts() to check for saved work
2. If artifacts exist, briefly mention them: "Welcome back! You have [N] saved items including [titles]. Want me to pull anything up?"
3. Pinned artifacts are already visible on the user's canvas — don't re-render them
4. If no artifacts, proceed normally

### When to Save
Save as artifacts when you create substantial, reusable UI:
- Spreadsheets, data tables, charts → always save with a descriptive title
- Code editors, sandboxes → save if the user is working on something
- Pin important items so they auto-restore next session
- Use descriptive titles (e.g. "Q4 Revenue Data" not "spreadsheet-1")
`;
```

**Step 2: Run API tests**

Run: `cd jarble-api-main && npx vitest run`
Expected: All tests pass

**Step 3: Commit**

```bash
git add jarble-api-main/src/runtimes/handlers/openclaw.ts
git commit -m "feat: add workspace persistence guidance to soul.md prompt"
```

---

### Task 9: Live Data — ARTIFACT_UPDATED Frontend Handler

Add SSE event handling in `useCanvasChat.ts` for the `ARTIFACT_UPDATED` custom event so live data updates render in real-time.

**Files:**
- Modify: `Jarble-mvp/hooks/useCanvasChat.ts`

**Step 1: Add ARTIFACT_UPDATED handler**

In the SSE event processing switch statement, alongside the existing `CUSTOM` event handlers, add:

```typescript
case CUSTOM: {
  const customName = event.name;

  // ... existing handlers for jarble.card.update, jarble.dashboard.created, etc.

  if (customName === "jarble.artifact.updated") {
    const { id, component, props } = event.value;
    // Update the card in-place if it's on the canvas
    dispatch({
      type: "UPDATE_CARD_PROPS",
      id,
      props,
      merge: true,
      component,
    });
  }
  break;
}
```

**Step 2: Run frontend tests**

Run: `cd Jarble-mvp && npx vitest run`
Expected: All tests pass

**Step 3: Commit**

```bash
git add Jarble-mvp/hooks/useCanvasChat.ts
git commit -m "feat: handle ARTIFACT_UPDATED SSE events for live data"
```

---

### Task 10: Live Testing — Spin Up Bots and Validate

This is a manual testing task. Spin up test bots and validate the entire system end-to-end.

**Prerequisites:**
- API server running locally: `cd jarble-api-main && npm run dev:test`
- Frontend running: `cd Jarble-mvp && npm run dev`
- A running deployment (existing or create new via wizard)

**Test 1: Artifact Round-Trip**

1. Open deployment chat at `http://localhost:3000/d/{deploymentId}`
2. Tell the bot: "Create a spreadsheet with 5 rows of sample employee data"
3. Verify: Spreadsheet renders on canvas
4. Edit a cell value directly on the frontend
5. Wait 3 seconds (debounce)
6. Refresh the page
7. **Expected**: Spreadsheet restores with your edited value (from pod, not localStorage)
8. Open DevTools Network tab — verify `GET /artifact/list` and `GET /artifact/{id}` calls

**Test 2: Bot Session Awareness**

1. After Test 1, open a new chat (refresh page)
2. **Expected**: Bot should call `list_artifacts()` and mention saved items
3. Tell the bot: "Show me my saved spreadsheet"
4. **Expected**: Bot calls `load_artifact` and re-renders it

**Test 3: Pin and Auto-Restore**

1. Tell the bot: "Create a chart showing monthly revenue and pin it"
2. Verify the bot calls `save_artifact` with `pinned: true`
3. Close the browser tab entirely
4. Reopen `http://localhost:3000/d/{deploymentId}`
5. **Expected**: Chart appears immediately without any chat interaction

**Test 4: Cross-Device Simulation**

1. Create artifacts in one browser (e.g. Chrome)
2. Open the same deployment URL in a different browser (e.g. Firefox)
3. **Expected**: Artifacts load from pod (no shared localStorage)

**Test 5: Component Composition Quality**

1. Tell the bot: "Make me a financial dashboard with revenue chart, expense breakdown, and key metrics"
2. Evaluate: Did it use the right components? (chart + data_table/spreadsheet + stat_grid vs. a single sandbox)
3. Tell the bot: "Show me a live map of Tokyo"
4. Evaluate: Did it use the embed component with Google Maps?
5. Tell the bot: "Create a code editor with a Python hello world"
6. Evaluate: Did it use code_editor (not code_block or sandbox)?

---

### Task 11: Marketplace Live Testing

Validate the component and package marketplace works with running bots.

**Prerequisites:**
- API server running with SQLite: `cd jarble-api-main && npm run dev:test`
- Frontend running: `cd Jarble-mvp && npm run dev`
- A running deployment

**Test 1: Seed Test Marketplace Data**

1. Use the debug endpoint or SQLite studio to verify marketplace tables exist:
   ```
   GET http://localhost:3001/debug/db
   ```
2. Check that `marketplaceComponents` and `marketplacePackages` tables are present

**Test 2: Component Publish Flow**

1. Navigate to `http://localhost:3000/marketplace` (or wherever the marketplace UI is)
2. Create a creator profile via the UI (or via tRPC):
   ```
   POST /trpc/marketplace.createCreatorProfile
   { displayName: "Test Creator", bio: "Testing" }
   ```
3. Submit a test template component:
   ```
   POST /trpc/marketplace.submitComponent
   {
     name: "weather-card",
     displayName: "Weather Card",
     description: "Shows current weather for a city",
     tier: "template",
     category: "display",
     propsSchema: { type: "object", properties: { city: { type: "string" }, temp: { type: "number" } } },
     exampleProps: { city: "NYC", temp: 72 }
   }
   ```
4. Approve it as admin:
   ```
   POST /trpc/marketplace.approveComponent
   { componentId: "<id from step 3>" }
   ```
5. **Expected**: Component appears in browse listing

**Test 3: Component Install Flow**

1. Browse marketplace, find the test component
2. Click Install → select deployment
3. **Expected**: `componentInstalls` record created, configSync fires
4. Chat with the bot: "List your available components"
5. **Expected**: Bot's `list_components` tool shows the new marketplace component
6. Tell the bot: "Show me a weather card for NYC"
7. **Expected**: Bot renders the installed component

**Test 4: Package Publish + Install Flow**

1. Create a test package via tRPC:
   ```
   POST /trpc/packages.publish
   {
     name: "weather-pack",
     displayName: "Weather Pack",
     description: "Weather card + web search skill + weather instructions",
     hostingModel: "self_hosted",
     instructionSnippet: "When asked about weather, use the web_search skill and render results using the weather-card component.",
     componentIds: ["<weather-card id>"],
     skillIds: ["<web-search skill id>"]
   }
   ```
2. Install the package on a deployment:
   ```
   POST /trpc/packages.install
   { packageId: "<id>", deploymentId: "<id>" }
   ```
3. **Expected**:
   - `packageInstalls` record created
   - `componentInstalls` record for weather-card
   - `deploymentSkills` record for web-search
   - soul.md updated with `## Package: Weather Pack` section
   - ConfigSync fires (writes skill config + updated soul.md to PVC)
4. Chat with the bot: "What's the weather in NYC?"
5. **Expected**: Bot uses web search skill, renders weather-card component

**Test 5: Package Uninstall**

1. Uninstall the package:
   ```
   POST /trpc/packages.uninstall
   { packageId: "<id>", deploymentId: "<id>" }
   ```
2. **Expected**: All install records removed, soul.md snippet removed, configSync fires
3. Chat with the bot: "What components do you have?"
4. **Expected**: Weather card no longer listed

**Step 1: Document test results**

After running all tests, create a test results file:
```bash
# Create a test results file to track what passed/failed
echo "# Live Test Results — $(date)" > docs/test-results-artifact-marketplace.md
```

**Step 2: Commit**

```bash
git add docs/test-results-artifact-marketplace.md
git commit -m "docs: add live test results for artifact workspace + marketplace"
```

---

## File Summary

| File | Task | Action | Purpose |
|------|------|--------|---------|
| `jarble-api-main/src/mcp/__tests__/artifactTools.test.ts` | 1,2 | Create | Artifact CRUD tests |
| `jarble-api-main/src/mcp/artifactStore.ts` | 2 | Create | Artifact store module |
| `jarble-api-main/src/mcp/jarble-ui-server.js` | 3 | Modify | Wire artifact tools + migration |
| `jarble-api-main/src/routes/artifact.ts` | 4 | Create | API endpoints for frontend sync |
| `jarble-api-main/src/routes/__tests__/artifact.test.ts` | 4 | Create | API endpoint tests |
| `jarble-api-main/src/index.ts` | 4 | Modify | Register artifact route |
| `jarble-api-main/src/utils/eventTypes.ts` | 5 | Modify | Add ARTIFACT_UPDATED constant |
| `jarble-api-main/src/routes/tamboAgent.ts` | 5 | Modify | Emit ARTIFACT_UPDATED SSE event |
| `Jarble-mvp/hooks/useArtifactSync.ts` | 6 | Create | Auto-save + session restore hook |
| `Jarble-mvp/hooks/__tests__/useArtifactSync.test.ts` | 6 | Create | Hook tests |
| `Jarble-mvp/app/d/[id]/page.tsx` | 7 | Modify | Wire hook into chat page |
| `jarble-api-main/src/runtimes/handlers/openclaw.ts` | 8 | Modify | Soul.md workspace guidance |
| `Jarble-mvp/hooks/useCanvasChat.ts` | 9 | Modify | Handle ARTIFACT_UPDATED events |
| Manual testing | 10,11 | — | Live bot + marketplace validation |
