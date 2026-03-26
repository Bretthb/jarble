/**
 * Auto-scaling Node Manager for Hetzner K3s Workers
 *
 * Provisions/deprovisions Hetzner Cloud cpx21 servers as K3s worker nodes
 * based on bot deployment demand. Each worker fits ~1 bot pod.
 *
 * Scale-up: called before pod creation when no worker has capacity.
 * Scale-down: called after pod deletion when an auto-scaled worker is empty.
 */

import { coreApi } from "./client.js";
import { NAMESPACE } from "./constants.js";
import { createModuleLogger } from "../utils/logger.js";
import { eq, and, inArray, lt } from "drizzle-orm";
import { managedNodes } from "../db/schema.js";
import { customAlphabet } from "nanoid";

const logger = createModuleLogger("nodeManager");
const nanoid = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 6);

// ── Configuration ────────────────────────────────────────────────────────

const HETZNER_API = "https://api.hetzner.cloud/v1";
const SERVER_TYPE = "cpx21";
const OS_IMAGE = "ubuntu-22.04";
const LOCATION = "ash";
const VOLUME_SIZE_GB = 100;
const K3S_VERSION = "v1.29.2+k3s1";
const MASTER_PRIVATE_IP = "10.0.1.10";
const NODE_NAME_PREFIX = "jarble-autoscale";
const MONTHLY_COST_CENTS = 1220; // ~$7.59 server + ~$4.61 100GB volume
const NODE_PROVISION_TIMEOUT_MS = 180_000;
const NODE_JOIN_TIMEOUT_MS = 120_000;
const FAILED_NODE_CLEANUP_AGE_MS = 10 * 60 * 1000; // 10 minutes

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
    throw new Error(`Hetzner API ${method} ${path} failed (${res.status}): ${text}`);
  }

  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// ── Cloud-init Script ───────────────────────────────────────────────────

function buildCloudInit(volumeId: number, nodeIp: string): string {
  const k3sToken = process.env.K3S_JOIN_TOKEN;
  if (!k3sToken) throw new Error("K3S_JOIN_TOKEN not set");

  return `#!/bin/bash
set -euo pipefail
sleep 10

# Install Longhorn prerequisites
apt-get update -qq
apt-get install -y -qq open-iscsi nfs-common curl
systemctl enable iscsid
systemctl start iscsid

# Mount Hetzner block storage for Longhorn
VOLUME_DEVICE="/dev/disk/by-id/scsi-0HC_Volume_${volumeId}"
MOUNT_PATH="/var/lib/longhorn"

echo "Waiting for block storage device..."
for i in $(seq 1 60); do
  if [ -b "$VOLUME_DEVICE" ]; then
    echo "Volume device found"
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "ERROR: Volume device not found after 5 minutes"
    exit 1
  fi
  sleep 5
done

mkdir -p "$MOUNT_PATH"
mount -o discard,defaults "$VOLUME_DEVICE" "$MOUNT_PATH"

if ! grep -q "$VOLUME_DEVICE" /etc/fstab; then
  echo "$VOLUME_DEVICE $MOUNT_PATH ext4 discard,nofail,defaults 0 0" >> /etc/fstab
fi

# Join K3s cluster as agent
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION="${K3S_VERSION}" sh -s - agent \\
  --server "https://${MASTER_PRIVATE_IP}:6443" \\
  --token "${k3sToken}" \\
  --node-ip "${nodeIp}" \\
  --flannel-iface "enp7s0"

echo "K3s agent setup complete" > /var/log/k3s-setup.log
`;
}

// ── Capacity Check ──────────────────────────────────────────────────────

interface NodeCapacity {
  name: string;
  allocatableCpuMillis: number;  // Total allocatable CPU on this node
  allocatableMemoryMi: number;   // Total allocatable memory on this node
  usedCpuMillis: number;         // Sum of pod CPU requests on this node
  usedMemoryMi: number;          // Sum of pod memory requests on this node
  freeCpuMillis: number;         // Available CPU
  freeMemoryMi: number;          // Available memory
  botPodCount: number;
  isAutoScaled: boolean;
}

export interface ClusterCapacity {
  nodes: NodeCapacity[];
  totalBotPods: number;
}

/** Parse K8s resource string to millicores (e.g. "2" -> 2000, "500m" -> 500) */
function parseCpuMillis(cpu: string | undefined): number {
  if (!cpu) return 0;
  if (cpu.endsWith("m")) return parseInt(cpu.slice(0, -1), 10);
  return Math.round(parseFloat(cpu) * 1000);
}

/** Parse K8s resource string to MiB (e.g. "4Gi" -> 4096, "512Mi" -> 512, "2048" -> 2) */
function parseMemoryMi(mem: string | undefined): number {
  if (!mem) return 0;
  if (mem.endsWith("Ki")) return Math.round(parseInt(mem, 10) / 1024);
  if (mem.endsWith("Mi")) return parseInt(mem, 10);
  if (mem.endsWith("Gi")) return parseInt(mem, 10) * 1024;
  // Raw bytes
  return Math.round(parseInt(mem, 10) / (1024 * 1024));
}

export async function getClusterCapacity(db: any): Promise<ClusterCapacity> {
  const { body: nodeList } = await coreApi.listNode();
  const workerNodes = (nodeList.items || []).filter(
    (n: any) => !n.metadata?.labels?.["node-role.kubernetes.io/master"] &&
                !n.metadata?.labels?.["node-role.kubernetes.io/control-plane"]
  );

  // Get ALL pods across ALL namespaces to account for system workloads
  // (kube-proxy, flannel, longhorn, node-exporter, etc.)
  const { body: podList } = await coreApi.listPodForAllNamespaces();

  // Get auto-scaled node names from DB
  const autoScaled = await db.select({ nodeName: managedNodes.nodeName })
    .from(managedNodes)
    .where(inArray(managedNodes.status, ["ready", "joining", "provisioning"]));
  const autoScaledNames = new Set(autoScaled.map((r: any) => r.nodeName));

  // Sum resource requests per node across all pods
  const usedByNode: Record<string, { cpu: number; mem: number; botCount: number }> = {};
  for (const pod of podList.items || []) {
    const nodeName = pod.spec?.nodeName;
    if (!nodeName) continue;
    if (!usedByNode[nodeName]) usedByNode[nodeName] = { cpu: 0, mem: 0, botCount: 0 };

    // Count bot pods specifically
    if (pod.metadata?.labels?.["jarble.ai/type"] === "bot") {
      usedByNode[nodeName].botCount++;
    }

    // Sum all container resource requests
    for (const container of pod.spec?.containers || []) {
      usedByNode[nodeName].cpu += parseCpuMillis(container.resources?.requests?.cpu);
      usedByNode[nodeName].mem += parseMemoryMi(container.resources?.requests?.memory);
    }
    for (const container of pod.spec?.initContainers || []) {
      // Init containers run sequentially, take the max (not sum)
      const initCpu = parseCpuMillis(container.resources?.requests?.cpu);
      const initMem = parseMemoryMi(container.resources?.requests?.memory);
      usedByNode[nodeName].cpu = Math.max(usedByNode[nodeName].cpu, initCpu);
      usedByNode[nodeName].mem = Math.max(usedByNode[nodeName].mem, initMem);
    }
  }

  const nodes: NodeCapacity[] = workerNodes.map((n: any) => {
    const name = n.metadata?.name || "";
    const allocCpu = parseCpuMillis(n.status?.allocatable?.cpu);
    const allocMem = parseMemoryMi(n.status?.allocatable?.memory);
    const used = usedByNode[name] || { cpu: 0, mem: 0, botCount: 0 };

    return {
      name,
      allocatableCpuMillis: allocCpu,
      allocatableMemoryMi: allocMem,
      usedCpuMillis: used.cpu,
      usedMemoryMi: used.mem,
      freeCpuMillis: Math.max(0, allocCpu - used.cpu),
      freeMemoryMi: Math.max(0, allocMem - used.mem),
      botPodCount: used.botCount,
      isAutoScaled: autoScaledNames.has(name),
    };
  });

  const totalBotPods = nodes.reduce((sum, n) => sum + n.botPodCount, 0);
  return { nodes, totalBotPods };
}

/** Find a node that can fit a pod with the given resource requirements */
export async function findAvailableNode(
  db: any,
  cpuMillis: number = 2000,
  memoryMi: number = 3072
): Promise<string | null> {
  const capacity = await getClusterCapacity(db);

  // Find any node with enough free CPU and memory
  for (const node of capacity.nodes) {
    if (node.freeCpuMillis >= cpuMillis && node.freeMemoryMi >= memoryMi) {
      logger.debug({
        node: node.name,
        freeCpu: node.freeCpuMillis,
        freeMem: node.freeMemoryMi,
        requestedCpu: cpuMillis,
        requestedMem: memoryMi,
      }, "Found node with enough capacity");
      return node.name;
    }
  }

  return null;
}

// ── Next Available IP ───────────────────────────────────────────────────

async function getNextNodeIp(db: any): Promise<string> {
  // Base Terraform nodes use 10.0.1.20 and 10.0.1.21
  const usedIps = new Set(["10.0.1.10", "10.0.1.20", "10.0.1.21"]);

  // Get IPs from managed_nodes (including failed/deleted to avoid reuse conflicts)
  const existing = await db.select({ nodeIp: managedNodes.nodeIp })
    .from(managedNodes)
    .where(inArray(managedNodes.status, ["provisioning", "joining", "ready", "draining", "deleting"]));

  for (const row of existing) {
    usedIps.add(row.nodeIp);
  }

  // Find next available IP starting from .22
  for (let i = 22; i < 254; i++) {
    const ip = `10.0.1.${i}`;
    if (!usedIps.has(ip)) return ip;
  }

  throw new Error("No available IPs in subnet 10.0.1.0/24");
}

// ── Provision Node ──────────────────────────────────────────────────────

export async function provisionNode(db: any): Promise<{ nodeName: string; nodeIp: string }> {
  const nodeName = `${NODE_NAME_PREFIX}-${nanoid()}`;
  const nodeIp = await getNextNodeIp(db);
  const nodeId = `node_${nanoid()}`;

  logger.info({ nodeName, nodeIp }, "Provisioning new worker node");

  // Insert DB record
  await db.insert(managedNodes).values({
    id: nodeId,
    hetznerServerId: 0, // placeholder until created
    hetznerVolumeId: 0,
    nodeName,
    nodeIp,
    serverType: SERVER_TYPE,
    status: "provisioning",
    monthlyCostCents: MONTHLY_COST_CENTS,
  });

  try {
    // 1. Create block volume
    const volumeRes = await hetznerRequest<any>("POST", "/volumes", {
      name: `${nodeName}-longhorn`,
      size: VOLUME_SIZE_GB,
      location: LOCATION,
      format: "ext4",
      labels: { cluster: "jarble", role: "longhorn-data", node: nodeName },
    });
    const volumeId = volumeRes.volume.id;
    logger.info({ nodeName, volumeId }, "Hetzner volume created");

    await db.update(managedNodes)
      .set({ hetznerVolumeId: volumeId })
      .where(eq(managedNodes.id, nodeId));

    // 2. Create server with cloud-init
    const networkId = parseInt(process.env.HETZNER_NETWORK_ID || "0");
    const firewallId = parseInt(process.env.HETZNER_FIREWALL_ID || "0");
    const sshKeyId = parseInt(process.env.HETZNER_SSH_KEY_ID || "0");

    const serverRes = await hetznerRequest<any>("POST", "/servers", {
      name: nodeName,
      server_type: SERVER_TYPE,
      image: OS_IMAGE,
      location: LOCATION,
      ssh_keys: [sshKeyId],
      firewalls: [{ firewall: firewallId }],
      networks: [networkId],
      user_data: buildCloudInit(volumeId, nodeIp),
      labels: { cluster: "jarble", role: "agent", managed: "true" },
      public_net: { enable_ipv4: false, enable_ipv6: false }, // No public IP needed — uses private network only
    });
    const serverId = serverRes.server.id;
    logger.info({ nodeName, serverId }, "Hetzner server created");

    await db.update(managedNodes)
      .set({ hetznerServerId: serverId })
      .where(eq(managedNodes.id, nodeId));

    // 3. Attach volume to server
    await hetznerRequest("POST", `/volumes/${volumeId}/actions/attach`, {
      server: serverId,
      automount: false,
    });
    logger.info({ nodeName, volumeId, serverId }, "Volume attached to server");

    // 4. Assign private IP via network
    await hetznerRequest("POST", `/servers/${serverId}/actions/attach_to_network`, {
      network: networkId,
      ip: nodeIp,
    });
    logger.info({ nodeName, nodeIp }, "Server attached to private network");

    // 5. Wait for server to be running
    const serverDeadline = Date.now() + NODE_PROVISION_TIMEOUT_MS;
    while (Date.now() < serverDeadline) {
      const status = await hetznerRequest<any>("GET", `/servers/${serverId}`);
      if (status.server.status === "running") break;
      await new Promise((r) => setTimeout(r, 5000));
    }

    // 6. Update status to joining
    await db.update(managedNodes)
      .set({ status: "joining" })
      .where(eq(managedNodes.id, nodeId));

    // 7. Wait for K3s node to appear and become Ready
    logger.info({ nodeName }, "Waiting for K3s node to join...");
    const joinDeadline = Date.now() + NODE_JOIN_TIMEOUT_MS;
    let joined = false;
    while (Date.now() < joinDeadline) {
      try {
        const { body: nodeListBody } = await coreApi.listNode();
        const node = (nodeListBody.items || []).find((n: any) => n.metadata?.name === nodeName);
        if (node) {
          const readyCondition = node.status?.conditions?.find((c: any) => c.type === "Ready");
          if (readyCondition?.status === "True") {
            joined = true;
            break;
          }
        }
      } catch {
        // K8s API might be briefly unavailable during node join
      }
      await new Promise((r) => setTimeout(r, 5000));
    }

    if (!joined) {
      throw new Error(`Node ${nodeName} did not join K3s within ${NODE_JOIN_TIMEOUT_MS / 1000}s`);
    }

    // 8. Mark ready
    await db.update(managedNodes)
      .set({ status: "ready", readyAt: new Date() })
      .where(eq(managedNodes.id, nodeId));

    logger.info(
      { nodeName, nodeIp, monthlyCost: `$${(MONTHLY_COST_CENTS / 100).toFixed(2)}` },
      "Auto-scaled UP: new worker node ready"
    );

    return { nodeName, nodeIp };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ nodeName, err: message }, "Failed to provision node");

    await db.update(managedNodes)
      .set({ status: "failed", error: message })
      .where(eq(managedNodes.id, nodeId));

    // Attempt cleanup of partially created resources
    try {
      const row = await db.select().from(managedNodes).where(eq(managedNodes.id, nodeId));
      if (row[0]?.hetznerServerId) {
        await hetznerRequest("DELETE", `/servers/${row[0].hetznerServerId}`).catch(() => {});
      }
      if (row[0]?.hetznerVolumeId) {
        // Wait briefly for server deletion to detach volume
        await new Promise((r) => setTimeout(r, 5000));
        await hetznerRequest("DELETE", `/volumes/${row[0].hetznerVolumeId}`).catch(() => {});
      }
    } catch {
      logger.warn({ nodeName }, "Partial cleanup failed — manual intervention may be needed");
    }

    throw err;
  }
}

// ── Deprovision Node ────────────────────────────────────────────────────

export async function deprovisionNode(db: any, nodeId: string): Promise<void> {
  const rows = await db.select().from(managedNodes).where(eq(managedNodes.id, nodeId));
  const node = rows[0];
  if (!node) throw new Error(`Managed node ${nodeId} not found`);
  if (node.status !== "ready") throw new Error(`Node ${node.nodeName} is ${node.status}, not ready`);

  logger.info({ nodeName: node.nodeName }, "Deprovisioning worker node");

  await db.update(managedNodes)
    .set({ status: "draining" })
    .where(eq(managedNodes.id, nodeId));

  try {
    // 1. Cordon the node (mark unschedulable)
    try {
      await coreApi.patchNode(node.nodeName, {
        spec: { unschedulable: true },
      }, undefined, undefined, undefined, undefined, undefined, {
        headers: { "Content-Type": "application/strategic-merge-patch+json" },
      });
    } catch {
      // Node may already be gone from K3s
    }

    // 2. Delete the K3s node object
    try {
      await coreApi.deleteNode(node.nodeName);
      logger.info({ nodeName: node.nodeName }, "K3s node deleted");
    } catch {
      logger.warn({ nodeName: node.nodeName }, "K3s node deletion failed (may already be gone)");
    }

    // 3. Delete Hetzner server
    await db.update(managedNodes)
      .set({ status: "deleting" })
      .where(eq(managedNodes.id, nodeId));

    await hetznerRequest("DELETE", `/servers/${node.hetznerServerId}`);
    logger.info({ nodeName: node.nodeName, serverId: node.hetznerServerId }, "Hetzner server deleted");

    // 4. Wait for volume to become detached, then delete
    const volumeDeadline = Date.now() + 30_000;
    while (Date.now() < volumeDeadline) {
      try {
        const vol = await hetznerRequest<any>("GET", `/volumes/${node.hetznerVolumeId}`);
        if (!vol.volume.server) break; // detached
      } catch {
        break; // volume may already be gone
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    await hetznerRequest("DELETE", `/volumes/${node.hetznerVolumeId}`);
    logger.info({ nodeName: node.nodeName, volumeId: node.hetznerVolumeId }, "Hetzner volume deleted");

    // 5. Mark deleted
    await db.update(managedNodes)
      .set({ status: "deleted", deletedAt: new Date() })
      .where(eq(managedNodes.id, nodeId));

    logger.info(
      { nodeName: node.nodeName, monthlySaving: `$${(node.monthlyCostCents / 100).toFixed(2)}` },
      "Auto-scaled DOWN: worker node removed"
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ nodeName: node.nodeName, err: message }, "Failed to deprovision node");
    await db.update(managedNodes)
      .set({ status: "failed", error: message })
      .where(eq(managedNodes.id, nodeId));
    throw err;
  }
}

// ── High-Level Orchestration ────────────────────────────────────────────

let scaleLock: Promise<void> | null = null;

/**
 * Ensure cluster has capacity for a deployment with the given resources.
 * If no node can fit the pod, provisions a new Hetzner worker.
 *
 * @param cpuLimit - CPU limit string (e.g. "2.0")
 * @param memoryMb - Memory in MB (e.g. 3072)
 */
export async function ensureCapacityForDeployment(
  db: any,
  cpuLimit: string = "2.0",
  memoryMb: number = 3072,
): Promise<string | undefined> {
  if (!isEnabled()) return undefined;

  const cpuMillis = Math.round(parseFloat(cpuLimit) * 1000);
  const memoryMi = memoryMb;

  // Wait for any in-progress scaling
  while (scaleLock) await scaleLock;

  const available = await findAvailableNode(db, cpuMillis, memoryMi);
  if (available) return available;

  // Need to provision — acquire lock
  let resolve!: () => void;
  scaleLock = new Promise((r) => { resolve = r; });

  try {
    // Double-check after acquiring lock
    const recheck = await findAvailableNode(db, cpuMillis, memoryMi);
    if (recheck) return recheck;

    logger.info({ cpuMillis, memoryMi }, "No node has capacity, provisioning new worker");
    const { nodeName } = await provisionNode(db);
    return nodeName;
  } finally {
    scaleLock = null;
    resolve();
  }
}

export async function checkScaleDown(db: any): Promise<void> {
  if (!isEnabled()) return;

  try {
    const capacity = await getClusterCapacity(db);
    const readyNodes = await db.select().from(managedNodes)
      .where(eq(managedNodes.status, "ready"));

    for (const managedNode of readyNodes) {
      const nodeInfo = capacity.nodes.find((n) => n.name === managedNode.nodeName);
      if (nodeInfo && nodeInfo.botPodCount === 0) {
        logger.info({ nodeName: managedNode.nodeName }, "Auto-scaled node is empty, deprovisioning");
        await deprovisionNode(db, managedNode.id);
      }
    }
  } catch (err) {
    logger.warn({ err }, "Scale-down check encountered an error");
  }
}

export async function cleanupFailedNodes(db: any): Promise<void> {
  if (!isEnabled()) return;

  const cutoff = new Date(Date.now() - FAILED_NODE_CLEANUP_AGE_MS);
  const failedNodes = await db.select().from(managedNodes)
    .where(
      and(
        inArray(managedNodes.status, ["failed", "provisioning"]),
        lt(managedNodes.createdAt, cutoff)
      )
    );

  for (const node of failedNodes) {
    logger.info({ nodeName: node.nodeName, status: node.status }, "Cleaning up failed/stale node");
    try {
      if (node.hetznerServerId) {
        await hetznerRequest("DELETE", `/servers/${node.hetznerServerId}`).catch(() => {});
      }
      if (node.hetznerVolumeId) {
        await new Promise((r) => setTimeout(r, 3000));
        await hetznerRequest("DELETE", `/volumes/${node.hetznerVolumeId}`).catch(() => {});
      }
      await db.update(managedNodes)
        .set({ status: "deleted", deletedAt: new Date() })
        .where(eq(managedNodes.id, node.id));
    } catch (err) {
      logger.warn({ nodeName: node.nodeName, err }, "Failed to clean up node resources");
    }
  }
}
