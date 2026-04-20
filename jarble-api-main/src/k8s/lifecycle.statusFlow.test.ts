/**
 * Wave 4 Layer B — granular per-step deployment status enum.
 *
 * Verifies that `createDeployment` (lifecycle.ts) writes the new transitional
 * statuses (`waiting_volume`, `pulling_image`, `initializing`) to the DB in
 * the correct order during the K8s create flow, and that on failure the
 * status throws back to the caller without overwriting the row to "running".
 *
 * The K8s API surface is fully mocked. We assert the exact ORDER and SET of
 * status values written to the deployments row by snapshotting them as each
 * mock is called.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import * as sqliteSchema from "../__tests__/helpers/testSchema.sqlite.js";

// ── Mocks ────────────────────────────────────────────────────────────────────
//
// We capture the live status of the deployment row at the moment each K8s
// API call is invoked, so we can later assert the order without relying on
// flaky timing or polling.

let raw: Database.Database;
let testDb: ReturnType<typeof drizzle<typeof sqliteSchema>>;

// Records the deployment.status value at the moment a K8s mock fires.
const statusAtMock: { step: string; status: string }[] = [];

function snapshotStatus(step: string, deploymentId: string) {
  const row = raw
    .prepare("SELECT status FROM deployments WHERE id = ?")
    .get(deploymentId) as { status: string } | undefined;
  statusAtMock.push({ step, status: row?.status ?? "<missing>" });
}

// Mock db/index.js so the lifecycle's `db` import points at our test SQLite.
vi.mock("../db/index.js", async () => {
  const schema = await import("../__tests__/helpers/testSchema.sqlite.js");
  return {
    get db() {
      return testDb;
    },
    tables: schema,
    dbDate: () => new Date().toISOString(),
  };
});

// Mock the K8s client API surface used by lifecycle.ts. Each mock snapshots
// the current DB status before returning, then proceeds to the next step.
let pvcCreateImpl = async (_ns: string, _body: any) => ({});
let secretCreateImpl = async (_ns: string, _body: any) => ({});
let deploymentCreateImpl = async (_ns: string, _body: any) => ({});

vi.mock("./client.js", () => ({
  coreApi: {
    createNamespacedPersistentVolumeClaim: vi.fn((ns: string, body: any) => {
      const id = body?.metadata?.name?.replace(/^pvc-/, "") ?? "";
      snapshotStatus("pvc", id);
      return pvcCreateImpl(ns, body);
    }),
    createNamespacedSecret: vi.fn((ns: string, body: any) => {
      const id = body?.metadata?.name?.replace(/^secret-/, "") ?? "";
      snapshotStatus("secret", id);
      return secretCreateImpl(ns, body);
    }),
    deleteNamespacedPersistentVolumeClaim: vi.fn().mockResolvedValue({}),
    deleteNamespacedSecret: vi.fn().mockResolvedValue({}),
    createNamespacedService: vi.fn().mockResolvedValue({}),
    deleteNamespacedService: vi.fn().mockResolvedValue({}),
  },
  appsApi: {
    createNamespacedDeployment: vi.fn((ns: string, body: any) => {
      const id = body?.metadata?.name?.replace(/^dep-/, "") ?? "";
      snapshotStatus("deployment", id);
      return deploymentCreateImpl(ns, body);
    }),
  },
  networkingApi: {
    createNamespacedIngress: vi.fn().mockResolvedValue({}),
    deleteNamespacedIngress: vi.fn().mockResolvedValue({}),
  },
  customApi: {
    createNamespacedCustomObject: vi.fn().mockResolvedValue({}),
    deleteNamespacedCustomObject: vi.fn().mockResolvedValue({}),
    patchNamespacedCustomObject: vi.fn().mockResolvedValue({}),
    getNamespacedCustomObject: vi.fn().mockResolvedValue({}),
  },
}));

vi.mock("./status.js", () => ({
  getDeploymentPodStatus: vi.fn().mockResolvedValue({ status: "running" }),
}));

vi.mock("./configmap.js", () => ({
  createDeploymentConfigMap: vi.fn().mockResolvedValue(undefined),
  deleteDeploymentConfigMap: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./operator.js", () => ({
  createOpenClawInstance: vi.fn().mockResolvedValue(undefined),
  deleteOpenClawInstance: vi.fn().mockResolvedValue(undefined),
}));

// JAR-119 — lifecycle.ts now imports getHandlerOrNull to consult the runtime
// handler for custom probes. Avoid pulling in the real runtime registry
// (which triggers env loads) by mocking it out.
vi.mock("../runtimes/index.js", () => ({
  getHandlerOrNull: () => null,
}));

// Import AFTER vi.mock so the mocks are wired up first.
import { createDeployment } from "./lifecycle.js";

// ── Setup ────────────────────────────────────────────────────────────────────

const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    name TEXT,
    auth0_id TEXT NOT NULL UNIQUE,
    email_verified INTEGER DEFAULT 0 NOT NULL,
    role TEXT DEFAULT 'user' NOT NULL,
    stripe_customer_id TEXT,
    pending_stripe_subscription_id TEXT,
    free_deployment_used INTEGER DEFAULT 0 NOT NULL,
    free_trial_expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deployments (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL,
    description TEXT,
    runtime TEXT DEFAULT 'openclaw' NOT NULL,
    deployment_type TEXT DEFAULT 'agent' NOT NULL,
    image TEXT,
    runtime_catalog_id INTEGER,
    is_free INTEGER DEFAULT 0 NOT NULL,
    monthly_price_cents INTEGER DEFAULT 0 NOT NULL,
    free_expires_at TEXT,
    cpu_limit TEXT,
    memory_mb INTEGER,
    storage_mb INTEGER,
    llm_mode TEXT DEFAULT 'byok' NOT NULL,
    llm_provider TEXT DEFAULT 'openrouter' NOT NULL,
    llm_model TEXT,
    llm_api_key TEXT,
    llm_api_key_id TEXT,
    llm_credit_limit_dollars INTEGER,
    llm_api_key_source_deployment_id TEXT,
    system_prompt TEXT,
    stripe_subscription_id TEXT,
    cancelled_at TEXT,
    cancel_at_period_end TEXT,
    status TEXT DEFAULT 'creating' NOT NULL,
    error TEXT,
    messaging_only INTEGER DEFAULT 0 NOT NULL,
    managed_by TEXT DEFAULT 'legacy' NOT NULL,
    isolation_level TEXT DEFAULT 'standard' NOT NULL,
    is_platform INTEGER DEFAULT 0 NOT NULL,
    resource_tier TEXT,
    theme_config TEXT,
    forked_from_id TEXT,
    is_public INTEGER DEFAULT 0 NOT NULL,
    fork_count INTEGER DEFAULT 0 NOT NULL,
    featured_at TEXT,
    specialties TEXT,
    bio TEXT,
    showcase_prompts TEXT,
    org_id TEXT,
    created_at TEXT DEFAULT (datetime('now')) NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')) NOT NULL
  );
`;

const TEST_USER_ID = "user-statusflow-001";
const TEST_DEPLOYMENT_ID = "dep-statusflow-001";

beforeEach(() => {
  raw = new Database(":memory:");
  raw.pragma("journal_mode = WAL");
  raw.pragma("foreign_keys = ON");
  raw.exec(CREATE_TABLES_SQL);
  testDb = drizzle(raw, { schema: sqliteSchema });

  raw
    .prepare(
      `INSERT INTO users (id, email, name, auth0_id, email_verified)
       VALUES (?, ?, ?, ?, 1)`,
    )
    .run(TEST_USER_ID, "statusflow@jarble.ai", "Status Flow User", "auth0|statusflow-001");

  raw
    .prepare(
      `INSERT INTO deployments (id, user_id, name, status)
       VALUES (?, ?, ?, 'creating')`,
    )
    .run(TEST_DEPLOYMENT_ID, TEST_USER_ID, "Status Flow Deployment");

  statusAtMock.length = 0;
  pvcCreateImpl = async () => ({});
  secretCreateImpl = async () => ({});
  deploymentCreateImpl = async () => ({});
  vi.clearAllMocks();
});

afterEach(() => {
  raw.close();
});

function readStatus(): string {
  const row = raw
    .prepare("SELECT status FROM deployments WHERE id = ?")
    .get(TEST_DEPLOYMENT_ID) as { status: string } | undefined;
  return row?.status ?? "<missing>";
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("lifecycle.createDeployment — Wave 4 Layer B status flow", () => {
  it("walks the status through waiting_volume → pulling_image → initializing on success", async () => {
    await createDeployment(TEST_DEPLOYMENT_ID, TEST_USER_ID, {
      name: "test",
      runtime: "openclaw",
      cpuLimit: "2.0",
      memoryMb: 2048,
      storageMb: 20,
      deploymentType: "agent",
      isolationLevel: "standard",
      gatewayToken: "test-token",
    });

    // Snapshots are recorded at the moment each K8s API mock fires. Since
    // `setDeploymentStatus` is called RIGHT BEFORE each K8s call, the status
    // observed at PVC create is "waiting_volume", at Deployment create is
    // "pulling_image", and the final value after createDeployment returns
    // is "initializing".
    const byStep = Object.fromEntries(statusAtMock.map((s) => [s.step, s.status]));
    expect(byStep.pvc).toBe("waiting_volume");
    expect(byStep.deployment).toBe("pulling_image");
    // Secret create happens between PVC and Deployment apply — still in
    // the waiting_volume window since pulling_image is set just before
    // appsApi.createNamespacedDeployment.
    expect(byStep.secret).toBe("waiting_volume");

    // After createDeployment returns successfully, the row is parked at
    // "initializing" — the router's polling loop is responsible for the
    // final flip to "running".
    expect(readStatus()).toBe("initializing");
  });

  it("records the transitions in strict order (waiting_volume before pulling_image before initializing)", async () => {
    await createDeployment(TEST_DEPLOYMENT_ID, TEST_USER_ID, {
      name: "test",
      runtime: "openclaw",
      cpuLimit: "2.0",
      memoryMb: 2048,
      storageMb: 20,
      deploymentType: "agent",
      isolationLevel: "standard",
      gatewayToken: "test-token",
    });

    // Order is: PVC (waiting_volume), Secret (still waiting_volume),
    // Deployment apply (pulling_image set just before), then initializing
    // is set after the apply succeeds.
    expect(statusAtMock.map((s) => s.step)).toEqual(["pvc", "secret", "deployment"]);

    // The status enum sequence observed across the three K8s calls must be
    // monotonic: waiting_volume comes before pulling_image.
    const stages = statusAtMock.map((s) => s.status);
    const firstPullingIdx = stages.indexOf("pulling_image");
    const lastWaitingIdx = stages.lastIndexOf("waiting_volume");
    expect(lastWaitingIdx).toBeLessThan(firstPullingIdx);
  });

  it("does NOT flip to running on the failure path; throws and leaves the row in the in-progress status", async () => {
    // Simulate a kubelet image-pull failure: the K8s Deployment apply
    // throws after we've already written "pulling_image" to the DB.
    deploymentCreateImpl = async () => {
      throw new Error("ImagePullBackOff: simulated registry timeout");
    };

    await expect(
      createDeployment(TEST_DEPLOYMENT_ID, TEST_USER_ID, {
        name: "test",
        runtime: "openclaw",
        cpuLimit: "2.0",
        memoryMb: 2048,
        storageMb: 20,
        deploymentType: "agent",
        isolationLevel: "standard",
        gatewayToken: "test-token",
      }),
    ).rejects.toThrow(/ImagePullBackOff/);

    // The lifecycle file does NOT flip to "failed" itself — that's the
    // router's responsibility (createDeploymentLegacy throws and the
    // fire-and-forget block in deployment.ts catches and marks failed).
    // What matters here is that the granular per-step status was the
    // LAST thing written, so the user (and stuck monitor) can see exactly
    // which step blew up. We expect "pulling_image" because the apps API
    // mock fired AFTER we wrote pulling_image and before we would have
    // written initializing.
    expect(readStatus()).toBe("pulling_image");
  });

  it("transitions through waiting_volume → pulling_image even if the secret create is the first observed K8s call to snapshot", async () => {
    // Sanity: the very first status the test should see written by
    // lifecycle.ts is "waiting_volume", not anything stale like "creating".
    await createDeployment(TEST_DEPLOYMENT_ID, TEST_USER_ID, {
      name: "test",
      runtime: "openclaw",
      cpuLimit: "2.0",
      memoryMb: 2048,
      storageMb: 20,
      deploymentType: "agent",
      isolationLevel: "standard",
      gatewayToken: "test-token",
    });

    // The first snapshot must NOT be "creating" — that would mean lifecycle
    // skipped the waiting_volume write and the user would still see the
    // opaque status that this whole layer was meant to fix.
    expect(statusAtMock[0]?.status).not.toBe("creating");
    expect(statusAtMock[0]?.status).toBe("waiting_volume");
  });
});
