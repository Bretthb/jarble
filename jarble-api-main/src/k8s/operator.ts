/**
 * K8s Operator Module — CRD management for OpenClawInstance custom resources.
 *
 * The OpenClaw K8s operator (v0.10.16+) manages StatefulSets, Services, PDBs,
 * and NetworkPolicies from a single OpenClawInstance CR. This module provides
 * CRUD operations for those CRs.
 *
 * Key differences from legacy mode:
 *   - PVC mounts at /home/openclaw/.openclaw (not /data/)
 *   - Pod labels: app.kubernetes.io/instance={name} (not app=dep-{id})
 *   - Container name: "openclaw" (not "runtime")
 *   - Stop = delete CR (PVC retained), Start = recreate CR with existingClaim
 *   - Secret needs `token` key alongside OPENCLAW_GATEWAY_TOKEN
 *   - Operator creates its own ConfigMap from ours (merges gateway config)
 */

import { logger } from "../utils/logger.js";
import { customApi } from "./client.js";
import {
  NAMESPACE,
  DEFAULT_IMAGE,
  RUNTIME_PORTS,
  CRD_GROUP,
  CRD_VERSION,
  CRD_PLURAL,
} from "./constants.js";
import type { DeploymentConfig } from "./constants.js";

// ── CRD Spec Builder ──────────────────────────────────────────────────

export interface OpenClawInstanceSpec {
  apiVersion: string;
  kind: string;
  metadata: {
    name: string;
    namespace: string;
    labels: Record<string, string>;
  };
  spec: Record<string, unknown>;
}

/**
 * Build an OpenClawInstance CR spec from deployment config.
 *
 * @param deploymentId - Deployment ID (used for resource naming)
 * @param userId - Owner's user ID
 * @param config - Deployment configuration
 * @param existingPvc - If set, use this PVC name instead of provisioning a new one (for start after stop)
 */
export function buildCRSpec(
  deploymentId: string,
  userId: string,
  config: DeploymentConfig,
  existingPvc?: string
): OpenClawInstanceSpec {
  const crName = `dep-${deploymentId}`;
  const containerImage = config.image || DEFAULT_IMAGE;

  // Parse image into repository + tag
  const lastColon = containerImage.lastIndexOf(":");
  const repository = lastColon > 0 ? containerImage.substring(0, lastColon) : containerImage;
  const tag = lastColon > 0 ? containerImage.substring(lastColon + 1) : "latest";

  // Derive resource values
  const cpuLimit = config.cpuLimit || "2.0";
  const memoryMb = config.memoryMb || 3072;
  const storageGbVal = config.storageMb || 30;
  const cpuMillicores = `${Math.round(parseFloat(cpuLimit) * 1000)}m`;
  const memoryMi = `${memoryMb}Mi`;
  const storageGi = `${Math.max(1, storageGbVal)}Gi`;

  // Storage config: new PVC or existing claim
  const storageSpec: Record<string, unknown> = existingPvc
    ? { persistence: { enabled: true, existingClaim: existingPvc } }
    : { persistence: { enabled: true, size: storageGi, storageClass: "longhorn" } };

  return {
    apiVersion: `${CRD_GROUP}/${CRD_VERSION}`,
    kind: "OpenClawInstance",
    metadata: {
      name: crName,
      namespace: NAMESPACE,
      labels: {
        "jarble.ai/deployment-id": deploymentId,
        "jarble.ai/user-id": userId,
        "jarble.ai/type": "bot",
      },
    },
    spec: {
      image: {
        repository,
        tag,
        pullPolicy: "IfNotPresent",
        pullSecrets: [{ name: "ghcr-pull-secret" }],
      },

      envFrom: [{ secretRef: { name: `secret-${deploymentId}` } }],

      config: {
        configMapRef: { name: `config-${deploymentId}` },
        mergeMode: "overwrite",
      },

      storage: storageSpec,

      gateway: {
        existingSecret: `secret-${deploymentId}`,
      },

      resources: {
        requests: { cpu: cpuMillicores, memory: memoryMi },
        limits: { cpu: cpuMillicores, memory: memoryMi },
      },

      security: {
        containerSecurityContext: {
          readOnlyRootFilesystem: false,
          allowPrivilegeEscalation: false,
        },
      },

      probes: {
        liveness: {
          initialDelaySeconds: 60,
          periodSeconds: 30,
          timeoutSeconds: 5,
          failureThreshold: 3,
        },
        readiness: {
          initialDelaySeconds: 20,
          periodSeconds: 10,
          timeoutSeconds: 5,
          failureThreshold: 3,
        },
      },
    },
  };
}

// ── CRD CRUD ──────────────────────────────────────────────────────────

export async function createOpenClawInstance(
  deploymentId: string,
  userId: string,
  config: DeploymentConfig,
  existingPvc?: string
): Promise<void> {
  const cr = buildCRSpec(deploymentId, userId, config, existingPvc);
  logger.info({ deploymentId, crName: cr.metadata.name }, "operator: creating OpenClawInstance CR");

  await customApi.createNamespacedCustomObject(
    CRD_GROUP,
    CRD_VERSION,
    NAMESPACE,
    CRD_PLURAL,
    cr
  );

  logger.info({ deploymentId }, "operator: OpenClawInstance CR created");
}

export async function deleteOpenClawInstance(deploymentId: string): Promise<void> {
  const crName = `dep-${deploymentId}`;
  logger.info({ deploymentId, crName }, "operator: deleting OpenClawInstance CR");

  try {
    await customApi.deleteNamespacedCustomObject(
      CRD_GROUP,
      CRD_VERSION,
      NAMESPACE,
      CRD_PLURAL,
      crName
    );
    logger.info({ deploymentId }, "operator: OpenClawInstance CR deleted");
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode === 404) {
      logger.debug({ deploymentId }, "operator: CR already gone (404)");
    } else {
      throw err;
    }
  }
}

export async function getOpenClawInstance(deploymentId: string): Promise<Record<string, unknown> | null> {
  const crName = `dep-${deploymentId}`;
  try {
    const result = await customApi.getNamespacedCustomObject(
      CRD_GROUP,
      CRD_VERSION,
      NAMESPACE,
      CRD_PLURAL,
      crName
    );
    return result.body as Record<string, unknown>;
  } catch (err: unknown) {
    const statusCode = err instanceof Object && "statusCode" in err ? (err as { statusCode: number }).statusCode : null;
    if (statusCode === 404) {
      return null;
    }
    throw err;
  }
}

// ── Operator Detection ──────────────────────────────────────────────────

let operatorInstalledCache: boolean | null = null;

/**
 * Check if the OpenClaw operator CRD is installed in the cluster.
 * Result is cached after first successful check.
 */
export async function isOperatorInstalled(): Promise<boolean> {
  if (operatorInstalledCache !== null) return operatorInstalledCache;

  try {
    const { ApiextensionsV1Api } = await import("@kubernetes/client-node");
    const { kc } = await import("./client.js");
    const apiext = kc.makeApiClient(ApiextensionsV1Api);
    await apiext.readCustomResourceDefinition(`${CRD_PLURAL}.${CRD_GROUP}`);
    operatorInstalledCache = true;
    logger.info("operator: CRD detected, operator mode available");
  } catch {
    operatorInstalledCache = false;
    logger.debug("operator: CRD not found, operator mode unavailable");
  }

  return operatorInstalledCache;
}
