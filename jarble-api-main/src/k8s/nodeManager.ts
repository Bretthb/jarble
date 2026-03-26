/**
 * Auto-scaling Node Manager for Hetzner K3s Workers
 *
 * Runs a background loop every 15 seconds that:
 * 1. Checks for Pending bot pods → provisions new Hetzner workers
 * 2. Checks for empty auto-scaled workers → deprovisions them
 *
 * This approach avoids pre-deploy capacity checks and timing issues.
 * Pods go Pending naturally when nodes are full, and the watcher reacts.
 */

import { coreApi } from "./client.js";
import { NAMESPACE } from "./constants.js";
import { createModuleLogger } from "../utils/logger.js";
import { eq, and, inArray, lt } from "drizzle-orm";
import { db } from "../db/index.js";
import { managedNodes } from "../db/schema.js";
import { customAlphabet } from "nanoid";

const logger = createModuleLogger("nodeManager");
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);

// ── Configuration ────────────────────────────────────────────────────────

const HETZNER_API = "https://api.hetzner.cloud/v1";
const SERVER_TYPE = "cpx21";
const OS_IMAGE = "ubuntu-22.04";
const LOCATION = "ash";
const K3S_VERSION = "v1.29.2+k3s1";
const MASTER_PRIVATE_IP = "10.0.1.10";
const NODE_NAME_PREFIX = "jarble-auto";
const MONTHLY_COST_CENTS = 1220;
const NODE_JOIN_TIMEOUT_MS = 180_000; // 3 min for server + K3s join
const POLL_INTERVAL_MS = 15_000; // check every 15 seconds
const SCALE_DOWN_GRACE_MS = 5 * 60 * 1000; // 5 min before removing empty node

function getHetznerToken(): string {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) throw new Error("HETZNER_API_TOKEN not set");
  return token;
}

function isEnabled(): boolean {
  return process.env.AUTOSCALE_ENABLED === "true";
}

// ── Hetzner API Client ──────────────────────────────────────────────────

async function hetznerRequest<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${HETZNER_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${getHetznerToken()}`,
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hetzner ${method} ${path} (${res.status}): ${text}`);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// ── Cloud-init ──────────────────────────────────────────────────────────

function buildCloudInit(): string {
  const k3sToken = process.env.K3S_JOIN_TOKEN;
  if (!k3sToken) throw new Error("K3S_JOIN_TOKEN not set");

  return `#!/bin/bash
set -euo pipefail
sleep 10
apt-get update -qq
apt-get install -y -qq open-iscsi nfs-common curl
systemctl enable iscsid && systemctl start iscsid
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${K3S_VERSION}" sh -s - agent \\
  --server "https://${MASTER_PRIVATE_IP}:6443" \\
  --token "${k3sToken}" \\
  --flannel-iface "enp7s0"
`;
}

// ── Provision ───────────────────────────────────────────────────────────

let provisioning = false; // simple lock

async function provisionNode(): Promise<void> {
  if (provisioning) return;
  provisioning = true;

  const nodeName = `${NODE_NAME_PREFIX}-${nanoid()}`;
  const nodeId = `node_${nanoid()}`;

  logger.info({ nodeName }, "Scale UP: provisioning new worker");

  // Insert tracking row with unique temp IDs
  await db.insert(managedNodes).values({
    id: nodeId,
    hetznerServerId: -Date.now(),
    hetznerVolumeId: 0,
    nodeName,
    nodeIp: "pending",
    serverType: SERVER_TYPE,
    status: "provisioning",
    monthlyCostCents: MONTHLY_COST_CENTS,
  });

  try {
    const networkId = parseInt(process.env.HETZNER_NETWORK_ID || "0");
    const firewallId = parseInt(process.env.HETZNER_FIREWALL_ID || "0");
    const sshKeyId = parseInt(process.env.HETZNER_SSH_KEY_ID || "0");

    // Create server (no public IP — private network only)
    const serverRes = await hetznerRequest<any>("POST", "/servers", {
      name: nodeName,
      server_type: SERVER_TYPE,
      image: OS_IMAGE,
      location: LOCATION,
      ssh_keys: [sshKeyId],
      firewalls: [{ firewall: firewallId }],
      networks: [networkId],
      user_data: buildCloudInit(),
      labels: { cluster: "jarble", role: "agent", managed: "true" },
      public_net: { enable_ipv4: false, enable_ipv6: false },
    });

    const serverId = serverRes.server.id;
    const serverIp = serverRes.server.private_net?.[0]?.ip || "unknown";
    logger.info({ nodeName, serverId, serverIp }, "Hetzner server created");

    await db.update(managedNodes)
      .set({ hetznerServerId: serverId, nodeIp: serverIp, status: "joining" })
      .where(eq(managedNodes.id, nodeId));

    // Wait for K3s node to appear and become Ready
    const deadline = Date.now() + NODE_JOIN_TIMEOUT_MS;
    let joined = false;
    while (Date.now() < deadline) {
      try {
        const { body: nodeList } = await coreApi.listNode();
        const node = (nodeList.items || []).find((n: any) => n.metadata?.name === nodeName);
        if (node) {
          const ready = node.status?.conditions?.find((c: any) => c.type === "Ready");
          if (ready?.status === "True") {
            joined = true;
            break;
          }
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 10_000));
    }

    if (!joined) {
      throw new Error(`Node ${nodeName} did not join K3s within ${NODE_JOIN_TIMEOUT_MS / 1000}s`);
    }

    await db.update(managedNodes)
      .set({ status: "ready", readyAt: new Date() })
      .where(eq(managedNodes.id, nodeId));

    logger.info({ nodeName, cost: `$${(MONTHLY_COST_CENTS / 100).toFixed(2)}/mo` },
      "Scale UP complete: new worker ready");

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ nodeName, err: msg }, "Scale UP failed");

    // Cleanup partial resources
    const rows = await db.select().from(managedNodes).where(eq(managedNodes.id, nodeId));
    const row = rows[0];
    if (row?.hetznerServerId > 0) {
      await hetznerRequest("DELETE", `/servers/${row.hetznerServerId}`).catch(() => {});
    }

    await db.update(managedNodes)
      .set({ status: "failed", error: msg })
      .where(eq(managedNodes.id, nodeId));
  } finally {
    provisioning = false;
  }
}

// ── Deprovision ─────────────────────────────────────────────────────────

async function deprovisionNode(node: any): Promise<void> {
  logger.info({ nodeName: node.nodeName }, "Scale DOWN: removing empty worker");

  await db.update(managedNodes)
    .set({ status: "draining" })
    .where(eq(managedNodes.id, node.id));

  try {
    // Cordon and delete K3s node
    try {
      await coreApi.patchNode(node.nodeName, { spec: { unschedulable: true } },
        undefined, undefined, undefined, undefined, undefined,
        { headers: { "Content-Type": "application/strategic-merge-patch+json" } });
    } catch {}
    try {
      await coreApi.deleteNode(node.nodeName);
    } catch {}

    await db.update(managedNodes)
      .set({ status: "deleting" })
      .where(eq(managedNodes.id, node.id));

    // Delete Hetzner server
    if (node.hetznerServerId > 0) {
      await hetznerRequest("DELETE", `/servers/${node.hetznerServerId}`);
      logger.info({ nodeName: node.nodeName, serverId: node.hetznerServerId }, "Hetzner server deleted");
    }

    await db.update(managedNodes)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(managedNodes.id, node.id));

    logger.info({ nodeName: node.nodeName, saving: `$${(node.monthlyCostCents / 100).toFixed(2)}/mo` },
      "Scale DOWN complete: worker removed");

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ nodeName: node.nodeName, err: msg }, "Scale DOWN failed");
    await db.update(managedNodes)
      .set({ status: "failed", error: msg })
      .where(eq(managedNodes.id, node.id));
  }
}

// ── Background Watcher ──────────────────────────────────────────────────

async function poll(): Promise<void> {
  try {
    // 1. Check for Pending bot pods → scale up
    const { body: podList } = await coreApi.listNamespacedPod(
      NAMESPACE, undefined, undefined, undefined, undefined,
      "jarble.ai/type=bot"
    );

    const pendingPods = (podList.items || []).filter((p: any) => {
      if (p.status?.phase !== "Pending") return false;
      // Only count pods that are Pending due to scheduling (not init)
      const conditions = p.status?.conditions || [];
      const unschedulable = conditions.find((c: any) =>
        c.type === "PodScheduled" && c.status === "False" && c.reason === "Unschedulable"
      );
      return !!unschedulable;
    });

    if (pendingPods.length > 0 && !provisioning) {
      logger.info({ pendingCount: pendingPods.length },
        "Detected Pending bot pods — triggering scale up");
      void provisionNode();
    }

    // 2. Check for empty auto-scaled nodes → scale down
    const readyNodes = await db.select().from(managedNodes)
      .where(eq(managedNodes.status, "ready"));

    for (const managedNode of readyNodes) {
      // Check if this node has any bot pods
      const podsOnNode = (podList.items || []).filter(
        (p: any) => p.spec?.nodeName === managedNode.nodeName
      );

      if (podsOnNode.length === 0) {
        // Check grace period — don't remove immediately
        const readyTime = managedNode.readyAt ? new Date(managedNode.readyAt).getTime() : 0;
        const age = Date.now() - readyTime;
        if (age > SCALE_DOWN_GRACE_MS) {
          logger.info({ nodeName: managedNode.nodeName, emptyFor: `${Math.round(age / 1000)}s` },
            "Auto-scaled node is empty past grace period");
          void deprovisionNode(managedNode);
        }
      }
    }
  } catch (err) {
    // Don't crash the loop on transient errors
    logger.debug({ err: err instanceof Error ? err.message : err }, "Poll cycle error");
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Start the auto-scaling background watcher.
 * Call once on API startup.
 */
export function startNodeWatcher(): void {
  if (!isEnabled()) {
    logger.info("Auto-scaling is disabled (AUTOSCALE_ENABLED != true)");
    return;
  }

  logger.info({ intervalMs: POLL_INTERVAL_MS, scaleDownGraceMs: SCALE_DOWN_GRACE_MS },
    "Starting node auto-scaler watcher");

  // Initial poll after 10s (let the API finish starting)
  setTimeout(() => poll(), 10_000);

  // Then poll every 15s
  pollTimer = setInterval(() => poll(), POLL_INTERVAL_MS);
}

export function stopNodeWatcher(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    logger.info("Node auto-scaler watcher stopped");
  }
}

// ── Exports for deployment router (no-ops now, watcher handles everything) ──

export async function ensureCapacityForDeployment(
  _db: any, _cpuLimit?: string, _memoryMb?: number
): Promise<string | undefined> {
  // The background watcher handles scaling. Pods go Pending naturally
  // and the watcher provisions nodes when it detects them.
  return undefined;
}

export async function checkScaleDown(_db: any): Promise<void> {
  // Handled by background watcher
}

export async function cleanupFailedNodes(): Promise<void> {
  if (!isEnabled()) return;

  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const failed = await db.select().from(managedNodes)
    .where(and(
      inArray(managedNodes.status, ["failed", "provisioning"]),
      lt(managedNodes.createdAt, cutoff)
    ));

  for (const node of failed) {
    logger.info({ nodeName: node.nodeName }, "Cleaning up stale node record");
    if (node.hetznerServerId > 0) {
      await hetznerRequest("DELETE", `/servers/${node.hetznerServerId}`).catch(() => {});
    }
    await db.update(managedNodes)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(managedNodes.id, node.id));
  }
}
