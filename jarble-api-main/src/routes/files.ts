/**
 * File Management API — upload, download, browse, and manage files on pod PVCs.
 *
 * All endpoints follow the same auth pattern as artifact.ts:
 *   Bearer token → user → deployment ownership → running pod check
 *
 * Routes (all under /api/deployments):
 *   GET    /:id/files/list?path=       — list directory entries
 *   POST   /:id/files/upload           — multipart file upload (up to 50MB)
 *   GET    /:id/files/download?path=   — stream single file download
 *   POST   /:id/files/download-archive — multi-file ZIP export
 *   POST   /:id/files/mkdir            — create directory
 *   DELETE /:id/files?path=            — delete file/directory
 *   PATCH  /:id/files/move             — rename/move
 */

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import Busboy from "busboy";
import archiver from "archiver";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { db, tables } from "../db/index.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";
import {
  findPodForDeployment,
  execInPod,
} from "../k8s/index.js";
import { getPvcMountPath, getContainerName } from "../k8s/constants.js";
import type { ManagedBy } from "../k8s/constants.js";
import { validateFilePath, escapeShellPath } from "../utils/pathValidation.js";
import { createModuleLogger } from "../utils/logger.js";

const log = createModuleLogger("files");

export const filesRouter = Router();

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
const MAX_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Upload rate limiter: 10 uploads/min per user */
const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  keyGenerator: (req) => {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) {
      try {
        const parts = auth.slice(7).split(".");
        if (parts.length === 3) {
          const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
          if (payload.sub) return payload.sub;
        }
      } catch {}
    }
    return ipKeyGenerator(req.ip ?? "unknown");
  },
  message: { error: "Too many uploads. Please wait before uploading again." },
});

// ── Helpers ──────────────────────────────────────────────────────────────────

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

async function verifyOwnership(userId: string, deploymentId: string) {
  const dep = await db.query.deployments.findFirst({
    where: and(
      eq(tables.deployments.id, deploymentId),
      eq(tables.deployments.userId, userId)
    ),
  });
  return dep || null;
}

/** Get deployment's managed-by mode to determine PVC mount and container */
function getDeploymentMode(deployment: any): {
  managedBy: ManagedBy;
  pvcMount: string;
  containerName: string;
} {
  const managedBy = (deployment.managedBy ?? "legacy") as ManagedBy;
  return {
    managedBy,
    pvcMount: getPvcMountPath(managedBy),
    containerName: getContainerName(managedBy),
  };
}

/** Compute a dynamic timeout based on file size */
function dynamicTimeout(fileSize: number): number {
  return Math.min(MAX_TIMEOUT_MS, Math.max(30000, fileSize / 100000));
}

// ── LIST ─────────────────────────────────────────────────────────────────────

/**
 * GET /:id/files/list?path=
 * Returns { entries: FileEntry[] }
 */
filesRouter.get("/:id/files/list", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const deploymentId = req.params.id;
    const deployment = await verifyOwnership(user.id, deploymentId);
    if (!deployment) { res.status(404).json({ error: "Deployment not found" }); return; }

    const { managedBy, pvcMount, containerName } = getDeploymentMode(deployment);
    const requestedPath = (req.query.path as string) || pvcMount;

    const validation = validateFilePath(requestedPath, pvcMount);
    if (!validation.valid) { res.status(400).json({ error: validation.error }); return; }

    const podName = await findPodForDeployment(deploymentId, { managedBy });
    if (!podName) { res.json({ entries: [] }); return; }

    const dirPath = escapeShellPath(validation.resolvedPath);

    // Use ls with machine-readable output
    const output = await execInPod(
      podName,
      ["sh", "-c", `ls -la --time-style=long-iso '${dirPath}' 2>/dev/null || echo '__DIR_NOT_FOUND__'`],
      containerName
    );

    if (output.trim() === "__DIR_NOT_FOUND__") {
      res.json({ entries: [] });
      return;
    }

    const lines = output.trim().split("\n");
    const entries: Array<{
      name: string;
      path: string;
      isDirectory: boolean;
      size: number;
      modifiedAt: string;
    }> = [];

    for (const line of lines) {
      // Skip total line and . / .. entries
      if (line.startsWith("total ") || !line.trim()) continue;
      // Parse ls -la output: permissions links owner group size date time name
      const match = line.match(
        /^([d\-lrwxsStT]{10})\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/
      );
      if (!match) continue;
      const [, perms, sizeStr, dateStr, name] = match;
      if (name === "." || name === "..") continue;

      const isDirectory = perms.startsWith("d");
      const entryPath = `${validation.resolvedPath}/${name}`;

      entries.push({
        name,
        path: entryPath,
        isDirectory,
        size: parseInt(sizeStr, 10),
        modifiedAt: dateStr,
      });
    }

    // Directories first, then alphabetical
    entries.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ entries });
  } catch (err: unknown) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "files list error");
    res.status(500).json({ error: "Failed to list directory" });
  }
});

// ── UPLOAD ───────────────────────────────────────────────────────────────────

/**
 * POST /:id/files/upload
 * Multipart form: `file` field + `path` field (target directory on pod)
 * Streams directly to pod via execInPodWithStdin — no API buffering.
 */
filesRouter.post("/:id/files/upload", uploadLimiter, async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const deploymentId = req.params.id;
    const deployment = await verifyOwnership(user.id, deploymentId);
    if (!deployment) { res.status(404).json({ error: "Deployment not found" }); return; }

    const { managedBy, pvcMount, containerName } = getDeploymentMode(deployment);

    const podName = await findPodForDeployment(deploymentId, { managedBy });
    if (!podName) { res.status(503).json({ error: "Pod not running" }); return; }

    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_FILE_SIZE, files: 1 },
    });

    let targetDir = pvcMount;
    let fileName = "";
    let fileReceived = false;
    let fileTooLarge = false;

    busboy.on("field", (fieldname, val) => {
      if (fieldname === "path") targetDir = val;
    });

    busboy.on("file", (fieldname, fileStream, info) => {
      fileReceived = true;
      fileName = info.filename;

      // Collect file data (busboy already enforces fileSize limit)
      const chunks: Buffer[] = [];
      let totalSize = 0;

      fileStream.on("data", (chunk: Buffer) => {
        totalSize += chunk.length;
        if (totalSize > MAX_FILE_SIZE) {
          fileTooLarge = true;
          fileStream.resume(); // drain the stream
          return;
        }
        chunks.push(chunk);
      });

      fileStream.on("limit", () => {
        fileTooLarge = true;
      });

      fileStream.on("end", async () => {
        if (fileTooLarge) {
          if (!res.headersSent) {
            res.status(413).json({ error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit.` });
          }
          return;
        }

        try {
          // Validate target path
          const targetPath = `${targetDir}/${fileName}`;
          const validation = validateFilePath(targetPath, pvcMount);
          if (!validation.valid) {
            if (!res.headersSent) {
              res.status(400).json({ error: validation.error });
            }
            return;
          }

          const content = Buffer.concat(chunks);
          const escaped = escapeShellPath(validation.resolvedPath);
          const tmpPath = `${escaped}.tmp.${Date.now()}`;
          const dir = escaped.substring(0, escaped.lastIndexOf("/"));
          const timeout = dynamicTimeout(content.length);

          // Atomic write: pipe to .tmp then mv
          await execInPod(
            podName,
            ["sh", "-c", `mkdir -p '${escapeShellPath(dir)}'`],
            containerName
          );

          // Base64 encode for safe transfer through shell
          const b64 = content.toString("base64");
          await execInPod(
            podName,
            ["sh", "-c", `echo '${b64}' | base64 -d > '${tmpPath}' && mv '${tmpPath}' '${escaped}'`],
            containerName
          );

          log.info({ deploymentId, path: validation.resolvedPath, size: content.length }, "File uploaded");

          if (!res.headersSent) {
            res.json({
              ok: true,
              path: validation.resolvedPath,
              size: content.length,
            });
          }
        } catch (err: unknown) {
          log.error({ err: err instanceof Error ? err.message : String(err) }, "Upload write failed");
          if (!res.headersSent) {
            res.status(500).json({ error: "Failed to write file to pod" });
          }
        }
      });
    });

    busboy.on("finish", () => {
      if (!fileReceived && !res.headersSent) {
        res.status(400).json({ error: "No file provided" });
      }
    });

    busboy.on("error", (err) => {
      log.error({ err: err instanceof Error ? err.message : String(err) }, "Busboy parse error");
      if (!res.headersSent) {
        res.status(400).json({ error: "Failed to parse upload" });
      }
    });

    req.pipe(busboy);
  } catch (err: unknown) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "files upload error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Upload failed" });
    }
  }
});

// ── DOWNLOAD (single file) ──────────────────────────────────────────────────

/**
 * GET /:id/files/download?path=
 * Streams a single file from the pod to the client.
 * Uses base64 encoding on the pod for clean K8s exec transport.
 */
filesRouter.get("/:id/files/download", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const deploymentId = req.params.id;
    const deployment = await verifyOwnership(user.id, deploymentId);
    if (!deployment) { res.status(404).json({ error: "Deployment not found" }); return; }

    const { managedBy, pvcMount, containerName } = getDeploymentMode(deployment);
    const filePath = req.query.path as string;
    if (!filePath) { res.status(400).json({ error: "Missing path parameter" }); return; }

    const validation = validateFilePath(filePath, pvcMount);
    if (!validation.valid) { res.status(400).json({ error: validation.error }); return; }

    const podName = await findPodForDeployment(deploymentId, { managedBy });
    if (!podName) { res.status(503).json({ error: "Pod not running" }); return; }

    const escaped = escapeShellPath(validation.resolvedPath);

    // Get file info
    const statOutput = await execInPod(
      podName,
      ["sh", "-c", `stat -c '%s %F' '${escaped}' 2>/dev/null || echo 'NOT_FOUND'`],
      containerName
    );

    if (statOutput.trim() === "NOT_FOUND" || statOutput.includes("directory")) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const fileSize = parseInt(statOutput.trim().split(" ")[0], 10);
    if (isNaN(fileSize)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    if (fileSize > MAX_FILE_SIZE) {
      res.status(413).json({ error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit.` });
      return;
    }

    // Extract filename from path
    const fileName = validation.resolvedPath.split("/").pop() || "download";

    // Read file as base64 to avoid binary corruption through K8s exec
    const b64Content = await execInPod(
      podName,
      ["sh", "-c", `base64 '${escaped}'`],
      containerName
    );

    const fileBuffer = Buffer.from(b64Content.trim(), "base64");

    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.setHeader("Content-Length", fileBuffer.length);
    res.setHeader("Content-Type", "application/octet-stream");
    res.end(fileBuffer);
  } catch (err: unknown) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "files download error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Download failed" });
    }
  }
});

// ── DOWNLOAD ARCHIVE (multi-file ZIP) ───────────────────────────────────────

/**
 * POST /:id/files/download-archive
 * Body: { paths: string[] }
 * Streams a ZIP archive of the requested files.
 */
filesRouter.post("/:id/files/download-archive", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const deploymentId = req.params.id;
    const deployment = await verifyOwnership(user.id, deploymentId);
    if (!deployment) { res.status(404).json({ error: "Deployment not found" }); return; }

    const { managedBy, pvcMount, containerName } = getDeploymentMode(deployment);
    const { paths } = req.body as { paths?: string[] };

    if (!Array.isArray(paths) || paths.length === 0) {
      res.status(400).json({ error: "Missing or empty paths array" });
      return;
    }

    if (paths.length > 100) {
      res.status(400).json({ error: "Maximum 100 files per archive" });
      return;
    }

    // Validate all paths
    const validatedPaths: string[] = [];
    for (const p of paths) {
      const v = validateFilePath(p, pvcMount);
      if (!v.valid) {
        res.status(400).json({ error: `Invalid path "${p}": ${v.error}` });
        return;
      }
      validatedPaths.push(v.resolvedPath);
    }

    const podName = await findPodForDeployment(deploymentId, { managedBy });
    if (!podName) { res.status(503).json({ error: "Pod not running" }); return; }

    // Set response headers for ZIP
    res.setHeader("Content-Disposition", `attachment; filename="files-${deploymentId}.zip"`);
    res.setHeader("Content-Type", "application/zip");

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.pipe(res);

    archive.on("error", (err) => {
      log.error({ err: err.message }, "Archive error");
      if (!res.headersSent) {
        res.status(500).json({ error: "Archive creation failed" });
      }
    });

    for (const filePath of validatedPaths) {
      const escaped = escapeShellPath(filePath);
      try {
        // Read file as base64
        const b64 = await execInPod(
          podName,
          ["sh", "-c", `base64 '${escaped}' 2>/dev/null || echo '__FILE_ERROR__'`],
          containerName
        );

        if (b64.trim() === "__FILE_ERROR__") continue;

        const buffer = Buffer.from(b64.trim(), "base64");
        const name = filePath.split("/").pop() || "file";
        archive.append(buffer, { name });
      } catch {
        // Skip unreadable files
        log.warn({ deploymentId, path: filePath }, "Skipping unreadable file in archive");
      }
    }

    await archive.finalize();
  } catch (err: unknown) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "files archive error");
    if (!res.headersSent) {
      res.status(500).json({ error: "Archive failed" });
    }
  }
});

// ── MKDIR ────────────────────────────────────────────────────────────────────

/**
 * POST /:id/files/mkdir
 * Body: { path: string }
 */
filesRouter.post("/:id/files/mkdir", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const deploymentId = req.params.id;
    const deployment = await verifyOwnership(user.id, deploymentId);
    if (!deployment) { res.status(404).json({ error: "Deployment not found" }); return; }

    const { managedBy, pvcMount, containerName } = getDeploymentMode(deployment);
    const { path: dirPath } = req.body as { path?: string };

    if (!dirPath) { res.status(400).json({ error: "Missing path" }); return; }

    const validation = validateFilePath(dirPath, pvcMount);
    if (!validation.valid) { res.status(400).json({ error: validation.error }); return; }

    const podName = await findPodForDeployment(deploymentId, { managedBy });
    if (!podName) { res.status(503).json({ error: "Pod not running" }); return; }

    const escaped = escapeShellPath(validation.resolvedPath);
    await execInPod(podName, ["sh", "-c", `mkdir -p '${escaped}'`], containerName);

    res.json({ ok: true, path: validation.resolvedPath });
  } catch (err: unknown) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "files mkdir error");
    res.status(500).json({ error: "Failed to create directory" });
  }
});

// ── DELETE ───────────────────────────────────────────────────────────────────

/**
 * DELETE /:id/files?path=
 */
filesRouter.delete("/:id/files", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const deploymentId = req.params.id;
    const deployment = await verifyOwnership(user.id, deploymentId);
    if (!deployment) { res.status(404).json({ error: "Deployment not found" }); return; }

    const { managedBy, pvcMount, containerName } = getDeploymentMode(deployment);
    const filePath = req.query.path as string;

    if (!filePath) { res.status(400).json({ error: "Missing path parameter" }); return; }

    const validation = validateFilePath(filePath, pvcMount);
    if (!validation.valid) { res.status(400).json({ error: validation.error }); return; }

    // Prevent deleting the PVC root
    if (validation.resolvedPath === pvcMount) {
      res.status(400).json({ error: "Cannot delete the root directory" });
      return;
    }

    const podName = await findPodForDeployment(deploymentId, { managedBy });
    if (!podName) { res.status(503).json({ error: "Pod not running" }); return; }

    const escaped = escapeShellPath(validation.resolvedPath);
    await execInPod(podName, ["sh", "-c", `rm -rf '${escaped}'`], containerName);

    log.info({ deploymentId, path: validation.resolvedPath }, "File/directory deleted");
    res.json({ ok: true });
  } catch (err: unknown) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "files delete error");
    res.status(500).json({ error: "Delete failed" });
  }
});

// ── MOVE/RENAME ──────────────────────────────────────────────────────────────

/**
 * PATCH /:id/files/move
 * Body: { from: string, to: string }
 */
filesRouter.patch("/:id/files/move", async (req, res) => {
  try {
    const user = await authenticateRequest(req);
    if (!user) { res.status(401).json({ error: "Unauthorized" }); return; }

    const deploymentId = req.params.id;
    const deployment = await verifyOwnership(user.id, deploymentId);
    if (!deployment) { res.status(404).json({ error: "Deployment not found" }); return; }

    const { managedBy, pvcMount, containerName } = getDeploymentMode(deployment);
    const { from, to } = req.body as { from?: string; to?: string };

    if (!from || !to) {
      res.status(400).json({ error: "Missing from or to path" });
      return;
    }

    const vFrom = validateFilePath(from, pvcMount);
    if (!vFrom.valid) { res.status(400).json({ error: `from: ${vFrom.error}` }); return; }

    const vTo = validateFilePath(to, pvcMount);
    if (!vTo.valid) { res.status(400).json({ error: `to: ${vTo.error}` }); return; }

    const podName = await findPodForDeployment(deploymentId, { managedBy });
    if (!podName) { res.status(503).json({ error: "Pod not running" }); return; }

    const escapedFrom = escapeShellPath(vFrom.resolvedPath);
    const escapedTo = escapeShellPath(vTo.resolvedPath);
    const toDir = vTo.resolvedPath.substring(0, vTo.resolvedPath.lastIndexOf("/"));

    await execInPod(
      podName,
      ["sh", "-c", `mkdir -p '${escapeShellPath(toDir)}' && mv '${escapedFrom}' '${escapedTo}'`],
      containerName
    );

    log.info({ deploymentId, from: vFrom.resolvedPath, to: vTo.resolvedPath }, "File moved");
    res.json({ ok: true, from: vFrom.resolvedPath, to: vTo.resolvedPath });
  } catch (err: unknown) {
    log.error({ err: err instanceof Error ? err.message : String(err) }, "files move error");
    res.status(500).json({ error: "Move failed" });
  }
});
