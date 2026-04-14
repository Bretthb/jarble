/**
 * Artifact workspace tools (pod-local).
 *
 * Ported from jarble-ui-server.js (executeSaveArtifact / executeLoadArtifact /
 * executeListArtifacts / executeDeleteArtifact). State lives on the PVC at
 * {pvcMount}/workspace/ with artifacts/ subdir and a top-level manifest.json.
 *
 * Legacy `*_canvas_file` tool names are registered as aliases pointing to the
 * same handlers so the frontend canvasFiles proxy keeps working during the
 * migration.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { registerTool } from "../register.js";
import {
  ensureDir,
  jsonResult,
  pathExists,
  pvcRoot,
  readJsonOrDefault,
  textResult,
} from "../_helpers.js";
import type { McpResult } from "../../../shared/types.js";

const ARTIFACT_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const MAX_ARTIFACT_SIZE = 1_000_000; // 1 MB

function workspaceDir(): string {
  return process.env.JARBLE_WORKSPACE_DIR || path.join(pvcRoot(), "workspace");
}
function artifactsDir(): string {
  return path.join(workspaceDir(), "artifacts");
}
function manifestPath(): string {
  return path.join(workspaceDir(), "manifest.json");
}

interface ArtifactMeta {
  id: string;
  component: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
}
interface Artifact extends ArtifactMeta {
  props: Record<string, unknown>;
  source?: string;
  dataSource?: unknown;
}
interface Manifest {
  version: number;
  artifacts: ArtifactMeta[];
}

async function ensureWorkspace(): Promise<void> {
  await ensureDir(artifactsDir());
  if (!(await pathExists(manifestPath()))) {
    await fs.writeFile(
      manifestPath(),
      JSON.stringify({ version: 1, artifacts: [] }, null, 2),
      "utf8",
    );
  }
}

async function readManifest(): Promise<Manifest> {
  await ensureWorkspace();
  return readJsonOrDefault<Manifest>(manifestPath(), { version: 1, artifacts: [] });
}

async function writeManifest(manifest: Manifest): Promise<void> {
  await ensureDir(workspaceDir());
  const tmp = manifestPath() + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
  await fs.rename(tmp, manifestPath());
}

// ── Data source schema (optional live-refresh config) ─────────────────

const dataSourceSchema = z
  .object({
    type: z.enum(["file", "skill"]),
    path: z.string().optional(),
    skill: z.string().optional(),
    args: z.record(z.unknown()).optional(),
    pollInterval: z.number().min(5).max(3600).optional(),
    transform: z.string().optional(),
  })
  .refine(
    (ds) => (ds.type === "file" ? !!ds.path : true),
    { message: 'dataSource type "file" requires a "path" field' },
  )
  .refine(
    (ds) => (ds.type === "skill" ? !!ds.skill : true),
    { message: 'dataSource type "skill" requires a "skill" field' },
  );

// ── save_artifact ─────────────────────────────────────────────────────

const saveSchema = z.object({
  id: z.string().regex(ARTIFACT_ID_RE, "id must match /^[a-zA-Z0-9_-]{1,64}$/"),
  component: z.string().min(1),
  props: z.record(z.unknown()),
  title: z.string().min(1),
  pinned: z.boolean().optional(),
  dataSource: dataSourceSchema.optional(),
});

async function saveArtifact(
  args: z.infer<typeof saveSchema>,
): Promise<McpResult> {
  await ensureWorkspace();
  const now = new Date().toISOString();
  const manifest = await readManifest();
  const existingIdx = manifest.artifacts.findIndex((a) => a.id === args.id);
  const filePath = path.join(artifactsDir(), `${args.id}.json`);

  let existing: Artifact | null = null;
  if (existingIdx !== -1 && (await pathExists(filePath))) {
    existing = await readJsonOrDefault<Artifact | null>(filePath, null);
  }

  const artifact: Artifact = {
    id: args.id,
    component: args.component,
    props: args.props,
    title: args.title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    pinned: args.pinned ?? existing?.pinned ?? false,
    source: "bot",
    dataSource: args.dataSource ?? existing?.dataSource ?? null,
  };

  const serialized = JSON.stringify(artifact, null, 2);
  if (Buffer.byteLength(serialized, "utf-8") > MAX_ARTIFACT_SIZE) {
    return textResult(`Artifact "${args.id}" exceeds 1 MB limit.`, true);
  }

  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, serialized, "utf8");
  await fs.rename(tmp, filePath);

  const meta: ArtifactMeta = {
    id: artifact.id,
    component: artifact.component,
    title: artifact.title,
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
    pinned: artifact.pinned,
  };
  if (existingIdx !== -1) manifest.artifacts[existingIdx] = meta;
  else manifest.artifacts.push(meta);
  await writeManifest(manifest);

  return textResult(
    `Saved artifact "${artifact.title}" (${artifact.id}) — ${artifact.pinned ? "pinned" : "not pinned"}`,
  );
}

registerTool({
  name: "save_artifact",
  description:
    "Save or update a UI artifact in the workspace. Artifacts persist on the pod PVC across sessions. Use this instead of save_canvas_file.",
  server: "local",
  inputSchema: saveSchema,
  handler: (args) => saveArtifact(args),
});

// Legacy alias: save_canvas_file — accepts { fileId, component, props, name }
const saveCanvasFileSchema = z.object({
  fileId: z.string(),
  component: z.string(),
  props: z.record(z.unknown()),
  name: z.string().optional(),
});

registerTool({
  name: "save_canvas_file",
  description: "Legacy alias for save_artifact. Prefer save_artifact in new code.",
  server: "local",
  inputSchema: saveCanvasFileSchema,
  handler: async (args) =>
    saveArtifact({
      id: args.fileId,
      component: args.component,
      props: args.props,
      title: args.name ?? args.fileId,
    }),
});

// ── load_artifact ─────────────────────────────────────────────────────

const loadSchema = z.object({
  id: z.string().regex(ARTIFACT_ID_RE, "id must match /^[a-zA-Z0-9_-]{1,64}$/"),
});

async function loadArtifact(args: z.infer<typeof loadSchema>): Promise<McpResult> {
  await ensureWorkspace();
  // Check artifacts/ then workspace root (legacy layout).
  let filePath = path.join(artifactsDir(), `${args.id}.json`);
  if (!(await pathExists(filePath))) {
    filePath = path.join(workspaceDir(), `${args.id}.json`);
  }
  if (!(await pathExists(filePath))) {
    return textResult(`Artifact "${args.id}" not found.`, true);
  }
  const raw = await fs.readFile(filePath, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return jsonResult(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return textResult(`Failed to read artifact: ${msg}`, true);
  }
}

registerTool({
  name: "load_artifact",
  description: "Load a saved artifact from the workspace by ID.",
  server: "local",
  inputSchema: loadSchema,
  handler: (args) => loadArtifact(args),
});

registerTool({
  name: "load_canvas_file",
  description: "Legacy alias for load_artifact.",
  server: "local",
  inputSchema: z.object({ fileId: z.string() }),
  handler: async (args) => loadArtifact({ id: args.fileId }),
});

// ── list_artifacts ────────────────────────────────────────────────────

const listSchema = z.object({
  type: z.string().optional(),
  limit: z.number().int().positive().optional(),
  format: z.enum(["json", "markdown"]).optional(),
});

async function listArtifacts(args: z.infer<typeof listSchema>): Promise<McpResult> {
  const manifest = await readManifest();
  let items = [...manifest.artifacts];
  if (args.type) items = items.filter((a) => a.component === args.type);
  items.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  if (args.limit) items = items.slice(0, args.limit);

  const format = args.format ?? "markdown";

  if (items.length === 0) {
    if (format === "json") return textResult("[]");
    return textResult("No saved artifacts in workspace.");
  }

  if (format === "json") {
    const payload = items.map((a) => ({
      fileId: a.id,
      component: a.component,
      name: a.title,
      description: "",
      tags: [a.component],
      savedAt: a.updatedAt || a.createdAt || null,
      pinned: !!a.pinned,
    }));
    return textResult(JSON.stringify(payload));
  }

  const lines = [`**${items.length} artifact(s) in workspace:**`, ""];
  for (const a of items) {
    let line = `- **${a.title}** (\`${a.id}\`) - ${a.component}`;
    if (a.pinned) line += " [pinned]";
    if (a.updatedAt) line += ` _(updated ${a.updatedAt.split("T")[0]})_`;
    lines.push(line);
  }
  lines.push("", "Use `load_artifact` with an ID to recall, then `render_ui` to display.");
  return textResult(lines.join("\n"));
}

registerTool({
  name: "list_artifacts",
  description:
    "List saved artifacts in the workspace, sorted by most recently updated. Pass format='json' for machine-readable output.",
  server: "local",
  inputSchema: listSchema,
  handler: (args) => listArtifacts(args),
});

registerTool({
  name: "list_canvas_files",
  description: "Legacy alias for list_artifacts.",
  server: "local",
  inputSchema: listSchema,
  handler: (args) => listArtifacts(args),
});

// ── delete_artifact ───────────────────────────────────────────────────

const deleteSchema = z.object({
  id: z.string().regex(ARTIFACT_ID_RE, "id must match /^[a-zA-Z0-9_-]{1,64}$/"),
});

async function deleteArtifact(args: z.infer<typeof deleteSchema>): Promise<McpResult> {
  await ensureWorkspace();
  const manifest = await readManifest();
  const idx = manifest.artifacts.findIndex((a) => a.id === args.id);
  const filePath = path.join(artifactsDir(), `${args.id}.json`);
  if (await pathExists(filePath)) await fs.unlink(filePath);

  if (idx !== -1) {
    manifest.artifacts.splice(idx, 1);
    await writeManifest(manifest);
    return textResult(`Deleted artifact "${args.id}" from workspace.`);
  }
  return textResult(
    `Artifact "${args.id}" was not in the manifest (may have already been removed).`,
  );
}

registerTool({
  name: "delete_artifact",
  description: "Delete an artifact from the workspace by ID.",
  server: "local",
  inputSchema: deleteSchema,
  handler: (args) => deleteArtifact(args),
});

registerTool({
  name: "delete_canvas_file",
  description: "Legacy alias for delete_artifact.",
  server: "local",
  inputSchema: z.object({ fileId: z.string() }),
  handler: async (args) => deleteArtifact({ id: args.fileId }),
});
