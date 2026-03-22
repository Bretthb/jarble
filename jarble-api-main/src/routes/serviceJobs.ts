/**
 * Service Async Jobs Route — Polling endpoint for async skill executions.
 *
 * When a skill has `callMode: "async"`, the proxy returns a 202 with
 * a job ID. The client polls this endpoint to get the result.
 *
 * Routes:
 *   GET /api/services/jobs/:jobId — Poll job status + result
 *
 * Job cleanup runs hourly, deleting expired jobs (24h TTL).
 */

import { Router } from "express";
import { eq, lt } from "drizzle-orm";
import { db, tables, dbDate } from "../db/index.js";
import { generateMarketplaceId } from "../db/schema.js";
import { createModuleLogger } from "../utils/logger.js";
import { verifyToken, getUserFromToken } from "../services/auth.js";

const log = createModuleLogger("service-jobs");

export const serviceJobsRouter = Router();

// ── Poll Job Status ────────────────────────────────────────────────────────

serviceJobsRouter.get("/jobs/:jobId", async (req, res) => {
  const { jobId } = req.params;

  try {
    // Auth check — require Bearer JWT
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;

    if (!bearerToken) {
      res.status(401).json({ error: "Unauthorized — Bearer JWT required" });
      return;
    }

    let userId: string;
    try {
      const payload = await verifyToken(bearerToken);
      const user = await getUserFromToken(payload);
      if (!user) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      userId = user.id;
    } catch {
      res.status(401).json({ error: "Invalid token" });
      return;
    }

    // Look up the job
    const jobs = await db
      .select()
      .from(tables.serviceAsyncJobs)
      .where(eq(tables.serviceAsyncJobs.id, jobId))
      .limit(1);

    if (jobs.length === 0) {
      res.status(404).json({ error: "Job not found" });
      return;
    }

    const job = jobs[0];

    // Verify the user owns the deployment
    const deployment = await db.query.deployments.findFirst({
      where: eq(tables.deployments.id, job.deploymentId),
    });

    if (!deployment || deployment.userId !== userId) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    // Return job status
    const response: Record<string, unknown> = {
      jobId: job.id,
      status: job.status,
      serviceId: job.serviceId,
      skillName: job.skillName,
      createdAt: job.createdAt,
    };

    if (job.status === "completed") {
      response.responseStatus = job.responseStatus;
      response.responseBody = job.responseBody ? JSON.parse(job.responseBody) : null;
      response.completedAt = job.completedAt;
    } else if (job.status === "failed") {
      response.errorMessage = job.errorMessage;
      response.completedAt = job.completedAt;
    }

    res.json(response);
  } catch (err) {
    log.error({ jobId, err }, "Job polling failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

// ── Job Creation Helper ───────────────────────────────────────────────────

/**
 * Create a new async job record. Returns the job ID.
 */
export async function createAsyncJob(
  deploymentId: string,
  serviceId: string,
  skillName: string,
  requestBody: string,
): Promise<string> {
  const id = generateMarketplaceId("sjb");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24h

  await db.insert(tables.serviceAsyncJobs).values({
    id,
    deploymentId,
    serviceId,
    skillName,
    status: "pending",
    requestBody,
    createdAt: dbDate(now),
    expiresAt: dbDate(expiresAt),
  } as any);

  return id;
}

/**
 * Update a job with its result (success or failure).
 */
export async function completeAsyncJob(
  jobId: string,
  result: {
    status: "completed" | "failed";
    responseBody?: string;
    responseStatus?: number;
    errorMessage?: string;
  },
): Promise<void> {
  await db
    .update(tables.serviceAsyncJobs)
    .set({
      status: result.status,
      responseBody: result.responseBody ?? null,
      responseStatus: result.responseStatus ?? null,
      errorMessage: result.errorMessage ?? null,
      completedAt: dbDate(),
    } as any)
    .where(eq(tables.serviceAsyncJobs.id, jobId));
}

// ── Job Cleanup ───────────────────────────────────────────────────────────

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start hourly cleanup of expired async jobs.
 */
export function startJobCleanup(): void {
  if (cleanupTimer) return;

  const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

  cleanupTimer = setInterval(async () => {
    try {
      await db
        .delete(tables.serviceAsyncJobs)
        .where(lt(tables.serviceAsyncJobs.expiresAt, dbDate()));
      log.debug("Async job cleanup: expired jobs removed");
    } catch (err) {
      log.error({ err }, "Async job cleanup failed");
    }
  }, CLEANUP_INTERVAL_MS);

  cleanupTimer.unref();
  log.info("Async job cleanup started (hourly)");
}

/**
 * Stop the job cleanup timer.
 */
export function stopJobCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = null;
  }
}
