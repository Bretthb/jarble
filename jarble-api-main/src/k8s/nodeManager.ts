/**
 * Auto-scaling Node Manager for Hetzner K3s Workers
 *
 * Background watcher that polls every 15s:
 * 1. Detects Pending (Unschedulable) bot pods → provisions a right-sized Hetzner server
 * 2. Detects empty auto-scaled workers past grace period → deprovisions them
 *
 * Each deployment gets its own server matched to its resource requirements.
 * Server type is chosen to be the smallest that fits the deployment's vCPU + RAM.
 * Block storage is attached for Longhorn persistent volumes.
 */

import { coreApi } from "./client.js";
import { NAMESPACE } from "./constants.js";
import { createModuleLogger } from "../utils/logger.js";
import { db } from "../db/index.js";
import { eq, and, inArray, lt } from "drizzle-orm";
import { managedNodes } from "../db/schema.js";
import { customAlphabet } from "nanoid";

const logger = createModuleLogger("nodeManager");
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);

// ── Configuration ────────────────────────────────────────────────────────

const HETZNER_API = "https://api.hetzner.cloud/v1";
const OS_IMAGE = "ubuntu-22.04";
const LOCATION = "ash";
const K3S_VERSION = "v1.29.2+k3s1";
const MASTER_PRIVATE_IP = "10.0.1.10";
const NODE_NAME_PREFIX = "jarble-auto";
const NODE_JOIN_TIMEOUT_MS = 240_000; // 4 min
const POLL_INTERVAL_MS = 15_000;
const SCALE_DOWN_GRACE_MS = 5 * 60 * 1000; // 5 min

// Hetzner server types mapped to deployment resources.
// Pick the smallest server that fits the pod's CPU + RAM requirements.
// Each entry: { vCPU, memoryGb, diskGb, monthlyCents }
const SERVER_TYPES = [
  { name: "cpx11", cores: 2, memGb: 2,  diskGb: 40,  monthlyCents: 499 },
  { name: "cpx21", cores: 3, memGb: 4,  diskGb: 80,  monthlyCents: 999 },
  { name: "cpx31", cores: 4, memGb: 8,  diskGb: 160, monthlyCents: 1799 },
  { name: "cpx41", cores: 8, memGb: 16, diskGb: 240, monthlyCents: 3349 },
  { name: "cpx51", cores: 16, memGb: 32, diskGb: 360, monthlyCents: 6699 },
] as const;

function pickServerType(cpuCores: number, memGb: number): typeof SERVER_TYPES[number] {
  for (const st of SERVER_TYPES) {
    // Server needs headroom for K3s agent + system (~0.5 vCPU, ~0.5GB RAM)
    if (st.cores >= cpuCores + 0.5 && st.memGb >= memGb + 0.5) {
      return st;
    }
  }
  // Fall back to largest
  return SERVER_TYPES[SERVER_TYPES.length - 1];
}

function getHetznerToken(): string {
  const token = process.env.HETZNER_API_TOKEN;
  if (!token) throw new Error("HETZNER_API_TOKEN not set");
  return token;
}

function isEnabled(): boolean {
  return process.env.AUTOSCALE_ENABLED === "true";
}

// ── Hetzner API ─────────────────────────────────────────────────────────

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

// ── Next Available IP ───────────────────────────────────────────────────

async function getNextNodeIp(): Promise<string> {
  const usedIps = new Set(["10.0.1.1", "10.0.1.10", "10.0.1.20", "10.0.1.21"]);

  const existing = await db.select({ nodeIp: managedNodes.nodeIp })
    .from(managedNodes)
    .where(inArray(managedNodes.status, ["provisioning", "joining", "ready", "draining", "deleting"]));

  for (const row of existing) {
    usedIps.add(row.nodeIp);
  }

  for (let i = 30; i < 254; i++) {
    const ip = `10.0.1.${i}`;
    if (!usedIps.has(ip)) return ip;
  }
  throw new Error("No available IPs in subnet");
}

// ── Cloud-init ──────────────────────────────────────────────────────────

function buildCloudInit(nodeIp: string): string {
  const k3sToken = process.env.K3S_JOIN_TOKEN;
  if (!k3sToken) throw new Error("K3S_JOIN_TOKEN not set");

  return `#!/bin/bash
set -euo pipefail
sleep 5

# Install Longhorn prerequisites
apt-get update -qq
apt-get install -y -qq open-iscsi nfs-common curl
systemctl enable iscsid && systemctl start iscsid

# Join K3s cluster
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${K3S_VERSION}" sh -s - agent \\
  --server "https://${MASTER_PRIVATE_IP}:6443" \\
  --token "${k3sToken}" \\
  --node-ip "${nodeIp}" \\
  --flannel-iface "enp7s0"

echo "K3s agent joined" > /var/log/k3s-setup.log
`;
}

// ── Provision ───────────────────────────────────────────────────────────

let provisioning = false;

async function provisionNode(podCpuCores: number, podMemGb: number, podStorageGb: number): Promise<void> {
  if (provisioning) return;
  provisioning = true;

  const serverType = pickServerType(podCpuCores, podMemGb);
  const nodeName = `${NODE_NAME_PREFIX}-${nanoid()}`;
  const nodeId = `node_${nanoid()}`;

  let nodeIp: string;
  try {
    nodeIp = await getNextNodeIp();
  } catch (err) {
    provisioning = false;
    throw err;
  }

  logger.info({
    nodeName, nodeIp, serverType: serverType.name,
    podCpu: podCpuCores, podMem: podMemGb, podStorage: podStorageGb,
    cost: `$${(serverType.monthlyCents / 100).toFixed(2)}/mo`,
  }, "Scale UP: provisioning server for pending pod");

  // Insert tracking row
  await db.insert(managedNodes).values({
    id: nodeId,
    hetznerServerId: -(Math.floor(Math.random() * 2000000000) + 1),
    hetznerVolumeId: 0,
    nodeName,
    nodeIp,
    serverType: serverType.name,
    status: "provisioning",
    monthlyCostCents: serverType.monthlyCents,
  });

  try {
    const networkId = parseInt(process.env.HETZNER_NETWORK_ID || "0");
    const firewallId = parseInt(process.env.HETZNER_FIREWALL_ID || "0");
    const sshKeyId = parseInt(process.env.HETZNER_SSH_KEY_ID || "0");

    // 1. Create server WITHOUT network (we'll attach with explicit IP after)
    const serverRes = await hetznerRequest<any>("POST", "/servers", {
      name: nodeName,
      server_type: serverType.name,
      image: OS_IMAGE,
      location: LOCATION,
      ssh_keys: [sshKeyId],
      firewalls: [{ firewall: firewallId }],
      user_data: buildCloudInit(nodeIp),
      labels: { cluster: "jarble", role: "agent", managed: "true" },
      public_net: { enable_ipv4: false, enable_ipv6: false },
    });
    const serverId = serverRes.server.id;
    logger.info({ nodeName, serverId }, "Hetzner server created");

    await db.update(managedNodes)
      .set({ hetznerServerId: serverId })
      .where(eq(managedNodes.id, nodeId));

    // 2. Wait for server to be running
    for (let i = 0; i < 30; i++) {
      const s = await hetznerRequest<any>("GET", `/servers/${serverId}`);
      if (s.server.status === "running") break;
      await new Promise((r) => setTimeout(r, 5000));
    }

    // 3. Attach to private network with explicit IP
    await hetznerRequest("POST", `/servers/${serverId}/actions/attach_to_network`, {
      network: networkId,
      ip: nodeIp,
    });
    logger.info({ nodeName, nodeIp }, "Attached to private network");

    // 4. Create and attach block storage if deployment needs persistent storage
    if (podStorageGb > 0) {
      const volumeRes = await hetznerRequest<any>("POST", "/volumes", {
        name: `${nodeName}-data`,
        size: podStorageGb,
        location: LOCATION,
        format: "ext4",
        server: serverId,
        automount: false,
        labels: { cluster: "jarble", role: "longhorn-data", node: nodeName },
      });
      const volumeId = volumeRes.volume.id;
      logger.info({ nodeName, volumeId, sizeGb: podStorageGb }, "Block storage attached");

      await db.update(managedNodes)
        .set({ hetznerVolumeId: volumeId })
        .where(eq(managedNodes.id, nodeId));
    }

    await db.update(managedNodes)
      .set({ status: "joining" })
      .where(eq(managedNodes.id, nodeId));

    // 5. Wait for K3s node to join
    logger.info({ nodeName }, "Waiting for K3s agent to join...");
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

    logger.info({ nodeName, serverType: serverType.name, cost: `$${(serverType.monthlyCents / 100).toFixed(2)}/mo` },
      "Scale UP complete: worker ready");

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ nodeName, err: msg }, "Scale UP failed");

    // Cleanup
    const rows = await db.select().from(managedNodes).where(eq(managedNodes.id, nodeId));
    const row = rows[0];
    if (row?.hetznerServerId > 0) {
      await hetznerRequest("DELETE", `/servers/${row.hetznerServerId}`).catch(() => {});
    }
    if (row?.hetznerVolumeId > 0) {
      await new Promise((r) => setTimeout(r, 5000));
      await hetznerRequest("DELETE", `/volumes/${row.hetznerVolumeId}`).catch(() => {});
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
    try {
      await coreApi.patchNode(node.nodeName, { spec: { unschedulable: true } },
        undefined, undefined, undefined, undefined, undefined,
        { headers: { "Content-Type": "application/strategic-merge-patch+json" } });
    } catch {}
    try { await coreApi.deleteNode(node.nodeName); } catch {}

    await db.update(managedNodes)
      .set({ status: "deleting" })
      .where(eq(managedNodes.id, node.id));

    if (node.hetznerServerId > 0) {
      await hetznerRequest("DELETE", `/servers/${node.hetznerServerId}`);
    }
    if (node.hetznerVolumeId > 0) {
      await new Promise((r) => setTimeout(r, 5000));
      await hetznerRequest("DELETE", `/volumes/${node.hetznerVolumeId}`).catch(() => {});
    }

    await db.update(managedNodes)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(managedNodes.id, node.id));

    logger.info({ nodeName: node.nodeName, saving: `$${(node.monthlyCostCents / 100).toFixed(2)}/mo` },
      "Scale DOWN complete");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ nodeName: node.nodeName, err: msg }, "Scale DOWN failed");
    await db.update(managedNodes)
      .set({ status: "failed", error: msg })
      .where(eq(managedNodes.id, node.id));
  }
}

// ── Background Watcher ──────────────────────────────────────────────────

/** Extract CPU cores and memory GB from a pod's container resource requests */
function getPodResources(pod: any): { cpuCores: number; memGb: number; storageGb: number } {
  let cpuMillis = 0;
  let memMi = 0;
  for (const container of pod.spec?.containers || []) {
    const cpu = container.resources?.requests?.cpu || container.resources?.limits?.cpu || "0";
    const mem = container.resources?.requests?.memory || container.resources?.limits?.memory || "0";
    cpuMillis += cpu.endsWith("m") ? parseInt(cpu) : Math.round(parseFloat(cpu) * 1000);
    if (mem.endsWith("Mi")) memMi += parseInt(mem);
    else if (mem.endsWith("Gi")) memMi += parseInt(mem) * 1024;
  }

  // Get storage from PVC claim if available
  let storageGb = 30; // default
  for (const vol of pod.spec?.volumes || []) {
    if (vol.persistentVolumeClaim) {
      // We'll use 30GB as default — the actual PVC size is in the PVC spec
      storageGb = 30;
    }
  }

  return {
    cpuCores: cpuMillis / 1000,
    memGb: memMi / 1024,
    storageGb,
  };
}

async function poll(): Promise<void> {
  try {
    const { body: podList } = await coreApi.listNamespacedPod(
      NAMESPACE, undefined, undefined, undefined, undefined,
      "jarble.ai/type=bot"
    );

    // 1. Scale UP: check for Pending (Unschedulable) pods
    const pendingPods = (podList.items || []).filter((p: any) => {
      if (p.status?.phase !== "Pending") return false;
      const conditions = p.status?.conditions || [];
      return conditions.some((c: any) =>
        c.type === "PodScheduled" && c.status === "False" && c.reason === "Unschedulable"
      );
    });

    if (pendingPods.length > 0 && !provisioning) {
      // Use the first pending pod's resources to size the server
      const pod = pendingPods[0];
      const resources = getPodResources(pod);
      logger.info({
        pendingCount: pendingPods.length,
        podName: pod.metadata?.name,
        cpu: resources.cpuCores,
        mem: resources.memGb,
        storage: resources.storageGb,
      }, "Pending bot pod detected — provisioning right-sized server");
      void provisionNode(resources.cpuCores, resources.memGb, resources.storageGb);
    }

    // 2. Scale DOWN: check for empty auto-scaled nodes
    const readyNodes = await db.select().from(managedNodes)
      .where(eq(managedNodes.status, "ready"));

    for (const managedNode of readyNodes) {
      const podsOnNode = (podList.items || []).filter(
        (p: any) => p.spec?.nodeName === managedNode.nodeName
      );
      if (podsOnNode.length === 0) {
        const readyTime = managedNode.readyAt ? new Date(managedNode.readyAt).getTime() : 0;
        if (Date.now() - readyTime > SCALE_DOWN_GRACE_MS) {
          void deprovisionNode(managedNode);
        }
      }
    }
  } catch (err) {
    logger.warn({ err: err instanceof Error ? err.message : err }, "Poll cycle error");
  }
}

let pollTimer: ReturnType<typeof setInterval> | null = null;

export function startNodeWatcher(): void {
  if (!isEnabled()) {
    logger.info("Auto-scaling disabled (AUTOSCALE_ENABLED != true)");
    return;
  }
  logger.info({ intervalMs: POLL_INTERVAL_MS }, "Starting node auto-scaler watcher");
  setTimeout(() => poll(), 10_000);
  pollTimer = setInterval(() => poll(), POLL_INTERVAL_MS);
}

export function stopNodeWatcher(): void {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── Exports for deployment router (no-ops — watcher handles everything) ──

export async function ensureCapacityForDeployment(
  _db: any, _cpuLimit?: string, _memoryMb?: number
): Promise<string | undefined> {
  return undefined;
}

export async function checkScaleDown(_db: any): Promise<void> {}

export async function cleanupFailedNodes(): Promise<void> {
  if (!isEnabled()) return;
  const cutoff = new Date(Date.now() - 10 * 60 * 1000);
  const failed = await db.select().from(managedNodes)
    .where(and(
      inArray(managedNodes.status, ["failed", "provisioning"]),
      lt(managedNodes.createdAt, cutoff)
    ));
  for (const node of failed) {
    if (node.hetznerServerId > 0) {
      await hetznerRequest("DELETE", `/servers/${node.hetznerServerId}`).catch(() => {});
    }
    if (node.hetznerVolumeId > 0) {
      await hetznerRequest("DELETE", `/volumes/${node.hetznerVolumeId}`).catch(() => {});
    }
    await db.update(managedNodes)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(managedNodes.id, node.id));
  }
}
