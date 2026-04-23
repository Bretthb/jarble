/**
 * Echo Runtime Handler
 *
 * A minimal no-op "echo" runtime used as JAR-101's plug-and-play validation.
 * When a message is sent to an echo deployment, the runtime responds with a
 * fixed acknowledgement (the actual pod-side echo server is a separate image;
 * this handler only wires the deployment into the platform).
 *
 * The point of this handler is to prove that adding a new runtime is a pure
 * handler-file addition — no platform plumbing changes required. It deliberately
 * opts OUT of everything that isn't strictly required:
 *
 *   - No LLM (needsLlm: false).
 *   - No messaging platforms (hasPlatforms: false).
 *   - No skills (hasSkills: false).
 *   - No system prompt (hasSystemPrompt: false).
 *   - No native canvas (nativeCanvas: false).
 *   - No native UI (nativeUi undefined → text-only chat in the workspace).
 *   - Chat transport is http-stream (the generic adapter path).
 *
 * Config files on PVC:
 *   /data/echo.json — trivial deployment metadata, just so there is SOMETHING
 *                     to read back during reverse config sync.
 *
 * Image: ghcr.io/jarble-ai/echo:latest (separate work — not part of this ticket).
 *        The AC for JAR-101 is platform-plumbing only; the actual pod can be
 *        stubbed out until the image ships.
 */

import type {
  RuntimeHandler,
  RuntimeCapabilities,
  ConfigFileSpec,
  ConfigFile,
  DeploymentFields,
  ParsedDeploymentFields,
} from "../types.js";
import { createModuleLogger } from "../../utils/logger.js";

const log = createModuleLogger("runtime:echo");

const capabilities: RuntimeCapabilities = {
  needsLlm: false,
  hasPlatforms: false,
  hasSkills: false,
  hasSystemPrompt: false,
  nativeCanvas: false,
  modelSwitch: "restart",
  chatTransport: "http-stream",
  // No ingress / nativeUi — the workspace falls through to text-only chat.
};

const configFiles: ConfigFileSpec[] = [
  { path: "echo.json", description: "Echo deployment metadata", isGlob: false },
];

export const echoHandler: RuntimeHandler = {
  slug: "echo",
  name: "Echo",
  capabilities,
  configFiles,
  topology: {
    kind: "k8s-deployment",
    containerName: "echo",
    pvcMountPath: "/data",
  },

  renderConfigs(deployment: DeploymentFields): ConfigFile[] {
    log.debug({ deploymentId: deployment.id }, "renderConfigs");
    // Write a tiny JSON blob with the deployment's name. Enough to prove the
    // reverse-sync path exercises this handler's parseConfigs, nothing more.
    const payload = {
      name: deployment.name,
      description: deployment.description ?? null,
    };
    return [
      {
        path: "echo.json",
        content: JSON.stringify(payload, null, 2) + "\n",
      },
    ];
  },

  parseConfigs(files: ConfigFile[]): ParsedDeploymentFields {
    // The echo runtime stores nothing that needs to flow back into DB fields
    // (no system prompt, no LLM config). Always returns an empty delta — the
    // file on PVC exists for observability/debug only.
    const found = files.find((f) => f.path === "echo.json");
    if (found) {
      try {
        JSON.parse(found.content);
      } catch (err) {
        log.warn({ err: err instanceof Error ? err.message : String(err) },
          "echo.json failed to parse — ignoring");
      }
    }
    return {};
  },

  getSecretEntries(_deployment: DeploymentFields): Record<string, string> {
    // No LLM, no platforms, no runtime-internal auth. The K8s layer's base
    // entries (DEPLOYMENT_ID, USER_ID, DEPLOYMENT_NAME, TEMPLATE, RUNTIME)
    // are enough.
    return {};
  },

  validateCreate(_input: Partial<DeploymentFields>): string | null {
    // Anything goes. The echo runtime has no required fields beyond what
    // the deployment router itself enforces (name, etc.).
    return null;
  },
};
