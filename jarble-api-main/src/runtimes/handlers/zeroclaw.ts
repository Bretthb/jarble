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
 *   /data/config/config.toml    — Main configuration
 *
 * ZeroClaw env vars (different from OpenClaw):
 *   API_KEY          — LLM provider API key (not OPENROUTER_API_KEY)
 *   PROVIDER         — LLM provider name (not LLM_PROVIDER)
 *   ZEROCLAW_MODEL   — Model identifier (not LLM_MODEL)
 */

import type {
  RuntimeHandler,
  RuntimeCapabilities,
  ConfigFileSpec,
  ConfigFile,
  DeploymentFields,
  ParsedDeploymentFields,
} from "../types.js";

const capabilities: RuntimeCapabilities = {
  needsLlm: true,       // ZeroClaw supports 22+ AI providers
  hasPlatforms: true,
  hasSkills: false,
  hasSystemPrompt: false,
};

const configFiles: ConfigFileSpec[] = [
  { path: "config.toml", description: "Main configuration (TOML format)", isGlob: false },
];

export const zeroclawHandler: RuntimeHandler = {
  slug: "zeroclaw",
  name: "ZeroClaw",
  capabilities,
  configFiles,

  renderConfigs(deployment: DeploymentFields): ConfigFile[] {
    // ZeroClaw uses TOML configuration
    const lines = [
      "# ZeroClaw Configuration — Managed by Jarble AI Platform",
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

    return [{
      path: "config.toml",
      content: lines.join("\n") + "\n",
    }];
  },

  parseConfigs(files: ConfigFile[]): ParsedDeploymentFields {
    // ZeroClaw config.toml parsing — minimal for now
    // Future: parse TOML and extract relevant fields
    return {};
  },

  getSecretEntries(deployment: DeploymentFields): Record<string, string> {
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

    return entries;
  },

  validateCreate(input: Partial<DeploymentFields>): string | null {
    // ZeroClaw needs an API key when using BYOK mode (same as OpenClaw)
    if (input.llmMode === "byok" && !input.llmApiKey) {
      return "ZeroClaw requires an LLM API key when using Bring Your Own Key mode";
    }
    return null;
  },
};
