/**
 * Auto-scaling Node Manager for Hetzner K3s Workers
 *
 * Synchronous capacity API (used by deploy/start mutations):
 * - ensureCapacityForDeployment: Blocks until a node is available or at limit.
 *   Serialized via mutex to prevent thundering-herd VPS creation.
 * - getCapacityStatus: Returns cluster capacity snapshot for frontend display.
 *
 * Background watcher (polls every 15s):
 * 1. Detects Pending (Unschedulable) bot pods → provisions a right-sized Hetzner server
 * 2. Detects auto-scaled nodes with NO K8s Deployments referencing them → deprovisions
 *    (stopped bots keep their VPS so restarts are instant; only deletes trigger scale-down)
 *
 * Each deployment gets its own server matched to its resource requirements.
 * Server type is chosen to be the smallest that fits the deployment's vCPU + RAM.
 * Block storage is attached for Longhorn persistent volumes.
 */

import { coreApi, appsApi } from "./client.js";
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

function buildCloudInit(nodeIp: string, hasVolume: boolean): string {
  const k3sToken = process.env.K3S_JOIN_TOKEN;
  if (!k3sToken) throw new Error("K3S_JOIN_TOKEN not set");

  // Volume mount section — waits for Hetzner block storage device to appear
  // The volume ID isn't known at cloud-init time, so we find it by scanning /dev/disk/by-id/
  const volumeMount = hasVolume ? `
# Mount Hetzner block storage for Longhorn
MOUNT_PATH="/var/lib/longhorn"
mkdir -p "$MOUNT_PATH"
echo "Waiting for block storage device..."
for i in $(seq 1 60); do
  VOLUME_DEVICE=$(ls /dev/disk/by-id/scsi-0HC_Volume_* 2>/dev/null | head -1)
  if [ -n "$VOLUME_DEVICE" ]; then
    echo "Volume device found: $VOLUME_DEVICE"
    mount -o discard,defaults "$VOLUME_DEVICE" "$MOUNT_PATH"
    if ! grep -q "$VOLUME_DEVICE" /etc/fstab; then
      echo "$VOLUME_DEVICE $MOUNT_PATH ext4 discard,nofail,defaults 0 0" >> /etc/fstab
    fi
    echo "Block storage mounted at $MOUNT_PATH"
    break
  fi
  sleep 5
done
` : "";

  return `#!/bin/bash
set -euo pipefail
sleep 5

# Install Longhorn prerequisites
apt-get update -qq
apt-get install -y -qq open-iscsi nfs-common curl
systemctl enable iscsid && systemctl start iscsid
${volumeMount}
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
let lastFailureTime = 0;
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000; // 5 min cooldown after a failure

async function provisionNode(podCpuCores: number, podMemGb: number, podStorageGb: number): Promise<string> {
  if (provisioning) throw new Error("Another provision operation is already in progress");
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
    const hasVolume = podStorageGb > 0;

    // 1. Create block storage FIRST so it's available at boot for cloud-init to mount
    let volumeId = 0;
    if (hasVolume) {
      const volumeRes = await hetznerRequest<any>("POST", "/volumes", {
        name: `${nodeName}-data`,
        size: podStorageGb,
        location: LOCATION,
        format: "ext4",
        automount: false,
        labels: { cluster: "jarble", role: "longhorn-data", node: nodeName },
      });
      volumeId = volumeRes.volume.id;
      logger.info({ nodeName, volumeId, sizeGb: podStorageGb }, "Block storage created");

      await db.update(managedNodes)
        .set({ hetznerVolumeId: volumeId })
        .where(eq(managedNodes.id, nodeId));
    }

    // 2. Create server with network + volume attached (so cloud-init can mount it at boot)
    const serverRes = await hetznerRequest<any>("POST", "/servers", {
      name: nodeName,
      server_type: serverType.name,
      image: OS_IMAGE,
      location: LOCATION,
      ssh_keys: [sshKeyId],
      firewalls: [{ firewall: firewallId }],
      networks: [networkId],
      user_data: buildCloudInit(nodeIp, hasVolume),
      labels: { cluster: "jarble", role: "agent", managed: "true" },
      public_net: { enable_ipv4: true, enable_ipv6: true },
      ...(volumeId ? { volumes: [volumeId] } : {}),
    });
    const serverId = serverRes.server.id;
    logger.info({ nodeName, serverId, volumeId: volumeId || "none" }, "Hetzner server created");

    await db.update(managedNodes)
      .set({ hetznerServerId: serverId })
      .where(eq(managedNodes.id, nodeId));

    // 3. Wait for server to be running
    for (let i = 0; i < 30; i++) {
      const s = await hetznerRequest<any>("GET", `/servers/${serverId}`);
      if (s.server.status === "running") break;
      await new Promise((r) => setTimeout(r, 5000));
    }
    logger.info({ nodeName, nodeIp }, "Server running");

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

    // Label the node so we can identify auto-scaled nodes and correlate with DB rows
    try {
      await coreApi.patchNode(nodeName, {
        metadata: {
          labels: {
            "jarble.ai/auto-scaled": "true",
            "jarble.ai/managed-node-id": String(nodeId),
          },
        },
      }, undefined, undefined, undefined, undefined, undefined, {
        headers: { "Content-Type": "application/strategic-merge-patch+json" },
      });
      logger.info({ nodeName, nodeId }, "Node labeled with auto-scale metadata");
    } catch (labelErr) {
      // Non-fatal: node is functional even without labels
      logger.warn({ nodeName, err: labelErr instanceof Error ? labelErr.message : labelErr },
        "Failed to label auto-scaled node (non-fatal)");
    }

    // Taint the node so only agent pods (which have a matching toleration) can schedule here.
    // Container/website pods lack this toleration and will be repelled to shared pool nodes.
    try {
      await coreApi.patchNode(nodeName, {
        spec: {
          taints: [
            {
              key: "jarble.ai/workload",
              value: "agent",
              effect: "NoSchedule",
            },
          ],
        },
      }, undefined, undefined, undefined, undefined, undefined, {
        headers: { "Content-Type": "application/strategic-merge-patch+json" },
      });
      logger.info({ nodeName }, "Node tainted with jarble.ai/workload=agent:NoSchedule");
    } catch (taintErr) {
      // Non-fatal: without the taint, container/website pods could land here
      // but the scheduler's affinity rules still prefer pool nodes.
      logger.warn({ nodeName, err: taintErr instanceof Error ? taintErr.message : taintErr },
        "Failed to taint auto-scaled node (non-fatal — containers may schedule here)");
    }

    await db.update(managedNodes)
      .set({ status: "ready", readyAt: new Date() })
      .where(eq(managedNodes.id, nodeId));

    logger.info({ nodeName, serverType: serverType.name, cost: `$${(serverType.monthlyCents / 100).toFixed(2)}/mo` },
      "Scale UP complete: worker ready");

    return nodeName;

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
    lastFailureTime = Date.now();
    throw err;
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

/** Extract CPU cores, memory GB, and storage GB from a pod's resource spec + PVC */
async function getPodResources(pod: any): Promise<{ cpuCores: number; memGb: number; storageGb: number }> {
  let cpuMillis = 0;
  let memMi = 0;
  for (const container of pod.spec?.containers || []) {
    const cpu = container.resources?.requests?.cpu || container.resources?.limits?.cpu || "0";
    const mem = container.resources?.requests?.memory || container.resources?.limits?.memory || "0";
    cpuMillis += cpu.endsWith("m") ? parseInt(cpu) : Math.round(parseFloat(cpu) * 1000);
    if (mem.endsWith("Mi")) memMi += parseInt(mem);
    else if (mem.endsWith("Gi")) memMi += parseInt(mem) * 1024;
  }

  // Read actual PVC size from the claim
  let storageGb = 30; // default
  for (const vol of pod.spec?.volumes || []) {
    if (vol.persistentVolumeClaim?.claimName) {
      try {
        const { body: pvc } = await coreApi.readNamespacedPersistentVolumeClaim(
          vol.persistentVolumeClaim.claimName, NAMESPACE
        );
        const storageStr = pvc.spec?.resources?.requests?.storage || "30Gi";
        if (storageStr.endsWith("Gi")) storageGb = parseInt(storageStr);
        else if (storageStr.endsWith("Mi")) storageGb = Math.ceil(parseInt(storageStr) / 1024);
      } catch {
        // PVC not found — use default
      }
      break;
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

    const inCooldown = Date.now() - lastFailureTime < FAILURE_COOLDOWN_MS;
    if (pendingPods.length > 0 && !provisioning && !inCooldown) {
      // Check server limit before the watcher provisions
      const maxServers = getMaxManagedServers();
      const activeCount = await countActiveManagedNodes();
      if (activeCount >= maxServers) {
        logger.warn({
          pendingCount: pendingPods.length,
          activeManagedNodes: activeCount,
          maxManagedNodes: maxServers,
        }, "Pending pods detected but at server limit — cannot auto-scale");
      } else {
        // Use the first pending pod's resources to size the server
        const pod = pendingPods[0];
        const resources = await getPodResources(pod);
        logger.info({
          pendingCount: pendingPods.length,
          podName: pod.metadata?.name,
          cpu: resources.cpuCores,
          mem: resources.memGb,
          storage: resources.storageGb,
        }, "Pending bot pod detected — provisioning right-sized server");
        provisionNode(resources.cpuCores, resources.memGb, resources.storageGb).catch(() => {
          // Error already logged inside provisionNode; swallow to prevent unhandled rejection
        });
      }
    } else if (pendingPods.length > 0 && provisioning) {
      logger.debug({ pendingCount: pendingPods.length },
        "Pending pods detected but provisioning already in progress — skipping scale-up");
    }

    // 2. Scale DOWN: check for auto-scaled nodes with no deployments referencing them.
    // IMPORTANT: A stopped bot (replicas=0) still has a K8s Deployment with a nodeSelector
    // pointing at the managed node. We must NOT deprovision nodes that have any K8s Deployment
    // (even replicas=0) referencing them. Only deprovision if NO deployments reference the node.
    // This preserves the VPS so restarting a stopped bot is instant (no re-provisioning).
    const readyNodes = await db.select().from(managedNodes)
      .where(eq(managedNodes.status, "ready"));

    if (readyNodes.length > 0) {
      // Get all bot K8s Deployments (including stopped ones with replicas=0)
      const { body: depList } = await appsApi.listNamespacedDeployment(
        NAMESPACE, undefined, undefined, undefined, undefined,
        "jarble.ai/type=bot"
      );
      const k8sDeployments = depList.items || [];

      for (const managedNode of readyNodes) {
        // Check if any K8s Deployment has a nodeSelector pointing at this managed node
        const nodeInUse = k8sDeployments.some((dep: any) => {
          const selector = dep.spec?.template?.spec?.nodeSelector || {};
          return selector["kubernetes.io/hostname"] === managedNode.nodeName;
        });

        if (!nodeInUse) {
          // Also check for pods on the node (catch deployments without nodeSelector)
          const podsOnNode = (podList.items || []).filter(
            (p: any) => p.spec?.nodeName === managedNode.nodeName
          );
          if (podsOnNode.length === 0) {
            const readyTime = managedNode.readyAt ? new Date(managedNode.readyAt).getTime() : 0;
            if (Date.now() - readyTime > SCALE_DOWN_GRACE_MS) {
              logger.info({ nodeName: managedNode.nodeName },
                "No deployments or pods reference this node — eligible for scale-down");
              void deprovisionNode(managedNode);
            }
          }
        } else {
          logger.debug({ nodeName: managedNode.nodeName },
            "Node has K8s Deployments referencing it (may be stopped) — keeping VPS alive");
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

// ── Capacity Check & Pre-provisioning ────────────────────────────────────

/** Parse a CPU string like "2000m", "2", or "1.5" into millicores */
function parseCpuMillis(cpu: string): number {
  if (cpu.endsWith("m")) return parseInt(cpu, 10) || 0;
  return Math.round(parseFloat(cpu) * 1000) || 0;
}

/** Parse a memory string like "4Gi", "3072Mi", "2048Ki" into MiB */
function parseMemoryMi(mem: string): number {
  if (mem.endsWith("Ki")) return Math.round((parseInt(mem, 10) || 0) / 1024);
  if (mem.endsWith("Mi")) return parseInt(mem, 10) || 0;
  if (mem.endsWith("Gi")) return (parseInt(mem, 10) || 0) * 1024;
  // Plain number: assume bytes
  return Math.round((parseInt(mem, 10) || 0) / (1024 * 1024));
}

/**
 * Custom error for capacity-limit rejections.
 * Callers can check `err instanceof CapacityError` to distinguish
 * "no room and can't provision" from transient failures.
 */
export class CapacityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapacityError";
  }
}

// Default to 3: Hetzner 5-server limit minus master + dedicated API worker = 3 bot slots
const HETZNER_MAX_MANAGED_SERVERS_DEFAULT = 3;

function getMaxManagedServers(): number {
  const envVal = process.env.HETZNER_MAX_MANAGED_SERVERS;
  if (envVal) {
    const parsed = parseInt(envVal, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return HETZNER_MAX_MANAGED_SERVERS_DEFAULT;
}

/** Count active (non-deleted, non-failed) managed nodes in the DB */
async function countActiveManagedNodes(): Promise<number> {
  const activeStatuses = ["provisioning", "joining", "ready", "draining", "deleting"];
  const rows = await db.select({ id: managedNodes.id })
    .from(managedNodes)
    .where(inArray(managedNodes.status, activeStatuses));
  return rows.length;
}

// Provisioning mutex — prevents thundering herd when multiple deploys arrive simultaneously.
// The entire capacity-check + provision cycle is serialized: if 5 deploys arrive at once,
// the first acquires the lock and provisions a VPS. The other 4 wait, then each re-checks
// capacity in order. The newly provisioned node may fit multiple pods, so only one VPS
// gets created instead of five.
let capacityLock: Promise<void> = Promise.resolve();

/**
 * Core capacity check logic. Must only be called while holding the capacityLock.
 * Returns a node name if provisioning was needed, or undefined if an existing node fits.
 * Throws CapacityError if at the managed server limit.
 */
async function checkCapacityAndProvision(
  requiredCpuMillis: number, requiredMemMi: number
): Promise<string | undefined> {
  // 1. Get all nodes and their allocatable resources
  const { body: nodeList } = await coreApi.listNode();
  const nodes = (nodeList.items || []).filter((n: any) => {
    const labels = n.metadata?.labels || {};
    // Exclude master/control-plane nodes
    if (labels["node-role.kubernetes.io/master"] !== undefined) return false;
    if (labels["node-role.kubernetes.io/control-plane"] !== undefined) return false;
    // Node must be Ready
    const ready = (n.status?.conditions || []).find((c: any) => c.type === "Ready");
    return ready?.status === "True";
  });

  // 2. Get all running/pending pods in the jarble namespace to calculate used capacity
  const { body: podList } = await coreApi.listNamespacedPod(NAMESPACE);
  const activePods = (podList.items || []).filter((p: any) => {
    const phase = p.status?.phase;
    return phase === "Running" || phase === "Pending";
  });

  // 3. Calculate used resources per node
  const usedByNode = new Map<string, { cpuMillis: number; memMi: number; botCount: number }>();
  for (const pod of activePods) {
    const nodeName = pod.spec?.nodeName;
    if (!nodeName) continue;  // Pending pods without a node assignment
    const used = usedByNode.get(nodeName) || { cpuMillis: 0, memMi: 0, botCount: 0 };
    for (const container of pod.spec?.containers || []) {
      const requests = container.resources?.requests || {};
      used.cpuMillis += parseCpuMillis(requests.cpu || "0");
      used.memMi += parseMemoryMi(requests.memory || "0");
    }
    // Count bot pods specifically (those with the jarble.ai/type=bot label)
    const labels = pod.metadata?.labels || {};
    if (labels["jarble.ai/type"] === "bot") {
      used.botCount += 1;
    }
    usedByNode.set(nodeName, used);
  }

  // 4. Check if any existing node has enough free capacity
  for (const node of nodes) {
    const name = node.metadata?.name || "";
    const allocatable = node.status?.allocatable || {};
    const totalCpuMillis = parseCpuMillis(allocatable.cpu || "0");
    const totalMemMi = parseMemoryMi(allocatable.memory || "0");

    const used = usedByNode.get(name) || { cpuMillis: 0, memMi: 0, botCount: 0 };
    const freeCpuMillis = totalCpuMillis - used.cpuMillis;
    const freeMemMi = totalMemMi - used.memMi;

    logger.debug({
      node: name,
      totalCpu: `${totalCpuMillis}m`, usedCpu: `${used.cpuMillis}m`, freeCpu: `${freeCpuMillis}m`,
      totalMem: `${totalMemMi}Mi`, usedMem: `${used.memMi}Mi`, freeMem: `${freeMemMi}Mi`,
      requiredCpu: `${requiredCpuMillis}m`, requiredMem: `${requiredMemMi}Mi`,
    }, "Node capacity check");

    if (freeCpuMillis >= requiredCpuMillis && freeMemMi >= requiredMemMi) {
      logger.info({ node: name, freeCpu: `${freeCpuMillis}m`, freeMem: `${freeMemMi}Mi` },
        "Existing node has sufficient capacity — letting scheduler place pod");
      return undefined;  // Let the K8s scheduler pick the node
    }
  }

  // 5. No node has enough room — check if we can provision a new one
  const maxServers = getMaxManagedServers();
  const activeCount = await countActiveManagedNodes();

  logger.info({
    checkedNodes: nodes.length,
    activeManagedNodes: activeCount,
    maxManagedNodes: maxServers,
    requiredCpu: `${requiredCpuMillis}m`,
    requiredMem: `${requiredMemMi}Mi`,
  }, "No existing node has sufficient capacity — checking server limit");

  if (activeCount >= maxServers) {
    throw new CapacityError(
      `No server capacity available. All ${maxServers} auto-scaled servers are in use. ` +
      `Try again later or stop an existing deployment.`
    );
  }

  // 6. Under the limit — provision a new server and WAIT for it to join
  logger.info({
    activeManagedNodes: activeCount,
    maxManagedNodes: maxServers,
    requiredCpu: `${requiredCpuMillis}m`,
    requiredMem: `${requiredMemMi}Mi`,
  }, "Under server limit — provisioning new worker (blocking)");

  const cpuCores = requiredCpuMillis / 1000;
  const memGb = requiredMemMi / 1024;
  const nodeName = await provisionNode(cpuCores, memGb, 30);
  return nodeName;
}

/**
 * Synchronous capacity check + provisioning with concurrency control.
 *
 * Behavior varies by deployment type:
 * - "agent" (default): Full capacity check + VPS provisioning.
 *   1. If an existing node fits, returns undefined (let K8s scheduler place the pod).
 *   2. If no node fits and under limit, provisions a new VPS and BLOCKS until ready.
 *   3. If no node fits and AT limit, throws CapacityError immediately.
 * - "container"/"website": Skips VPS provisioning entirely. These types schedule on
 *   shared pool nodes and do not get dedicated VPS instances. Returns undefined.
 *
 * Concurrency: Uses a Promise-based mutex so that if 5 deploys arrive simultaneously,
 * the first one acquires the lock, checks capacity, and provisions a VPS. The other 4
 * wait for the lock, then each re-checks capacity in turn. The newly provisioned node
 * may fit multiple pods, preventing a thundering herd of unnecessary VPS creations.
 *
 * Errors are NOT swallowed — callers must handle CapacityError for user-facing
 * rejection and other errors for transient failures.
 */
export async function ensureCapacityForDeployment(
  _db: any, cpuLimit?: string, memoryMb?: number, deploymentType?: string
): Promise<string | undefined> {
  // Container/website types share existing pool nodes — no VPS provisioning needed.
  if (deploymentType === "container" || deploymentType === "website") {
    logger.info({ deploymentType }, "Skipping VPS provisioning — container/website types use shared pool nodes");
    return undefined;
  }

  if (!isEnabled()) {
    logger.debug("Auto-scaling disabled — skipping capacity check");
    return undefined;
  }

  const requiredCpuMillis = cpuLimit ? parseCpuMillis(cpuLimit) : 2000;   // default 2 cores
  const requiredMemMi = memoryMb ?? 3072;                                  // default 3Gi

  logger.info({
    requiredCpu: `${requiredCpuMillis}m`,
    requiredMem: `${requiredMemMi}Mi`,
  }, "Waiting for capacity lock before checking cluster capacity");

  // Wait for any in-flight capacity check + provision to finish
  await capacityLock;

  // Now acquire the lock for our check+provision cycle
  let releaseLock!: () => void;
  capacityLock = new Promise<void>((resolve) => { releaseLock = resolve; });

  try {
    return await checkCapacityAndProvision(requiredCpuMillis, requiredMemMi);
  } finally {
    releaseLock();
  }
}

export interface CapacityStatus {
  totalNodes: number;
  managedNodes: number;
  maxManagedNodes: number;
  availableSlots: number;
  nodes: Array<{ name: string; freeCpu: string; freeMem: string; botCount: number }>;
}

/**
 * Returns a snapshot of cluster capacity for display in the frontend.
 * Shows per-node free resources and how many more servers can be provisioned.
 */
export async function getCapacityStatus(): Promise<CapacityStatus> {
  const maxServers = getMaxManagedServers();

  if (!isEnabled()) {
    return {
      totalNodes: 0,
      managedNodes: 0,
      maxManagedNodes: maxServers,
      availableSlots: 0,
      nodes: [],
    };
  }

  // Count active managed nodes from DB
  const activeManaged = await countActiveManagedNodes();

  // Get all worker nodes from K8s
  const { body: nodeList } = await coreApi.listNode();
  const workerNodes = (nodeList.items || []).filter((n: any) => {
    const labels = n.metadata?.labels || {};
    if (labels["node-role.kubernetes.io/master"] !== undefined) return false;
    if (labels["node-role.kubernetes.io/control-plane"] !== undefined) return false;
    const ready = (n.status?.conditions || []).find((c: any) => c.type === "Ready");
    return ready?.status === "True";
  });

  // Get pods to calculate usage
  const { body: podList } = await coreApi.listNamespacedPod(NAMESPACE);
  const activePods = (podList.items || []).filter((p: any) => {
    const phase = p.status?.phase;
    return phase === "Running" || phase === "Pending";
  });

  // Calculate used resources and bot counts per node
  const usedByNode = new Map<string, { cpuMillis: number; memMi: number; botCount: number }>();
  for (const pod of activePods) {
    const nodeName = pod.spec?.nodeName;
    if (!nodeName) continue;
    const used = usedByNode.get(nodeName) || { cpuMillis: 0, memMi: 0, botCount: 0 };
    for (const container of pod.spec?.containers || []) {
      const requests = container.resources?.requests || {};
      used.cpuMillis += parseCpuMillis(requests.cpu || "0");
      used.memMi += parseMemoryMi(requests.memory || "0");
    }
    const labels = pod.metadata?.labels || {};
    if (labels["jarble.ai/type"] === "bot") {
      used.botCount += 1;
    }
    usedByNode.set(nodeName, used);
  }

  // Build per-node info
  const nodeInfos = workerNodes.map((node: any) => {
    const name = node.metadata?.name || "";
    const allocatable = node.status?.allocatable || {};
    const totalCpuMillis = parseCpuMillis(allocatable.cpu || "0");
    const totalMemMi = parseMemoryMi(allocatable.memory || "0");

    const used = usedByNode.get(name) || { cpuMillis: 0, memMi: 0, botCount: 0 };
    const freeCpuMillis = totalCpuMillis - used.cpuMillis;
    const freeMemMi = totalMemMi - used.memMi;

    return {
      name,
      freeCpu: `${freeCpuMillis}m`,
      freeMem: `${Math.round(freeMemMi)}Mi`,
      botCount: used.botCount,
    };
  });

  // Available slots: count nodes with enough room for a default-sized bot (2000m CPU, 3072Mi RAM)
  // plus the number of additional servers we can still provision
  const DEFAULT_CPU = 2000;
  const DEFAULT_MEM = 3072;
  let existingSlots = 0;
  for (const node of workerNodes) {
    const name = node.metadata?.name || "";
    const allocatable = node.status?.allocatable || {};
    const totalCpuMillis = parseCpuMillis(allocatable.cpu || "0");
    const totalMemMi = parseMemoryMi(allocatable.memory || "0");
    const used = usedByNode.get(name) || { cpuMillis: 0, memMi: 0, botCount: 0 };
    const freeCpu = totalCpuMillis - used.cpuMillis;
    const freeMem = totalMemMi - used.memMi;
    // How many default-sized bots can still fit on this node?
    const cpuSlots = Math.floor(freeCpu / DEFAULT_CPU);
    const memSlots = Math.floor(freeMem / DEFAULT_MEM);
    existingSlots += Math.min(cpuSlots, memSlots);
  }

  const provisionableServers = Math.max(0, maxServers - activeManaged);

  return {
    totalNodes: workerNodes.length,
    managedNodes: activeManaged,
    maxManagedNodes: maxServers,
    availableSlots: existingSlots + provisionableServers,
    nodes: nodeInfos,
  };
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
