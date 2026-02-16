/**
 * OpenClaw Runtime Handler
 *
 * OpenClaw is a WhatsApp/multi-platform AI chatbot runtime.
 * It requires LLM configuration (provider, model, API key) and
 * stores its personality/system prompt in soul.md on the PVC.
 *
 * Config files on PVC:
 *   /data/soul.md          — System prompt / personality
 *   /data/skills/*         — Skill definitions (future)
 *   /data/platforms/*      — Platform credentials (future)
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
  needsLlm: true,
  hasPlatforms: true,
  hasSkills: true,
  hasSystemPrompt: true,
};

const configFiles: ConfigFileSpec[] = [
  { path: "soul.md", description: "System prompt / personality", isGlob: false },
  // Future:
  // { path: "skills/*", description: "Skill definitions", isGlob: true },
  // { path: "platforms/*", description: "Platform credentials", isGlob: true },
];

export const openclawHandler: RuntimeHandler = {
  slug: "openclaw",
  name: "OpenClaw",
  capabilities,
  configFiles,

  renderConfigs(deployment: DeploymentFields): ConfigFile[] {
    const files: ConfigFile[] = [];

    // soul.md — system prompt / personality
    if (deployment.systemPrompt) {
      files.push({
        path: "soul.md",
        content: deployment.systemPrompt,
      });
    }

    // Future: render skills/*.json from DB skills data
    // Future: render platforms/*.yaml from DB platform credentials

    return files;
  },

  parseConfigs(files: ConfigFile[]): ParsedDeploymentFields {
    const result: ParsedDeploymentFields = {};

    const soulMd = files.find((f) => f.path === "soul.md");
    if (soulMd) {
      result.systemPrompt = soulMd.content;
    }

    // Future: parse skills, platforms

    return result;
  },

  getSecretEntries(deployment: DeploymentFields): Record<string, string> {
    const entries: Record<string, string> = {};

    if (deployment.llmApiKey) {
      entries["OPENROUTER_API_KEY"] = deployment.llmApiKey;
    }
    if (deployment.llmProvider) {
      entries["LLM_PROVIDER"] = deployment.llmProvider;
    }
    if (deployment.llmModel) {
      entries["LLM_MODEL"] = deployment.llmModel;
    }

    return entries;
  },

  validateCreate(input: Partial<DeploymentFields>): string | null {
    // OpenClaw needs LLM configuration when using BYOK mode.
    // "included" mode auto-provisions via OpenRouter — no key needed from user.
    if (input.llmMode === "byok" && !input.llmApiKey) {
      return "OpenClaw requires an LLM API key when using Bring Your Own Key mode";
    }
    return null;
  },
};
