// Barrel re-export — all K8s operations
// Consumers should import from "../k8s/index.js" (or just "../k8s")

export { coreApi, appsApi, customApi, execClient, kc } from "./client.js";

export { NAMESPACE, DEFAULT_IMAGE, RUNTIME_PORTS } from "./constants.js";
export { CRD_GROUP, CRD_VERSION, CRD_PLURAL } from "./constants.js";
export { RUNTIME_CLASS_MAP, RUNTIME_OVERHEAD, RUNTIME_NODE_SELECTOR } from "./constants.js";
export { getContainerName, getPvcMountPath, getContainerHome, podLabelSelector } from "./constants.js";
export type { DeploymentConfig, ManagedBy, IsolationLevel } from "./constants.js";

export { buildSecurityContext } from "./lifecycle.js";

export { execInPod, execInPodWithStdin, execInPodStreaming, streamExecInPod, findPodForDeployment, escapeShellValue } from "./exec.js";

export { createDeployment, stopDeployment, startDeployment, restartDeployment, deleteDeployment } from "./lifecycle.js";

export { getDeploymentPodStatus, getDeploymentStorageUsage, getPodAddress } from "./status.js";
export type { DeploymentPodStatus, StorageUsage } from "./status.js";

export { writeConfigsToPvc, readConfigsFromPvc, exportDeploymentConfigs, signalProcessRestart } from "./config.js";

export { updateDeploymentSecret, readCurrentSecretData } from "./secrets.js";

export { createDeploymentConfigMap, updateDeploymentConfigMap, deleteDeploymentConfigMap, encodeConfigKey, decodeConfigKey } from "./configmap.js";

export { writeComponentToPvc, readComponentFromPvc, listComponentsOnPvc, getCustomComponentsWithDefinitions, deleteComponentFromPvc } from "./components.js";

export { getDeploymentLogs, streamDeploymentLogs } from "./logs.js";
export type { DeploymentLogsResult } from "./logs.js";

export { buildCRSpec, createOpenClawInstance, deleteOpenClawInstance, getOpenClawInstance, isOperatorInstalled } from "./operator.js";

export { ensureCapacityForDeployment, checkScaleDown, cleanupFailedNodes, startNodeWatcher, stopNodeWatcher } from "./nodeManager.js";
