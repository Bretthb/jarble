import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Tests for subscription and storage enforcement bypass logic.
 *
 * These test the internal `checkDeploymentSubscription` and `checkDeploymentStorage`
 * functions indirectly through the exported `enforceSubscriptionStatus` and
 * `enforceStorageLimits` sweeps. We mock the DB, K8s, and Stripe layers.
 */

// ── Mocks ────────────────────────────────────────────────────────────────────

// DB mock
const mockFindMany = vi.fn();
const mockUpdate = vi.fn().mockReturnValue({
  set: vi.fn().mockReturnValue({
    where: vi.fn().mockResolvedValue(undefined),
  }),
});

vi.mock("../db/index.js", () => ({
  USE_SQLITE: false,
  db: {
    query: {
      deployments: {
        findMany: (...args: unknown[]) => mockFindMany(...args),
      },
    },
    update: (...args: unknown[]) => mockUpdate(...args),
  },
  tables: {
    deployments: { id: "id", status: "status", isFree: "isFree", isPlatform: "isPlatform" },
    users: {},
  },
}));

// K8s mock
const mockStopDeployment = vi.fn().mockResolvedValue(undefined);
const mockGetStorageUsage = vi.fn();

vi.mock("../k8s/index.js", () => ({
  stopDeployment: (...args: unknown[]) => mockStopDeployment(...args),
  getDeploymentStorageUsage: (...args: unknown[]) => mockGetStorageUsage(...args),
}));

// Stripe mock
vi.mock("./stripe.js", () => ({
  isStripeConfigured: vi.fn(() => false),
  getSubscriptionDetails: vi.fn(),
}));

// Logger mock (silence output)
vi.mock("../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// safeFireAndForget mock
vi.mock("../utils/safeAsync.js", () => ({
  safeFireAndForget: vi.fn(),
}));

// Drizzle operator mocks
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  isNotNull: vi.fn((...args: unknown[]) => args),
  isNull: vi.fn((...args: unknown[]) => args),
  lt: vi.fn((...args: unknown[]) => args),
  or: vi.fn((...args: unknown[]) => args),
}));

import { enforceSubscriptionStatus } from "./subscriptionEnforcement.js";
import { enforceStorageLimits } from "./storageEnforcement.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDep(overrides: Record<string, unknown> = {}) {
  return {
    id: "dep-test-001",
    userId: "user-001",
    isFree: true,
    isPlatform: false,
    freeExpiresAt: new Date(Date.now() + 86400000), // tomorrow
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: null,
    error: null,
    storageMb: 30,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Subscription Enforcement ─────────────────────────────────────────────────

describe("enforceSubscriptionStatus", () => {
  it("skips platform deployments (isPlatform: true) without stopping them", async () => {
    const platformDep = makeDep({
      isPlatform: true,
      isFree: false,
      stripeSubscriptionId: null,
    });
    mockFindMany.mockResolvedValue([platformDep]);

    await enforceSubscriptionStatus();

    expect(mockStopDeployment).not.toHaveBeenCalled();
    // DB update should not have been called to set error/stopped
    // (mockUpdate may be called by the sweep's query but not for stopping)
  });

  it("stops non-platform paid deployment without subscription", async () => {
    const paidNoSub = makeDep({
      isPlatform: false,
      isFree: false,
      stripeSubscriptionId: null,
    });
    mockFindMany.mockResolvedValue([paidNoSub]);

    await enforceSubscriptionStatus();

    expect(mockStopDeployment).toHaveBeenCalledWith("dep-test-001");
  });

  it("does not stop free deployment within trial period", async () => {
    const freeDep = makeDep({
      isPlatform: false,
      isFree: true,
      freeExpiresAt: new Date(Date.now() + 86400000), // tomorrow
    });
    mockFindMany.mockResolvedValue([freeDep]);

    await enforceSubscriptionStatus();

    expect(mockStopDeployment).not.toHaveBeenCalled();
  });

  it("stops free deployment with expired trial", async () => {
    const expiredDep = makeDep({
      isPlatform: false,
      isFree: true,
      freeExpiresAt: new Date(Date.now() - 86400000), // yesterday
    });
    mockFindMany.mockResolvedValue([expiredDep]);

    await enforceSubscriptionStatus();

    expect(mockStopDeployment).toHaveBeenCalledWith("dep-test-001");
  });

  it("does nothing when no running deployments exist", async () => {
    mockFindMany.mockResolvedValue([]);

    await enforceSubscriptionStatus();

    expect(mockStopDeployment).not.toHaveBeenCalled();
  });

  it("processes multiple deployments independently", async () => {
    const platformDep = makeDep({ id: "dep-platform", isPlatform: true, isFree: false, stripeSubscriptionId: null });
    const paidDep = makeDep({ id: "dep-paid", isPlatform: false, isFree: false, stripeSubscriptionId: null });
    mockFindMany.mockResolvedValue([platformDep, paidDep]);

    await enforceSubscriptionStatus();

    // Only the non-platform paid deployment without subscription should be stopped
    expect(mockStopDeployment).toHaveBeenCalledTimes(1);
    expect(mockStopDeployment).toHaveBeenCalledWith("dep-paid");
  });
});

// ── Storage Enforcement ──────────────────────────────────────────────────────

describe("enforceStorageLimits", () => {
  it("skips platform deployments (isPlatform: true) without checking storage", async () => {
    const platformDep = makeDep({ isPlatform: true });
    mockFindMany.mockResolvedValue([platformDep]);

    await enforceStorageLimits();

    // Should not even call getDeploymentStorageUsage for platform deployments
    expect(mockGetStorageUsage).not.toHaveBeenCalled();
    expect(mockStopDeployment).not.toHaveBeenCalled();
  });

  it("stops non-platform deployment that exceeds storage limit", async () => {
    const dep = makeDep({ isPlatform: false, storageMb: 30 });
    mockFindMany.mockResolvedValue([dep]);
    mockGetStorageUsage.mockResolvedValue({
      usedGb: 35,
      totalGb: 30,
    });

    await enforceStorageLimits();

    expect(mockStopDeployment).toHaveBeenCalledWith("dep-test-001");
  });

  it("does not stop non-platform deployment within storage limit", async () => {
    const dep = makeDep({ isPlatform: false, storageMb: 30 });
    mockFindMany.mockResolvedValue([dep]);
    mockGetStorageUsage.mockResolvedValue({
      usedGb: 10,
      totalGb: 30,
    });

    await enforceStorageLimits();

    expect(mockStopDeployment).not.toHaveBeenCalled();
  });

  it("clears previous storage error when usage drops below limit", async () => {
    const dep = makeDep({
      isPlatform: false,
      storageMb: 30,
      error: "Storage limit exceeded: using 31.0 GB of 30 GB allocated. Free up space and restart.",
    });
    mockFindMany.mockResolvedValue([dep]);
    mockGetStorageUsage.mockResolvedValue({
      usedGb: 15,
      totalGb: 30,
    });

    await enforceStorageLimits();

    expect(mockStopDeployment).not.toHaveBeenCalled();
    // DB should be updated to clear the error
    expect(mockUpdate).toHaveBeenCalled();
  });

  it("handles null storage usage gracefully", async () => {
    const dep = makeDep({ isPlatform: false });
    mockFindMany.mockResolvedValue([dep]);
    mockGetStorageUsage.mockResolvedValue(null);

    await enforceStorageLimits();

    expect(mockStopDeployment).not.toHaveBeenCalled();
  });
});
