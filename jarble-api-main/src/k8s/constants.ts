import type { ConfigFile } from "../runtimes/types.js";

export const NAMESPACE = "jarble";
// Pin to a specific image tag in production via DEFAULT_POD_IMAGE env var.
// Using :latest as fallback for local dev only — production deployments
// should always set DEFAULT_POD_IMAGE to a versioned tag (e.g. :2026.3.2).
export const DEFAULT_IMAGE = process.env.DEFAULT_POD_IMAGE || "ghcr.io/jarble-ai/openclaw:latest";

export interface DeploymentConfig {
  name: string;
  template?: string;
  platform?: string;
  runtime?: string;
  image?: string;
  cpuLimit?: string;     // e.g. "2.0" — vCPU allocation
  memoryMb?: number;     // e.g. 2048 — RAM in MB
  storageMb?: number;    // e.g. 30 — persistent storage in GB (historical naming)
  containerPort?: number;  // Runtime-specific gateway port (openclaw: 18789, zeroclaw: 3000)
  initialConfigs?: ConfigFile[];              // Config files to write to PVC after pod starts
  extraSecretEntries?: Record<string, string>; // Additional K8s Secret env vars from runtime handler
  gatewayToken?: string;                       // Pre-generated gateway token (generated if omitted)
}

// Default gateway ports per runtime
export const RUNTIME_PORTS: Record<string, number> = {
  openclaw: 18789,
  zeroclaw: 3000,
};

// ── Operator CRD constants ────────────────────────────────────────────────
export const CRD_GROUP = "openclaw.rocks";
export const CRD_VERSION = "v1alpha1";
export const CRD_PLURAL = "openclawinstances";

// ── Dual-mode constants ──────────────────────────────────────────────────
export type ManagedBy = "legacy" | "operator";

export const LEGACY_CONTAINER_NAME = "runtime";
export const OPERATOR_CONTAINER_NAME = "openclaw";
export const LEGACY_PVC_MOUNT = "/data";
export const OPERATOR_PVC_MOUNT = "/home/openclaw/.openclaw";

/** Get the main container name based on management mode. */
export function getContainerName(managedBy: ManagedBy): string {
  return managedBy === "operator" ? OPERATOR_CONTAINER_NAME : LEGACY_CONTAINER_NAME;
}

/** Get the PVC mount path based on management mode. */
export function getPvcMountPath(managedBy: ManagedBy): string {
  return managedBy === "operator" ? OPERATOR_PVC_MOUNT : LEGACY_PVC_MOUNT;
}

/** Get the container HOME directory based on management mode. */
export function getContainerHome(managedBy: ManagedBy): string {
  return managedBy === "operator" ? "/home/openclaw" : "/data";
}

/**
 * Build a K8s label selector to find pods for a deployment.
 * Legacy uses `app=dep-{id}`, operator uses `app.kubernetes.io/instance=dep-{id}`.
 */
export function podLabelSelector(deploymentId: string, managedBy: ManagedBy): string {
  if (managedBy === "operator") {
    return `app.kubernetes.io/instance=dep-${deploymentId}`;
  }
  return `app=dep-${deploymentId}`;
}
