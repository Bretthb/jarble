import { Router, Request, Response } from "express";
import { nanoid } from "nanoid";
import { Readable } from "stream";
import { createModuleLogger } from "../utils/logger.js";
import {
  uploadTeamFile,
  downloadTeamFile,
  listTeamFiles,
  isTeamFilesConfigured,
  MAX_FILE_SIZE,
} from "../services/teamFileStore.js";
import { authenticatePod } from "./podApi.js";

const logger = createModuleLogger("teamFiles");

export const teamFilesRouter = Router();

// ── Guard: bail early if S3 is not configured ────────────────────────────────

teamFilesRouter.use((_req: Request, res: Response, next) => {
  if (!isTeamFilesConfigured()) {
    res.status(503).json({ error: "Team file sharing is not configured" });
    return;
  }
  next();
});

// ── Internal pod endpoints (X-Deployment-Id + X-Gateway-Token auth) ──────────

/**
 * POST /upload
 * Body: { content: string (base64), filename: string, mimeType?: string, flowId: string, sessionId: string }
 */
teamFilesRouter.post("/upload", authenticatePod, async (req: Request, res: Response) => {
  try {
    const { content, filename, mimeType, flowId, sessionId } = req.body ?? {};

    // --- Validation ---
    if (!content || typeof content !== "string") {
      res.status(400).json({ error: "Missing or invalid 'content' (base64 string required)" });
      return;
    }
    if (!filename || typeof filename !== "string") {
      res.status(400).json({ error: "Missing or invalid 'filename'" });
      return;
    }
    if (!flowId || typeof flowId !== "string") {
      res.status(400).json({ error: "Missing or invalid 'flowId'" });
      return;
    }
    if (!sessionId || typeof sessionId !== "string") {
      res.status(400).json({ error: "Missing or invalid 'sessionId'" });
      return;
    }

    // Decode base64 and check size
    let buffer: Buffer;
    try {
      buffer = Buffer.from(content, "base64");
    } catch {
      res.status(400).json({ error: "Invalid base64 content" });
      return;
    }

    if (buffer.length > MAX_FILE_SIZE) {
      res.status(413).json({
        error: `File exceeds maximum size of ${MAX_FILE_SIZE} bytes (${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB)`,
      });
      return;
    }

    if (buffer.length === 0) {
      res.status(400).json({ error: "File content is empty" });
      return;
    }

    const fileId = nanoid();
    const deploymentId = req.headers["x-deployment-id"] as string;

    const { key, size } = await uploadTeamFile({
      flowId,
      sessionId,
      fileId,
      buffer,
      filename,
      mimeType: mimeType || undefined,
      uploadedByDeploymentId: deploymentId,
    });

    logger.info("Pod uploaded team file", { fileId, filename, size, flowId, sessionId, deploymentId });

    res.status(201).json({
      fileId,
      key,
      uri: `team://${fileId}`,
      filename,
      size,
    });
  } catch (err: any) {
    logger.error("Failed to upload team file", { error: err.message });
    res.status(500).json({ error: "Failed to upload file" });
  }
});

/**
 * GET /list
 * Query: flowId, sessionId
 * Returns: { files: [{ fileId, filename, size, createdAt }] }
 *
 * Registered before /:fileId so "list" is not captured as a fileId param.
 */
teamFilesRouter.get("/list", authenticatePod, async (req: Request, res: Response) => {
  try {
    const flowId = req.query.flowId as string;
    const sessionId = req.query.sessionId as string;

    if (!flowId || !sessionId) {
      res.status(400).json({ error: "Missing 'flowId' or 'sessionId' query parameters" });
      return;
    }

    const files = await listTeamFiles(flowId, sessionId);

    res.json({
      files: files.map((f) => ({
        fileId: f.fileId,
        filename: f.filename,
        size: f.size,
        createdAt: f.lastModified.toISOString(),
      })),
    });
  } catch (err: any) {
    logger.error("Failed to list team files", { error: err.message });
    res.status(500).json({ error: "Failed to list files" });
  }
});

/**
 * GET /:fileId
 * Query: flowId, sessionId
 * Returns file content as base64 (JSON) or streams with Content-Type
 */
teamFilesRouter.get("/:fileId", authenticatePod, async (req: Request, res: Response) => {
  try {
    const { fileId } = req.params;
    const flowId = req.query.flowId as string;
    const sessionId = req.query.sessionId as string;

    if (!flowId || !sessionId) {
      res.status(400).json({ error: "Missing 'flowId' or 'sessionId' query parameters" });
      return;
    }

    // Find the file in the session's listing
    const files = await listTeamFiles(flowId, sessionId);
    const file = files.find((f) => f.fileId === fileId);

    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const { body, metadata } = await downloadTeamFile(file.key);

    // If caller accepts JSON (pod MCP tools), return base64
    const acceptsJson = req.headers.accept?.includes("application/json");

    if (acceptsJson) {
      const chunks: Buffer[] = [];
      const readable = body as NodeJS.ReadableStream;
      for await (const chunk of readable) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const fullBuffer = Buffer.concat(chunks);

      res.json({
        content: fullBuffer.toString("base64"),
        filename: metadata.filename,
        mimeType: metadata.mimeType,
        size: metadata.size,
      });
      return;
    }

    // Otherwise stream directly with Content-Type
    res.setHeader("Content-Type", metadata.mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${metadata.filename}"`);
    if (metadata.size > 0) {
      res.setHeader("Content-Length", metadata.size);
    }

    const readable = body as NodeJS.ReadableStream;
    if (readable instanceof Readable) {
      readable.pipe(res);
    } else {
      // Web ReadableStream fallback
      const reader = (body as ReadableStream).getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          res.end();
          break;
        }
        res.write(value);
      }
    }
  } catch (err: any) {
    logger.error("Failed to download team file", { error: err.message, fileId: req.params.fileId });
    res.status(500).json({ error: "Failed to download file" });
  }
});
