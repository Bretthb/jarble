/**
 * ZeroClaw Runtime Handler
 *
 * ZeroClaw is a Rust-based autonomous AI assistant framework (~3.4MB binary).
 * Supports 22+ AI providers, SQLite with hybrid search, modular architecture.
 * Uses TOML for configuration.
 *
 * Upstream: https://github.com/openagen/zeroclaw
 * GHCR:    ghcr.io/theonlyhennygod/zeroclaw:latest (upstream)
 *          ghcr.io/jarble-ai/zeroclaw:latest (Jarble-wrapped)
 *
 * Config files on PVC:
 *   /data/config/config.toml    - Main configuration
 *
 * ZeroClaw env vars (different from OpenClaw):
 *   API_KEY          - LLM provider API key (not OPENROUTER_API_KEY)
 *   PROVIDER         - LLM provider name (not LLM_PROVIDER)
 *   ZEROCLAW_MODEL   - Model identifier (not LLM_MODEL)
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
import { PLATFORM_ENV_MAP } from "../../trpc/routers/platformCredentials.js";

const log = createModuleLogger("runtime:zeroclaw");

const capabilities: RuntimeCapabilities = {
  needsLlm: true,       // ZeroClaw supports 22+ AI providers
  hasPlatforms: true,
  hasSkills: false,
  hasSystemPrompt: false,
  // JAR-119 Phase 2 — capability flags
  // ZeroClaw does not emit canvas blocks; text-only chat in the workspace.
  nativeCanvas: false,
  // Changing PROVIDER / *_API_KEY env vars requires re-launching the
  // gateway binary, so model swaps are restart-based in v1. A future
  // patch could move LLM creds to a hot-reloadable config file.
  modelSwitch: "restart",
  // JAR-120 Phase 3 — ingress descriptor
  // ZeroClaw's gateway listens on 3000 (our Dockerfile override; upstream
  // default is 42617). Auth is a pairing-code → Bearer flow (JAR-123 spike
  // will verify automation). No iframe-specific middleware needed yet
  // since the Control Panel v1 for ZeroClaw will use text-only fallback.
  ingress: {
    port: 3000,
    authStrategy: "bearer-header",
  },
};

// JAR-119 Phase 2 — probe override.
// Upstream ZeroClaw only ships an exec-based health check (`zeroclaw doctor`)
// and does not document an HTTP /healthz endpoint. Use a TCP-socket probe
// against the gateway port — sufficient to verify the binary has finished
// booting and the Axum listener is accepting connections. JAR-123 may
// refine this once the real HTTP health path is confirmed upstream.
function getProbes(ctx: { port: number }) {
  return {
    liveness: {
      tcpSocket: { port: ctx.port },
      initialDelaySeconds: 30,
      periodSeconds: 30,
      timeoutSeconds: 5,
      failureThreshold: 3,
    },
    readiness: {
      tcpSocket: { port: ctx.port },
      initialDelaySeconds: 5,
      periodSeconds: 5,
      timeoutSeconds: 3,
      failureThreshold: 3,
    },
  };
}

const configFiles: ConfigFileSpec[] = [
  { path: "config.toml", description: "Main configuration (TOML format)", isGlob: false },
];

export const zeroclawHandler: RuntimeHandler = {
  slug: "zeroclaw",
  name: "ZeroClaw",
  capabilities,
  configFiles,
  getProbes,
  // JAR-120 Phase 3 — default topology for ZeroClaw.
  topology: {
    kind: "k8s-deployment",
    containerName: "zeroclaw",
    pvcMountPath: "/data",
  },

  renderConfigs(deployment: DeploymentFields): ConfigFile[] {
    log.debug({ deploymentId: deployment.name }, "renderConfigs");
    // ZeroClaw uses TOML configuration
    const lines = [
      "# ZeroClaw Configuration - Managed by Jarble AI Platform",
      "# See https://github.com/openagen/zeroclaw for full options",
      "",
      "[agent]",
      `name = "${deployment.name}"`,
    ];

    if (deployment.description) {
      lines.push(`description = "${deployment.description}"`);
    }

    lines.push("");
    lines.push("[provider]");
    lines.push(`default = "${deployment.llmProvider || "openrouter"}"`);

    const files = [{
      path: "config.toml",
      content: lines.join("\n") + "\n",
    }];
    log.info({ fileCount: files.length }, "renderConfigs complete");
    return files;
  },

  parseConfigs(files: ConfigFile[]): ParsedDeploymentFields {
    // ZeroClaw config.toml parsing - minimal for now
    // Future: parse TOML and extract relevant fields
    return {};
  },

  getSecretEntries(deployment: DeploymentFields): Record<string, string> {
    log.debug({ provider: deployment.llmProvider }, "getSecretEntries");
    // ZeroClaw uses different env var names than OpenClaw
    const entries: Record<string, string> = {};

    if (deployment.llmApiKey) {
      entries["API_KEY"] = deployment.llmApiKey;
    }
    if (deployment.llmProvider) {
      entries["PROVIDER"] = deployment.llmProvider;
    }
    if (deployment.llmModel) {
      entries["ZEROCLAW_MODEL"] = deployment.llmModel;
    }

    // Platform credential env vars (ZeroClaw uses env vars only, no openclaw.json)
    if (deployment.platformCredentials) {
      for (const [platformId, creds] of Object.entries(deployment.platformCredentials)) {
        const envMap = PLATFORM_ENV_MAP[platformId];
        if (!envMap) continue;

        for (const [fieldKey, envVarName] of Object.entries(envMap)) {
          if (creds[fieldKey]) {
            entries[envVarName] = creds[fieldKey];
          }
        }
      }
    }

    // User/agent-defined deployment secrets — lowest priority (cannot overwrite system entries)
    if (deployment.deploymentSecrets) {
      for (const [key, value] of Object.entries(deployment.deploymentSecrets)) {
        if (!entries[key]) {
          entries[key] = value;
        }
      }
    }

    log.debug({ entryCount: Object.keys(entries).length }, "getSecretEntries complete");
    return entries;
  },

  validateCreate(input: Partial<DeploymentFields>): string | null {
    // ZeroClaw needs an API key when using BYOK mode (same as OpenClaw)
    if (input.llmMode === "byok" && !input.llmApiKey) {
      const error = "ZeroClaw requires an LLM API key when using Bring Your Own Key mode";
      log.warn({ error }, "validateCreate failed");
      return error;
    }
    return null;
  },
};
