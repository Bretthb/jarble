/**
 * Node Manager — Cluster capacity monitoring and observability
 *
 * Auto-scaling is handled by the Kubernetes Cluster Autoscaler with the
 * Hetzner Cloud provider (deployed in kube-system). This module provides:
 *
 * - Capacity monitoring: check if the cluster can fit a new deployment
 * - Observability: log resource usage per node for debugging
 *
 * The autoscaler watches for Pending pods and provisions new cpx21 workers
 * automatically. When workers are underutilized, it drains and deletes them.
 */

import { coreApi } from "./client.js";
import { createModuleLogger } from "../utils/logger.js";

const logger = createModuleLogger("nodeManager");

// ── Resource Parsing ────────────────────────────────────────────────────

/** Parse K8s CPU string to millicores (e.g. "2" -> 2000, "500m" -> 500) */
function parseCpuMillis(cpu: string | undefined): number {
  if (!cpu) return 0;
  if (cpu.endsWith("m")) return parseInt(cpu.slice(0, -1), 10);
  return Math.round(parseFloat(cpu) * 1000);
}

/** Parse K8s memory string to MiB (e.g. "4Gi" -> 4096, "512Mi" -> 512) */
function parseMemoryMi(mem: string | undefined): number {
  if (!mem) return 0;
  if (mem.endsWith("Ki")) return Math.round(parseInt(mem, 10) / 1024);
  if (mem.endsWith("Mi")) return parseInt(mem, 10);
  if (mem.endsWith("Gi")) return parseInt(mem, 10) * 1024;
  return Math.round(parseInt(mem, 10) / (1024 * 1024));
}

// ── Capacity Check ──────────────────────────────────────────────────────

interface NodeCapacity {
  name: string;
  allocatableCpuMillis: number;
  allocatableMemoryMi: number;
  usedCpuMillis: number;
  usedMemoryMi: number;
  freeCpuMillis: number;
  freeMemoryMi: number;
  botPodCount: number;
}

export interface ClusterCapacity {
  nodes: NodeCapacity[];
  totalBotPods: number;
}

export async function getClusterCapacity(): Promise<ClusterCapacity> {
  const { body: nodeList } = await coreApi.listNode();
  const workerNodes = (nodeList.items || []).filter(
    (n: any) => !n.metadata?.labels?.["node-role.kubernetes.io/master"] &&
                !n.metadata?.labels?.["node-role.kubernetes.io/control-plane"]
  );

  const { body: podList } = await coreApi.listPodForAllNamespaces();

  const usedByNode: Record<string, { cpu: number; mem: number; botCount: number }> = {};
  for (const pod of podList.items || []) {
    const nodeName = pod.spec?.nodeName;
    if (!nodeName) continue;
    if (!usedByNode[nodeName]) usedByNode[nodeName] = { cpu: 0, mem: 0, botCount: 0 };

    if (pod.metadata?.labels?.["jarble.ai/type"] === "bot") {
      usedByNode[nodeName].botCount++;
    }

    for (const container of pod.spec?.containers || []) {
      usedByNode[nodeName].cpu += parseCpuMillis(container.resources?.requests?.cpu);
      usedByNode[nodeName].mem += parseMemoryMi(container.resources?.requests?.memory);
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
    };
  });

  const totalBotPods = nodes.reduce((sum, n) => sum + n.botPodCount, 0);
  return { nodes, totalBotPods };
}

/**
 * Check if the cluster can fit a new deployment.
 * Logs capacity info for observability. Does NOT provision nodes —
 * the Kubernetes Cluster Autoscaler handles that when pods go Pending.
 */
export async function ensureCapacityForDeployment(
  _db: any,
  cpuLimit: string = "2.0",
  memoryMb: number = 3072,
): Promise<string | undefined> {
  try {
    const cpuMillis = Math.round(parseFloat(cpuLimit) * 1000);
    const capacity = await getClusterCapacity();

    // Find a node with enough room
    for (const node of capacity.nodes) {
      if (node.freeCpuMillis >= cpuMillis && node.freeMemoryMi >= memoryMb) {
        logger.debug({
          node: node.name,
          freeCpu: node.freeCpuMillis,
          freeMem: node.freeMemoryMi,
          requestedCpu: cpuMillis,
          requestedMem: memoryMb,
        }, "Node has capacity for deployment");
        return node.name;
      }
    }

    // No node has room — the pod will go Pending and the cluster autoscaler
    // will provision a new Hetzner worker automatically
    logger.info({
      requestedCpu: cpuMillis,
      requestedMem: memoryMb,
      nodes: capacity.nodes.map(n => ({
        name: n.name,
        freeCpu: n.freeCpuMillis,
        freeMem: n.freeMemoryMi,
        bots: n.botPodCount,
      })),
    }, "No node has capacity — cluster autoscaler will provision a new worker");

    return undefined;
  } catch (err) {
    logger.warn({ err }, "Capacity check failed (non-blocking)");
    return undefined;
  }
}

/** No-op — scale-down is handled by the cluster autoscaler */
export async function checkScaleDown(_db: any): Promise<void> {
  // The Kubernetes Cluster Autoscaler automatically removes underutilized nodes
  // after scale-down-unneeded-time (configured to 5 minutes).
}

/** No-op — cleanup is handled by the cluster autoscaler */
export async function cleanupFailedNodes(_db: any): Promise<void> {}
