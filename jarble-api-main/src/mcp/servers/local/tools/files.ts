/**
 * Pod-local filesystem tools.
 *
 * These are the bot-facing read/write primitives for the PVC. All paths are
 * validated through `shared/paths.ts:assertSafePvcPath` which:
 *   - rejects paths outside the pod's PVC mount
 *   - rejects `..` traversal
 *   - rejects writes to the protected-paths list (configSync-managed files,
 *     .initialized, runtime/, etc.)
 *
 * Unlike the legacy API-side tools under `mcp/tools/*.ts` these use direct
 * `fs/promises` calls — they run INSIDE the pod, so `execInPod` is neither
 * available nor needed.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { registerTool } from "../register.js";
import { ensureDir, jsonResult, textResult } from "../_helpers.js";
import { resolveManagedBy } from "../_helpers.js";
import { assertSafePvcPath, getPvcMount } from "../../../shared/paths.js";
import { InvalidArgsError, NotFoundError } from "../../../shared/errors.js";

const MAX_CONTENT_SIZE = 1_048_576; // 1 MB

function checkPath(p: string): void {
  if (!p || typeof p !== "string") {
    throw new InvalidArgsError("Missing or invalid 'path'.");
  }
  assertSafePvcPath(p, resolveManagedBy());
}

// ── write_file ────────────────────────────────────────────────────────

registerTool({
  name: "write_file",
  description:
    "Write content to a file on the deployment PVC. Path must be under the PVC mount. Protected paths (configSync-managed files, runtime/, .initialized, etc.) are rejected.",
  server: "local",
  inputSchema: z.object({
    path: z.string(),
    content: z.string(),
    encoding: z.enum(["utf8", "base64"]).optional(),
  }),
  handler: async (args) => {
    checkPath(args.path);

    const encoding = args.encoding ?? "utf8";
    const buf =
      encoding === "base64"
        ? Buffer.from(args.content, "base64")
        : Buffer.from(args.content, "utf8");

    if (buf.byteLength > MAX_CONTENT_SIZE) {
      return textResult(
        `Content is too large (${buf.byteLength} bytes). Max ${MAX_CONTENT_SIZE} bytes (1 MB).`,
        true,
      );
    }

    await ensureDir(path.dirname(args.path));
    await fs.writeFile(args.path, buf);
    return textResult(`Wrote ${buf.byteLength} bytes to ${args.path}.`);
  },
});

// ── read_file ─────────────────────────────────────────────────────────

registerTool({
  name: "read_file",
  description:
    "Read a file from the deployment PVC. Returns the file contents as a string.",
  server: "local",
  inputSchema: z.object({
    path: z.string(),
    encoding: z.enum(["utf8", "base64"]).optional(),
  }),
  handler: async (args) => {
    // Read allows anywhere under the PVC mount (even protected paths are
    // readable — assertSafePvcPath rejects writes, but we still enforce it
    // to guarantee the path is under the PVC and free of traversal).
    const mount = getPvcMount(resolveManagedBy());
    if (!args.path.startsWith(`${mount}/`) && args.path !== mount) {
      throw new InvalidArgsError(`Path must be under ${mount}/.`);
    }
    if (args.path.includes("..")) {
      throw new InvalidArgsError("Path traversal (..) is not allowed.");
    }

    try {
      const buf = await fs.readFile(args.path);
      const encoding = args.encoding ?? "utf8";
      const content = encoding === "base64" ? buf.toString("base64") : buf.toString("utf8");
      return textResult(content);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") throw new NotFoundError(`File not found: ${args.path}`);
      throw err;
    }
  },
});

// ── list_files ────────────────────────────────────────────────────────

interface ListEntry {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
}

async function walk(dir: string, recursive: boolean, out: ListEntry[]): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = (await fs.readdir(dir, { withFileTypes: true })) as Array<{
      name: string;
      isDirectory(): boolean;
      isFile(): boolean;
    }>;
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") throw new NotFoundError(`Directory not found: ${dir}`);
    throw err;
  }
  for (const e of entries) {
    const name = String(e.name);
    const full = path.join(dir, name);
    if (e.isDirectory()) {
      out.push({ name, path: full, type: "directory" });
      if (recursive) await walk(full, recursive, out);
    } else if (e.isFile()) {
      try {
        const stat = await fs.stat(full);
        out.push({ name, path: full, type: "file", size: stat.size });
      } catch {
        out.push({ name, path: full, type: "file" });
      }
    }
  }
}

registerTool({
  name: "list_files",
  description:
    "List files and directories under a path on the deployment PVC. Pass recursive=true to walk subdirectories.",
  server: "local",
  inputSchema: z.object({
    path: z.string(),
    recursive: z.boolean().optional(),
  }),
  handler: async (args) => {
    const mount = getPvcMount(resolveManagedBy());
    if (!args.path.startsWith(`${mount}/`) && args.path !== mount) {
      throw new InvalidArgsError(`Path must be under ${mount}/.`);
    }
    if (args.path.includes("..")) {
      throw new InvalidArgsError("Path traversal (..) is not allowed.");
    }
    const out: ListEntry[] = [];
    await walk(args.path, !!args.recursive, out);
    return jsonResult({ path: args.path, entries: out });
  },
});

// ── delete_file ───────────────────────────────────────────────────────

registerTool({
  name: "delete_file",
  description:
    "Delete a file on the deployment PVC. Refuses protected paths and paths outside the PVC mount.",
  server: "local",
  inputSchema: z.object({
    path: z.string(),
  }),
  handler: async (args) => {
    checkPath(args.path);
    try {
      const stat = await fs.stat(args.path);
      if (stat.isDirectory()) {
        return textResult(
          `Refusing to delete a directory via delete_file. Use mkdir / custom tooling for directory management.`,
          true,
        );
      }
      await fs.unlink(args.path);
      return textResult(`Deleted ${args.path}.`);
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") throw new NotFoundError(`File not found: ${args.path}`);
      throw err;
    }
  },
});

// ── mkdir ─────────────────────────────────────────────────────────────

registerTool({
  name: "mkdir",
  description:
    "Create a directory on the deployment PVC. Recursive by default (creates intermediate directories).",
  server: "local",
  inputSchema: z.object({
    path: z.string(),
    recursive: z.boolean().optional(),
  }),
  handler: async (args) => {
    checkPath(args.path);
    await fs.mkdir(args.path, { recursive: args.recursive ?? true });
    return textResult(`Created directory ${args.path}.`);
  },
});
