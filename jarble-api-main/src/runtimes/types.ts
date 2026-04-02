/**
 * ═══════════════════════════════════════════════════════════════════════
 * Runtime Handler Types - Defines the strategy pattern for runtime-specific
 * config rendering, validation, and K8s Secret generation.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * Every runtime (OpenClaw, ZeroClaw, etc.) implements the RuntimeHandler
 * interface. The registry in index.ts maps slug → handler, and the
 * deployment router + K8s layer call into handlers at key lifecycle points.
 *
 * HOW TO ADD A NEW RUNTIME:
 *   1. Create src/runtimes/handlers/yourruntime.ts implementing RuntimeHandler
 *   2. Import and register it in src/runtimes/index.ts
 *   That's it - the deployment router and K8s layer pick it up automatically.
 */

// ─── Config File Types ────────────────────────────────────────────────

/**
 * A config file to be written to or read from a deployment's PVC.
 * `path` is relative to /data/ (the PVC mount point).
 */
export interface ConfigFile {
  path: string;    // e.g. "soul.md", "config.yaml", "skills/search.json"
  content: string; // Rendered file content
}

/**
 * Metadata about a config file that a runtime manages on the PVC.
 * Used for discovery (which files to read back during reverse sync)
 * and for UI/API documentation.
 */
export interface ConfigFileSpec {
  path: string;        // Relative to /data/, e.g. "soul.md" or "skills/*"
  description: string; // Human-readable description
  isGlob: boolean;     // If true, path is a glob pattern (e.g. "skills/*")
}

// ─── Deployment Field Types ───────────────────────────────────────────

/**
 * A typed subset of the deployments DB row, used as input to handlers.
 * Keeps handlers decoupled from Drizzle schema types.
 */
export interface DeploymentFields {
  id: string;
  runtime: string;
  name: string;
  description: string | null;
  systemPrompt: string | null;
  llmMode: string;
  llmProvider: string;
  llmModel: string | null;
  llmApiKey: string | null;
  /** Platform credentials: { platformId: { fieldKey: value } } e.g. { discord: { botToken: "..." } } */
  platformCredentials?: Record<string, Record<string, string>>;
  /** Gateway auth token for OpenClaw WS auth - generated at deploy time, stored in K8s Secret */
  gatewayToken?: string;
  /** If true, deployment only uses messaging platforms (no web chat) - enables condensed prompt */
  messagingOnly?: boolean;
  /** Management mode: "legacy" (K8s Deployment) or "operator" (OpenClaw CRD). Affects PVC paths. */
  managedBy?: "legacy" | "operator";
  /** Installed skills: array of { name, config } from deploymentSkills + skillsCatalog join */
  skills?: Array<{ name: string; config: string }>;
  /** Instruction snippets from installed packages - appended to soul.md */
  packageSnippets?: Array<{ packageName: string; snippet: string }>;
  /**
   * Remote skill proxy configs from remote/hybrid package installs.
   * Each entry describes a skill that should route through the Jarble proxy
   * rather than calling the skill's default endpoint directly.
   */
  remoteSkillConfigs?: Array<{
    packageId: string;
    skillName: string;
    proxyUrl: string;
  }>;
  /** Installed marketplace components - included in soul.md so the bot knows what's available */
  installedComponents?: Array<{
    name: string;
    displayName: string;
    description: string;
    botDescription: string | null;
    tier: string;
    category: string;
  }>;
  /** User-configured subagents for this deployment - rendered as MCP tools + soul.md section */
  subagents?: Array<{
    slug: string;
    name: string;
    description: string | null;
    systemPrompt: string;
    model: string | null;
    triggerType: string;
    triggerConfig: string | null;
    tools: string | null;
    source?: string;  // "custom" | "platform" | "delegation" - undefined treated as "custom" for backward compat
  }>;
  /** User/agent-defined deployment secrets: { envVarName: decryptedValue } — injected as pod env vars */
  deploymentSecrets?: Record<string, string>;
  /** Team members from Bot Teams flows - other deployments linked via flow_deployment_memberships */
  teamMembers?: Array<{
    deploymentId: string;
    name: string;
    role: string | null;
    slug: string;
  }>;
}

/**
 * Partial DB fields returned from parsing PVC config files.
 * Only includes fields that the parsed config can populate.
 * Undefined fields mean "no change" (not "clear the value").
 */
export interface ParsedDeploymentFields {
  systemPrompt?: string;
  llmProvider?: string;
  llmModel?: string;
  /** Platform credentials parsed from config files: { platformId: { fieldKey: value } } */
  platformCredentials?: Record<string, Record<string, string>>;
  // Future: skills, etc.
  // Note: llmApiKey is NEVER parsed from config files (security)
}

// ─── Runtime Capabilities ─────────────────────────────────────────────

/**
 * Declares what features a runtime supports.
 * Used for validation (skip LLM validation for runtimes that don't need it),
 * API response enrichment, and frontend capability queries.
 */
export interface RuntimeCapabilities {
  needsLlm: boolean;        // Requires LLM provider/model/key
  hasPlatforms: boolean;     // Has platform credentials (WhatsApp, Discord, etc.)
  hasSkills: boolean;        // Has a skills marketplace
  hasSystemPrompt: boolean;  // Uses a system prompt / personality config
}

// ─── Runtime Handler Interface ────────────────────────────────────────

/**
 * The core interface every runtime must implement.
 * Handlers are pure transformation layers - they don't own data or
 * interact with the DB/K8s directly. The deployment router and K8s
 * layer call handler methods and act on the results.
 */
export interface RuntimeHandler {
  /** Runtime slug - must match runtime_catalog.slug and deployments.runtime */
  readonly slug: string;

  /** Human-readable name */
  readonly name: string;

  /** What this runtime supports */
  readonly capabilities: RuntimeCapabilities;

  /** Config file specs (for discovery / reading back from PVC) */
  readonly configFiles: ConfigFileSpec[];

  /**
   * Render DB fields into config files to write to the PVC.
   * Returns an array of files with their paths and contents.
   * Called on: deployment create, config update from frontend.
   */
  renderConfigs(deployment: DeploymentFields): ConfigFile[];

  /**
   * Parse config file contents back into DB fields.
   * Called on: reverse sync (reading PVC files back to DB).
   * Returns only the fields that should be updated.
   */
  parseConfigs(files: ConfigFile[]): ParsedDeploymentFields;

  /**
   * Build additional K8s Secret stringData entries for this runtime.
   * The base entries (DEPLOYMENT_ID, USER_ID, DEPLOYMENT_NAME, TEMPLATE,
   * RUNTIME) are always included by the K8s layer. This method returns
   * ADDITIONAL entries specific to this runtime.
   *
   * Example: OpenClaw needs OPENROUTER_API_KEY, LLM_PROVIDER, LLM_MODEL.
   */
  getSecretEntries(deployment: DeploymentFields): Record<string, string>;

  /**
   * Validate deployment input at creation time.
   * Returns null if valid, or an error message string if invalid.
   *
   * Example: OpenClaw requires llmApiKey when llmMode is "byok".
   * ZeroClaw has no special requirements and always returns null.
   */
  validateCreate(input: Partial<DeploymentFields>): string | null;
}
