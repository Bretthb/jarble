/**
 * Team filesystem platform tools (S3-backed).
 *
 * Wraps `services/teamFileStore.ts` so every deployment can upload,
 * download, list, delete, and presign team files through MCP without the
 * REST round-trip.
 *
 * Storage key layout (enforced by teamFileStore): `teams/{flowId}/{sessionId}/{fileId}/{filename}`.
 * `flowId` resolves to the deployment's primary flow (or falls back to
 * the deployment ID for solo use). `sessionId` defaults to "default" —
 * pods that want per-conversation isolation can pass their own.
 */

import { z } from "zod";
import { nanoid } from "nanoid";
import { registerTool } from "../register.js";
import { jsonResult, resolvePrimaryMembership } from "../_helpers.js";
import {
  UpstreamError,
  NotFoundError,
  InvalidArgsError,
} from "../../../shared/errors.js";
import {
  uploadTeamFile,
  downloadTeamFile,
  listTeamFiles,
  presignTeamFile,
  deleteTeamFileByKey,
  isTeamFilesConfigured,
  MAX_FILE_SIZE,
} from "../../../../services/teamFileStore.js";
import type { ToolContext } from "../../../shared/types.js";

function assertConfigured() {
  if (!isTeamFilesConfigured()) {
    throw new UpstreamError(
      "Team file sharing is not configured on this Jarble instance (missing TEAM_FILES_S3_* env vars).",
    );
  }
}

async function resolveFlowAndSession(
  ctx: ToolContext,
  sessionArg: string | undefined,
): Promise<{ flowId: string; sessionId: string }> {
  const membership = await resolvePrimaryMembership(ctx);
  const flowId = membership?.flowId ?? ctx.deploymentId;
  const sessionId = sessionArg ?? "default";
  return { flowId, sessionId };
}

/** Locate a file by ID within the caller's (flow, session) scope. */
async function findFile(
  flowId: string,
  sessionId: string,
  fileId: string,
) {
  const files = await listTeamFiles(flowId, sessionId);
  const file = files.find((f) => f.fileId === fileId);
  if (!file) {
    throw new NotFoundError(
      `File "${fileId}" not found in flow "${flowId}" session "${sessionId}"`,
    );
  }
  return file;
}

// ── upload_team_file ────────────────────────────────────────────────────────

registerTool({
  name: "upload_team_file",
  description:
    "Upload a file to the team's shared S3-backed filesystem. Content is base64-encoded. Returns the new fileId and a `team://` URI teammates can reference.",
  server: "platform",
  inputSchema: z.object({
    name: z.string().min(1).max(255),
    content: z.string().min(1),
    mimeType: z.string().max(255).optional(),
    sessionId: z.string().max(255).optional(),
  }),
  handler: async (args, ctx) => {
    assertConfigured();
    const { flowId, sessionId } = await resolveFlowAndSession(ctx, args.sessionId);

    let buffer: Buffer;
    try {
      buffer = Buffer.from(args.content, "base64");
    } catch {
      throw new InvalidArgsError("`content` must be valid base64");
    }
    if (buffer.length === 0) {
      throw new InvalidArgsError("File content is empty");
    }
    if (buffer.length > MAX_FILE_SIZE) {
      throw new InvalidArgsError(
        `File exceeds maximum size of ${MAX_FILE_SIZE} bytes`,
      );
    }

    const fileId = nanoid();
    const { key, size } = await uploadTeamFile({
      flowId,
      sessionId,
      fileId,
      buffer,
      filename: args.name,
      mimeType: args.mimeType,
      uploadedByDeploymentId: ctx.deploymentId,
    });

    return jsonResult({
      fileId,
      key,
      uri: `team://${fileId}`,
      filename: args.name,
      size,
      flowId,
      sessionId,
    });
  },
});

// ── download_team_file ──────────────────────────────────────────────────────

registerTool({
  name: "download_team_file",
  description:
    "Download a team file by ID. Returns base64 content, filename, mimeType, and size. Pass the `sessionId` the file was uploaded in (defaults to 'default').",
  server: "platform",
  inputSchema: z.object({
    fileId: z.string().min(1),
    sessionId: z.string().max(255).optional(),
  }),
  handler: async (args, ctx) => {
    assertConfigured();
    const { flowId, sessionId } = await resolveFlowAndSession(ctx, args.sessionId);
    const file = await findFile(flowId, sessionId, args.fileId);

    const { body, metadata } = await downloadTeamFile(file.key);

    const chunks: Buffer[] = [];
    const readable = body as NodeJS.ReadableStream;
    for await (const chunk of readable) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
    }
    const full = Buffer.concat(chunks);

    return jsonResult({
      fileId: args.fileId,
      content: full.toString("base64"),
      filename: metadata.filename,
      mimeType: metadata.mimeType,
      size: metadata.size,
    });
  },
});

// ── list_team_files ─────────────────────────────────────────────────────────

registerTool({
  name: "list_team_files",
  description:
    "List team files accessible to this deployment. Scoped to the caller's primary flow + session. Returns id, filename, size, and lastModified for each.",
  server: "platform",
  inputSchema: z.object({
    sessionId: z.string().max(255).optional(),
    limit: z.number().int().positive().max(500).optional(),
  }),
  handler: async (args, ctx) => {
    assertConfigured();
    const { flowId, sessionId } = await resolveFlowAndSession(ctx, args.sessionId);
    const files = await listTeamFiles(flowId, sessionId);
    const limited = args.limit ? files.slice(0, args.limit) : files;
    return jsonResult({
      flowId,
      sessionId,
      count: limited.length,
      files: limited.map((f) => ({
        fileId: f.fileId,
        filename: f.filename,
        size: f.size,
        lastModified: f.lastModified.toISOString(),
      })),
    });
  },
});

// ── delete_team_file ────────────────────────────────────────────────────────

registerTool({
  name: "delete_team_file",
  description:
    "Delete a team file by ID. Caller must be on the same flow as the file. Returns `deleted: true` on success.",
  server: "platform",
  inputSchema: z.object({
    fileId: z.string().min(1),
    sessionId: z.string().max(255).optional(),
  }),
  handler: async (args, ctx) => {
    assertConfigured();
    const { flowId, sessionId } = await resolveFlowAndSession(ctx, args.sessionId);
    const file = await findFile(flowId, sessionId, args.fileId);

    await deleteTeamFileByKey(file.key);

    return jsonResult({
      deleted: true,
      fileId: args.fileId,
      filename: file.filename,
    });
  },
});

// ── get_team_file_url ───────────────────────────────────────────────────────

registerTool({
  name: "get_team_file_url",
  description:
    "Generate a short-lived signed download URL for a team file. Default expiry is 3600 seconds (1 hour), max 86400 (24h).",
  server: "platform",
  inputSchema: z.object({
    fileId: z.string().min(1),
    sessionId: z.string().max(255).optional(),
    expiresIn: z.number().int().positive().max(86400).optional(),
  }),
  handler: async (args, ctx) => {
    assertConfigured();
    const { flowId, sessionId } = await resolveFlowAndSession(ctx, args.sessionId);
    const file = await findFile(flowId, sessionId, args.fileId);
    const url = await presignTeamFile(file.key, args.expiresIn ?? 3600);
    return jsonResult({
      fileId: args.fileId,
      url,
      expiresIn: args.expiresIn ?? 3600,
      filename: file.filename,
    });
  },
});
