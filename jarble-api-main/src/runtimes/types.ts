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
  /**
   * Long-term memory scoping mode for the bot's MCP memory tools.
   *   "global"  — current behavior, memory persists across all chat sessions
   *               and platforms (default; soul.md advertises cross-platform memory).
   *   "session" — memory partitioned per Jarble chat session/conversationId.
   *               soul.md tells the bot not to recall cross-session.
   *   "off"     — memory tools removed from soul.md entirely.
   * See docs/audits/memory-scoping-decision.md.
   */
  memoryScope?: "global" | "session" | "off";
  /** Management mode: "legacy" (K8s Deployment) or "operator" (OpenClaw CRD). Affects PVC paths. */
  managedBy?: "legacy" | "operator";
  /** Installed skills: array of { name, config } from deploymentSkills + skillsCatalog join */
  skills?: Array<{ name: string; config: string }>;
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
  /**
   * Team context from Bot Teams flows.
   * Presence of this field enables the "Team Context" section in soul.md
   * (rendered by openclaw.ts:renderConfigs). It captures the deployment's role
   * in a flow plus its teammates so the bot can delegate intelligently.
   *
   * Populated by configSync.ts:buildDeploymentFields() from
   * flow_deployment_memberships + orchestration_flows. Undefined when the
   * deployment is not part of any flow.
   *
   * v1: A deployment in multiple flows uses the first one (deterministic) —
   * multi-team rendering is a follow-up.
   */
  teamContext?: {
    /** The flow this deployment belongs to (used for logging / debug) */
    flowId: string;
    /** Human-readable flow name shown in soul.md */
    flowName: string;
    /** This deployment's role in the flow (e.g. "Pricing Specialist"). Null if no role set. */
    selfRole: string | null;
    /** True if this deployment is the entry point for the flow */
    isEntryPoint: boolean;
    /** Other deployments in the same flow (excluding self), deduplicated by deploymentId */
    teammates: Array<{
      deploymentId: string;
      name: string;
      role: string | null;
      slug: string;
    }>;
  };
  /**
   * @deprecated Use `teamContext.teammates` instead. Kept as a back-compat shim
   * for callers that have not been migrated; remove after configSync sweep.
   */
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

  /**
   * Whether this runtime supports native subagent execution.
   *
   * When true, subagent config is rendered as runtime-native agent definitions
   * and the API skips the legacy collectLlmCompletion interception path for
   * subagent delegations. When false/undefined, subagents use the legacy
   * API-side LLM call path.
   *
   * ## Contract for non-OpenClaw subagent models
   *
   * `DeploymentFields.subagents[]` is a platform-agnostic list of subagents
   * with slug / name / description / systemPrompt / model / triggerType /
   * triggerConfig / tools / source. A runtime may set
   * `supportsNativeSubagents: true` as long as its `renderConfigs()`
   * translates that list into whatever native shape the runtime expects.
   * Examples:
   *
   * - **OpenClaw** — renders subagents into `agents.list` + `sessions_spawn`
   *   MCP tool defs under `subagent-tools.json` (the reference implementation).
   * - **CrewAI-style runtime** — would render subagents as a `Crew` YAML with
   *   one `Agent` per entry, each with their own role + goal + tools.
   * - **AutoGen-style runtime** — would render subagents as the participant
   *   list of a `GroupChat` with system-prompt-per-agent.
   * - **Character-based runtime (e.g. ElizaOS)** — would render subagents as
   *   additional characters in the `character.json` multi-character setup.
   *
   * The flag is a declaration that the runtime handles subagent routing
   * itself. The API layer does not care how the runtime implements it —
   * it only stops intercepting delegation calls.
   *
   * When false or undefined, the API falls back to its own LLM-call path
   * for each subagent, using `DeploymentFields.subagents[]` entries as
   * prompts + tool lists. This is the default because not every runtime
   * has a native multi-agent primitive.
   */
  readonly supportsNativeSubagents?: boolean;

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
