/**
 * ═══════════════════════════════════════════════════════════════════════
 * Lifecycle Jobs — Durable async queue for deploy/start/restart work
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Replaces the fire-and-forget IIFEs that previously ran inside tRPC
 * mutations in `deployment.ts`. Each row in `lifecycle_jobs` represents a
 * durable unit of K8s lifecycle work — "create", "start", or "restart" —
 * that must survive API pod restarts (crashes, Kubero rollouts, OOM kills).
 *
 * Enqueue path (from the router):
 *   await enqueueLifecycleJob(db, { deploymentId, userId, type: "create", payload });
 *
 * Worker path (from the API startup, once per pod):
 *   startLifecycleWorker();           // setInterval polling
 *   → processLifecycleJobs(db);       // one sweep
 *     → claimNextJob() via SELECT ... FOR UPDATE SKIP LOCKED
 *     → runJob(job) dispatched on `type`
 *     → retry with exponential backoff up to maxAttempts
 *
 * Under the in-memory SQLite test mirror we degrade gracefully: advisory
 * locks and FOR UPDATE SKIP LOCKED are Postgres-only, so the test path
 * simply runs a plain SELECT — fine for single-process unit tests.
 */
import { nanoid } from "nanoid";
import { and, eq, lte, sql } from "drizzle-orm";
import { db as defaultDb, tables, dbDate } from "../db/index.js";
import { createModuleLogger } from "../utils/logger.js";
import {
  createDeployment,
  startDeployment,
  restartDeployment,
  getDeploymentPodStatus,
} from "../k8s/index.js";
import type { ManagedBy, IsolationLevel } from "../k8s/constants.js";
import { syncConfigsToPvc } from "./configSync.js";
import { safeFireAndForget } from "../utils/safeAsync.js";

const log = createModuleLogger("lifecycleJobs");

export type LifecycleJobType = "create" | "start" | "restart";
export type LifecycleJobStatus = "pending" | "running" | "completed" | "failed";

/** Payload persisted for `create` jobs — precomputed in the router. */
export interface CreateJobPayload {
  type: "create";
  managedBy: ManagedBy;
  name: string;
  runtime: string;
  image?: string;
  cpuLimit?: string;
  memoryMb?: number;
  storageMb?: number;
  initialConfigs: Array<{ path: string; content: string }>;
  extraSecretEntries: Record<string, string>;
  gatewayToken: string;
  isolationLevel: IsolationLevel;
  nodeName?: string;
  deploymentType: string;
}

export interface StartJobPayload {
  type: "start";
  managedBy: ManagedBy;
  wasFailedState: boolean;
  deployConfig: {
    name: string;
    runtime: string;
    image?: string;
    cpuLimit?: string;
    memoryMb?: number;
    storageMb?: number;
  };
}

export interface RestartJobPayload {
  type: "restart";
  managedBy: ManagedBy;
  deployConfig: {
    name: string;
    runtime: string;
    image?: string;
    cpuLimit?: string;
    memoryMb?: number;
    storageMb?: number;
  };
}

export type LifecycleJobPayload = CreateJobPayload | StartJobPayload | RestartJobPayload;

interface EnqueueInput {
  deploymentId: string;
  userId: string;
  type: LifecycleJobType;
  payload: LifecycleJobPayload;
  maxAttempts?: number;
}

function isTestEnv(): boolean {
  return Boolean(process.env.VITEST) || process.env.NODE_ENV === "test";
}

/** Serialize a payload for storage (jsonb on pg, text on sqlite). */
function serializePayload(payload: LifecycleJobPayload): any {
  if (isTestEnv()) {
    return JSON.stringify(payload);
  }
  return payload;
}

function deserializePayload(raw: any): LifecycleJobPayload {
  if (!raw) throw new Error("lifecycle_jobs row is missing payload");
  if (typeof raw === "string") return JSON.parse(raw) as LifecycleJobPayload;
  return raw as LifecycleJobPayload;
}

/** Insert a new lifecycle job with status=pending, runAfter=now. */
export async function enqueueLifecycleJob(
  dbInstance: any,
  input: EnqueueInput,
): Promise<string> {
  const id = nanoid();
  const now = dbDate();
  await dbInstance.insert(tables.lifecycleJobs).values({
    id,
    deploymentId: input.deploymentId,
    userId: input.userId,
    type: input.type,
    status: "pending",
    attempts: 0,
    maxAttempts: input.maxAttempts ?? 5,
    payload: serializePayload(input.payload),
    createdAt: now,
    updatedAt: now,
    runAfter: now,
  });
  log.info(
    { jobId: id, deploymentId: input.deploymentId, type: input.type },
    "enqueued lifecycle job",
  );
  return id;
}

/**
 * Atomically claim up to `limit` pending jobs whose runAfter <= NOW().
 * Uses SELECT ... FOR UPDATE SKIP LOCKED on Postgres so multiple worker
 * processes can coordinate. On SQLite falls back to a plain select + update.
 */
async function claimJobs(dbInstance: any, limit: number): Promise<any[]> {
  const now = dbDate();
  if (isTestEnv()) {
    // SQLite path: single-process, no row locking needed.
    const rows = await dbInstance.query.lifecycleJobs.findMany({
      where: and(
        eq(tables.lifecycleJobs.status, "pending"),
        lte(tables.lifecycleJobs.runAfter, now as any),
      ),
      limit,
    });
    if (rows.length === 0) return [];
    const ids = rows.map((r: any) => r.id);
    await dbInstance.update(tables.lifecycleJobs)
      .set({ status: "running", updatedAt: now })
      .where(sql`id IN (${sql.join(ids.map((i: string) => sql`${i}`), sql`, `)})`);
    return rows.map((r: any) => ({ ...r, status: "running" }));
  }

  // Postgres path: SELECT ... FOR UPDATE SKIP LOCKED inside a transaction.
  return (dbInstance as any).transaction(async (tx: any) => {
    const { rows } = await tx.execute(sql`
      SELECT id FROM lifecycle_jobs
      WHERE status = 'pending' AND run_after <= NOW()
      ORDER BY run_after ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `);
    if (!rows || rows.length === 0) return [];
    const ids = rows.map((r: any) => r.id);
    await tx.execute(sql`
      UPDATE lifecycle_jobs
      SET status = 'running', updated_at = NOW()
      WHERE id = ANY(${ids})
    `);
    // Re-read full rows via Drizzle for typed access.
    const full = await tx.query.lifecycleJobs.findMany({
      where: sql`id = ANY(${ids})`,
    });
    return full;
  });
}

/** Compute retry delay in ms — exponential backoff capped at 5 min. */
function backoffMs(attempts: number): number {
  const base = 5000; // 5s
  const delay = Math.min(5 * 60 * 1000, base * 2 ** Math.max(0, attempts - 1));
  return delay;
}

async function markCompleted(dbInstance: any, jobId: string): Promise<void> {
  const now = dbDate();
  await dbInstance.update(tables.lifecycleJobs)
    .set({ status: "completed", updatedAt: now, completedAt: now })
    .where(eq(tables.lifecycleJobs.id, jobId));
}

async function markFailedOrRetry(
  dbInstance: any,
  job: any,
  err: unknown,
): Promise<void> {
  const attempts = (job.attempts ?? 0) + 1;
  const maxAttempts = job.maxAttempts ?? 5;
  const message = err instanceof Error ? err.message : String(err);
  const now = new Date();
  if (attempts >= maxAttempts) {
    await dbInstance.update(tables.lifecycleJobs)
      .set({
        status: "failed",
        attempts,
        lastError: message,
        updatedAt: dbDate(now),
        completedAt: dbDate(now),
      })
      .where(eq(tables.lifecycleJobs.id, job.id));
    log.error(
      { jobId: job.id, deploymentId: job.deploymentId, attempts, err: message },
      "lifecycle job exhausted retries",
    );
    return;
  }
  const nextRun = new Date(now.getTime() + backoffMs(attempts));
  await dbInstance.update(tables.lifecycleJobs)
    .set({
      status: "pending",
      attempts,
      lastError: message,
      updatedAt: dbDate(now),
      runAfter: dbDate(nextRun),
    })
    .where(eq(tables.lifecycleJobs.id, job.id));
  log.warn(
    { jobId: job.id, deploymentId: job.deploymentId, attempts, nextRun, err: message },
    "lifecycle job will retry",
  );
}

/**
 * Run the readiness-poll state machine for a single job. Updates the
 * deployment status row on success/failure. Throws on transient failure so
 * the caller retries with backoff.
 */
async function runJob(dbInstance: any, job: any): Promise<void> {
  const payload = deserializePayload(job.payload);
  const { deployments } = tables;
  const deploymentId = job.deploymentId as string;
  const userId = job.userId as string;

  if (payload.type === "create") {
    // Persist managedBy on the DB row before creating K8s resources
    await dbInstance.update(deployments)
      .set({ managedBy: payload.managedBy })
      .where(eq(deployments.id, deploymentId));

    await createDeployment(deploymentId, userId, {
      name: payload.name,
      runtime: payload.runtime,
      image: payload.image,
      cpuLimit: payload.cpuLimit,
      memoryMb: payload.memoryMb,
      storageMb: payload.storageMb,
      initialConfigs: payload.initialConfigs,
      extraSecretEntries: payload.extraSecretEntries,
      gatewayToken: payload.gatewayToken,
      isolationLevel: payload.isolationLevel,
      nodeName: payload.nodeName,
      deploymentType: payload.deploymentType,
    } as any, payload.managedBy);
    log.info({ deploymentId }, "K8s createDeployment returned, polling for readiness...");

    // Poll for pod readiness - 150 attempts × 2s = 300s (5 min) timeout
    await new Promise((r) => setTimeout(r, 1500));
    let ready = false;
    for (let i = 0; i < 150; i++) {
      const podStatus = await getDeploymentPodStatus(deploymentId, payload.managedBy);
      if (podStatus.status === "running") { ready = true; break; }
      if (podStatus.status === "failed") break;
      await new Promise((r) => setTimeout(r, 2000));
    }

    await dbInstance.update(deployments)
      .set({ status: ready ? "running" : "failed", ...(ready ? { error: null } : { error: "Pod did not become ready" }) })
      .where(and(
        eq(deployments.id, deploymentId),
        // Only update if still in a transitional state.
        sql`${deployments.status} IN ('creating','provisioning_node','waiting_volume','pulling_image','initializing')`,
      ));
    log.info({ deploymentId, ready }, "create job completed");
    return;
  }

  if (payload.type === "start") {
    if (payload.wasFailedState) {
      await restartDeployment(deploymentId, payload.managedBy, userId, payload.deployConfig as any);
    } else {
      await startDeployment(deploymentId, payload.managedBy, userId, payload.deployConfig as any);
    }

    await new Promise((r) => setTimeout(r, 1500));
    let ready = false;
    for (let i = 0; i < 90; i++) {
      const podStatus = await getDeploymentPodStatus(deploymentId, payload.managedBy);
      if (podStatus.status === "running") { ready = true; break; }
      if (podStatus.status === "failed") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    await dbInstance.update(deployments)
      .set({ status: ready ? "running" : "failed" })
      .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "creating")));
    if (ready) {
      safeFireAndForget(syncConfigsToPvc(deploymentId), {
        operation: "syncConfigsToPvc",
        deploymentId,
      });
    }
    log.info({ deploymentId, ready }, "start job completed");
    return;
  }

  if (payload.type === "restart") {
    await restartDeployment(deploymentId, payload.managedBy, userId, payload.deployConfig as any);
    await new Promise((r) => setTimeout(r, 1500));
    let ready = false;
    for (let i = 0; i < 90; i++) {
      const podStatus = await getDeploymentPodStatus(deploymentId, payload.managedBy);
      if (podStatus.status === "running") { ready = true; break; }
      if (podStatus.status === "failed") break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    await dbInstance.update(deployments)
      .set({ status: ready ? "running" : "failed" })
      .where(and(eq(deployments.id, deploymentId), eq(deployments.status, "restarting")));
    // JAR-126: mirror the start path — push the latest configs to the fresh
    // pod's PVC so restart actually surfaces config changes made since the
    // pod last booted (system prompt edits, MCP server updates, etc.).
    if (ready) {
      safeFireAndForget(syncConfigsToPvc(deploymentId), {
        operation: "syncConfigsToPvc",
        deploymentId,
      });
    }
    log.info({ deploymentId, ready }, "restart job completed");
    return;
  }

  throw new Error(`Unknown lifecycle job type: ${(payload as any).type}`);
}

/** Process one sweep of pending jobs. Returns count processed. */
export async function processLifecycleJobs(
  dbInstance: any = defaultDb,
  batchSize: number = 5,
): Promise<number> {
  let claimed: any[] = [];
  try {
    claimed = await claimJobs(dbInstance, batchSize);
  } catch (err) {
    log.error({ err }, "failed to claim lifecycle jobs");
    return 0;
  }
  if (claimed.length === 0) return 0;

  for (const job of claimed) {
    try {
      await runJob(dbInstance, job);
      await markCompleted(dbInstance, job.id);
    } catch (err) {
      // Transient failure — requeue on status=pending to retry, or mark failed
      // when attempts exhausted. Also reset the deployment row if stuck.
      try {
        await markFailedOrRetry(dbInstance, job, err);
      } catch (markErr) {
        log.error({ jobId: job.id, markErr }, "failed to update lifecycle job after error");
      }
    }
  }
  return claimed.length;
}

/** Start the background worker. Polls every `intervalMs` (default 5s). */
let workerTimer: NodeJS.Timeout | null = null;

export function startLifecycleWorker(
  intervalMs: number = 5000,
  dbInstance: any = defaultDb,
): NodeJS.Timeout {
  if (workerTimer) return workerTimer;
  log.info({ intervalMs }, "lifecycle job worker starting");
  let running = false;
  workerTimer = setInterval(async () => {
    if (running) return; // skip overlap
    running = true;
    try {
      await processLifecycleJobs(dbInstance);
    } catch (err) {
      log.error({ err }, "lifecycle worker sweep failed");
    } finally {
      running = false;
    }
  }, intervalMs);
  return workerTimer;
}

export function stopLifecycleWorker(): void {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}
