import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "../utils/logger.js";

// --- Constants ---

export const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB
export const MAX_FILES_PER_SESSION = 50;

// --- Config ---

const S3_ENDPOINT = process.env.TEAM_FILES_S3_ENDPOINT;
const S3_BUCKET = process.env.TEAM_FILES_S3_BUCKET || "jarble-team-files";
const S3_ACCESS_KEY = process.env.TEAM_FILES_S3_ACCESS_KEY;
const S3_SECRET_KEY = process.env.TEAM_FILES_S3_SECRET_KEY;
const S3_REGION = process.env.TEAM_FILES_S3_REGION || "us-east-1";

// --- Singleton client ---

let _client: S3Client | null = null;

function getClient(): S3Client {
  if (!_client) {
    if (!S3_ACCESS_KEY || !S3_SECRET_KEY) {
      throw new Error(
        "Team file store is not configured: missing TEAM_FILES_S3_ACCESS_KEY or TEAM_FILES_S3_SECRET_KEY"
      );
    }
    _client = new S3Client({
      region: S3_REGION,
      ...(S3_ENDPOINT ? { endpoint: S3_ENDPOINT } : {}),
      credentials: {
        accessKeyId: S3_ACCESS_KEY,
        secretAccessKey: S3_SECRET_KEY,
      },
      forcePathStyle: true,
    });
    logger.info("Team file store S3 client initialized", {
      bucket: S3_BUCKET,
      region: S3_REGION,
      endpoint: S3_ENDPOINT || "AWS default",
    });
  }
  return _client;
}

export { _client as s3Client };

// --- Public API ---

export function isTeamFilesConfigured(): boolean {
  return Boolean(S3_ACCESS_KEY && S3_SECRET_KEY);
}

export async function uploadTeamFile(params: {
  flowId: string;
  sessionId: string;
  fileId: string;
  buffer: Buffer;
  filename: string;
  mimeType?: string;
  uploadedByDeploymentId?: string;
}): Promise<{ key: string; size: number }> {
  const { flowId, sessionId, fileId, buffer, filename, mimeType, uploadedByDeploymentId } = params;

  if (buffer.length > MAX_FILE_SIZE) {
    throw new Error(`File exceeds maximum size of ${MAX_FILE_SIZE} bytes`);
  }

  const key = `teams/${flowId}/${sessionId}/${fileId}/${filename}`;

  const metadata: Record<string, string> = {
    filename,
    mimetype: mimeType || "application/octet-stream",
  };
  if (uploadedByDeploymentId) {
    metadata["uploaded-by"] = uploadedByDeploymentId;
  }

  await getClient().send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: buffer,
      ContentType: mimeType || "application/octet-stream",
      Metadata: metadata,
    })
  );

  logger.info("Uploaded team file", { key, size: buffer.length, flowId, sessionId, fileId });

  return { key, size: buffer.length };
}

export async function downloadTeamFile(key: string): Promise<{
  body: ReadableStream | NodeJS.ReadableStream;
  metadata: { filename: string; mimeType: string; size: number };
}> {
  const response = await getClient().send(
    new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    })
  );

  if (!response.Body) {
    throw new Error(`Empty response body for key: ${key}`);
  }

  const metadata = {
    filename: response.Metadata?.filename || key.split("/").pop() || "unknown",
    mimeType: response.Metadata?.mimetype || response.ContentType || "application/octet-stream",
    size: response.ContentLength || 0,
  };

  return {
    body: response.Body as ReadableStream | NodeJS.ReadableStream,
    metadata,
  };
}

export async function presignTeamFile(key: string, expiresIn = 3600): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
  });

  return getSignedUrl(getClient(), command, { expiresIn });
}

export async function listTeamFiles(
  flowId: string,
  sessionId: string
): Promise<
  Array<{
    key: string;
    fileId: string;
    filename: string;
    size: number;
    lastModified: Date;
  }>
> {
  const prefix = `teams/${flowId}/${sessionId}/`;
  const results: Array<{
    key: string;
    fileId: string;
    filename: string;
    size: number;
    lastModified: Date;
  }> = [];

  let continuationToken: string | undefined;

  do {
    const response = await getClient().send(
      new ListObjectsV2Command({
        Bucket: S3_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      })
    );

    for (const obj of response.Contents || []) {
      if (!obj.Key || !obj.Size || !obj.LastModified) continue;

      // Key format: teams/{flowId}/{sessionId}/{fileId}/{filename}
      const parts = obj.Key.split("/");
      if (parts.length < 5) continue;

      const fileId = parts[3];
      const filename = parts.slice(4).join("/");

      results.push({
        key: obj.Key,
        fileId,
        filename,
        size: obj.Size,
        lastModified: obj.LastModified,
      });
    }

    continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
  } while (continuationToken);

  return results;
}

/** Delete a single team file by its full S3 key. */
export async function deleteTeamFileByKey(key: string): Promise<void> {
  await getClient().send(
    new DeleteObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
    })
  );
  logger.info("Deleted team file", { key });
}

export async function deleteSessionFiles(flowId: string, sessionId: string): Promise<number> {
  const files = await listTeamFiles(flowId, sessionId);

  if (files.length === 0) return 0;

  // DeleteObjects supports max 1000 keys per request
  let deleted = 0;

  for (let i = 0; i < files.length; i += 1000) {
    const batch = files.slice(i, i + 1000);

    await getClient().send(
      new DeleteObjectsCommand({
        Bucket: S3_BUCKET,
        Delete: {
          Objects: batch.map((f) => ({ Key: f.key })),
          Quiet: true,
        },
      })
    );

    deleted += batch.length;
  }

  logger.info("Deleted session files", { flowId, sessionId, count: deleted });

  return deleted;
}
