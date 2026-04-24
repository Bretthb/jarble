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

  // ─── JAR-119 — Phase 2 capability flags ─────────────────────────────
  /**
   * Whether the runtime emits canvas blocks natively (rich UI components
   * rendered inline in chat). When false, the workspace falls through to
   * a text-only rendering path for this runtime's chat stream.
   * OpenClaw: true. ZeroClaw and most text-only runtimes: false.
   */
  nativeCanvas: boolean;

  /**
   * Optional canvas-block postMessage protocol name. If set, the workspace
   * listens for `type === canvasProtocol` events on the runtime's iframe
   * and dispatches them into the CanvasActionContext.
   * OpenClaw: "jarble:ui_block". Other runtimes: typically undefined.
   */
  canvasProtocol?: string;

  /**
   * How the pod handles a change to provider / model / API key at runtime.
   *   "hot"      — The runtime can swap models without a restart; the
   *                API writes the new config and the runtime picks it up.
   *   "restart"  — The pod must be rolled (scale 0 → 1) for the change
   *                to take effect. This is the current OpenClaw behavior.
   *   "recreate" — The pod must be fully torn down and re-created (e.g.
   *                the model is baked into the image or into a PVC
   *                initialization path that cannot be re-run cleanly).
   *
   * Dispatched by services/configSync.ts. The lifecycle layer uses this
   * to decide whether to trigger a deployment restart or just write the
   * new config.
   */
  modelSwitch: "hot" | "restart" | "recreate";

  // ─── JAR-120 — Phase 3 capability additions ──────────────────────────
  /**
   * How the platform should wire up ingress + auth for this runtime's
   * per-deployment pod.
   *
   * - `port`: the HTTP port the gateway listens on inside the pod
   *   (replaces the hard-coded 18789 in k8s/lifecycle.ts).
   * - `authStrategy`: which Traefik forward-auth flow to attach.
   *   - `"gateway-token"` — OpenClaw's Ed25519-signed cookie flow via
   *     `jarble-agent-forward-auth@kubernetescrd` (current default).
   *   - `"bearer-header"` — runtime accepts `Authorization: Bearer` and
   *     the platform provisions a token at boot (e.g. ZeroClaw pairing).
   *   - `"none"` — no platform-side auth; the runtime handles its own.
   * - `extraMiddlewares`: additional Traefik middleware refs appended
   *   after the auth strategy (e.g. `jarble-strip-frame-deny` for
   *   runtimes that need iframe-friendly headers).
   *
   * Undefined means "use the current OpenClaw defaults" — this keeps
   * every existing deployment working without a migration.
   */
  ingress?: {
    port: number;
    authStrategy: "gateway-token" | "bearer-header" | "none";
    extraMiddlewares?: string[];
  };

  // ─── JAR-121 — Phase 4 capability additions ──────────────────────────
  /**
   * Primary chat transport the runtime speaks. Dispatched by the
   * ChatAdapter registry at `src/chat/adapters/`.
   *
   * - `"openclaw-ws"` — OpenClaw's WS-first chain (WS gateway → HTTP
   *   fallback → exec fallback with Ed25519 gateway token).
   * - `"http-stream"` — Plain HTTP + SSE streaming, Bearer auth. Used
   *   by ZeroClaw, LangGraph server, Dify, most modern agent runtimes.
   * - `"none"` — Runtime does not accept chat over HTTP (e.g. a
   *   messaging-only runtime). The workspace surfaces a "chat via
   *   external platform" state.
   */
  chatTransport: "openclaw-ws" | "http-stream" | "none";

  /**
   * Whether the runtime ships its own web UI that the platform should
   * iframe into the Workspace's Control Panel tab. Undefined means the
   * Control Panel falls back to the text-only chat path.
   *
   * - `mode`: `"iframe"` embeds the runtime UI inline. `"redirect"`
   *   opens it in a new tab. `"none"` disables the Control Panel tab
   *   entirely.
   * - `pathResolver(deployment)`: returns the URL path (relative to
   *   the deployment's subdomain) where the native UI is served.
   *   OpenClaw: `/admin/`. ZeroClaw: `/`.
   * - `authHandoff`: how the parent hands an auth token to the iframe.
   *   - `"url-hash-token"` — token passed in `#token=…` fragment
   *     (OpenClaw's current flow).
   *   - `"cookie"` — signed session cookie set by the parent page
   *     (used by the inline Control Panel in `app/d/[id]/page.tsx`).
   *   - `"bearer-header"` — token injected into an `Authorization:
   *     Bearer` header on the first iframe request (needs a reverse
   *     proxy; used by bearer-auth runtimes like ZeroClaw).
   *   - `"none"` — no auth handoff; the runtime handles its own.
   * - `postMessageProtocol`: optional — the `type` string the iframe
   *   emits when posting canvas blocks to the parent. Wired to the
   *   `canvasProtocol` capability (JAR-119).
   *
   * ## Important constraint — dual-handoff OpenClaw
   *
   * OpenClaw is rendered through TWO auth-handoff paths in production
   * today (`ControlPanel.tsx` uses `url-hash-token`; the inline iframe
   * in `app/d/[id]/page.tsx` uses `cookie`). `NativeUiHost` must
   * support both modes at day one or one of the paths regresses.
   */
  nativeUi?: {
    mode: "iframe" | "redirect" | "none";
    pathResolver(deployment: DeploymentFields): string;
    authHandoff: "url-hash-token" | "cookie" | "bearer-header" | "none";
    postMessageProtocol?: string;
  };
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
   * JAR-120 — default deployment topology for this runtime.
   *
   * - `kind`: `"k8s-deployment"` (plain K8s Deployment + Service) or
   *   `"operator-crd"` (a custom-resource-based deployment, e.g.
   *   OpenClaw's OpenClawInstance CRD).
   * - `operatorGroupVersion`: required when `kind === "operator-crd"`.
   *   Format: `"group/version"`, e.g. `"openclaw.rocks/v1alpha1"`.
   * - `containerName`: the container name inside the pod (used by
   *   `kubectl exec`, log tailing, etc.).
   * - `pvcMountPath`: where `/data` is mounted inside the pod.
   *
   * OpenClaw's existing legacy/operator branching is keyed on the
   * per-deployment `managedBy` DB column — that column survives as an
   * override. When unset, the K8s layer uses this `topology` default.
   */
  readonly topology: RuntimeTopology;

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
   *
   * ## JAR-120 — split helpers (optional)
   *
   * `getSecretEntries` is the default aggregator. Handlers MAY also
   * implement `getLlmSecrets` / `getRuntimeSecrets` / `getPlatformSecrets`
   * as a structured split. When present, the K8s layer can compose the
   * aggregate via the splits and / or inspect them in isolation.
   *
   * The split is useful for two cases:
   *  1. Non-LLM runtimes returning `{}` from `getLlmSecrets` (so the
   *     K8s Secret does not get `LLM_*` envs unnecessarily).
   *  2. Platform-side audits (e.g. "how many runtimes use Anthropic?")
   *     can inspect `getLlmSecrets` output without reading unrelated
   *     gateway / platform credentials.
   *
   * When only `getSecretEntries` is implemented, the splits are treated
   * as empty — existing OpenClaw behavior is preserved.
   */
  getSecretEntries(deployment: DeploymentFields): Record<string, string>;

  /**
   * Optional — LLM provider / model / API-key envs. When present, the
   * K8s layer may compose the Secret from {llm, runtime, platform}
   * splits rather than relying on the flat `getSecretEntries`.
   * OpenClaw: OPENROUTER_API_KEY, LLM_PROVIDER, LLM_MODEL.
   * Non-LLM runtimes: `{}`.
   */
  getLlmSecrets?(deployment: DeploymentFields): Record<string, string>;

  /**
   * Optional — runtime-internal envs that are not LLM and not platform
   * credentials (e.g. OpenClaw's GATEWAY_TOKEN, ZeroClaw's PROVIDER).
   */
  getRuntimeSecrets?(deployment: DeploymentFields): Record<string, string>;

  /**
   * Optional — platform-credential envs (Discord / Telegram / WhatsApp
   * tokens). OpenClaw maps these via `platformCredentials` on the
   * deployment row. Runtimes without messaging can return `{}`.
   */
  getPlatformSecrets?(deployment: DeploymentFields): Record<string, string>;

  /**
   * Validate deployment input at creation time.
   * Returns null if valid, or an error message string if invalid.
   *
   * Example: OpenClaw requires llmApiKey when llmMode is "byok".
   * ZeroClaw has no special requirements and always returns null.
   */
  validateCreate(input: Partial<DeploymentFields>): string | null;

  /**
   * Optional per-runtime K8s probe configuration.
   *
   * When undefined, the lifecycle layer uses its default probe shape
   * (currently an `httpGet: /healthz` probe on the runtime container
   * at the gateway port).
   *
   * When defined, the returned object's `liveness` / `readiness` /
   * `startup` probes are used verbatim in the pod spec. Handlers that
   * only want to change one probe can return just that key — the
   * lifecycle layer falls back to the default for unset probes.
   *
   * The `ctx.port` argument is the gateway port the lifecycle layer
   * computed from `RUNTIME_PORTS` / `config.containerPort`. Handlers
   * should use it rather than hard-coding a port so port overrides
   * continue to work.
   *
   * Runtime-agnostic probe shape (`RuntimeProbe`) keeps this module
   * free of `@kubernetes/client-node` imports; the lifecycle layer
   * coerces to `V1Probe` at the call site.
   */
  getProbes?(ctx: { port: number }): {
    liveness?: RuntimeProbe;
    readiness?: RuntimeProbe;
    startup?: RuntimeProbe;
  };

  /**
   * JAR-99 LOW #2 — terminal-session cosmetics. The in-pod terminal route
   * (routes/terminal.ts) used to hardcode `openclaw` in the banner / alias
   * / prompt regardless of the deployment's runtime. These three optional
   * hooks let a runtime customize its terminal without the route knowing
   * slug-specific details. All three default to a generic `runtime>`
   * prompt and no alias when undefined, which is the correct behavior for
   * ZeroClaw and any future runtime that doesn't ship its own CLI.
   */
  /** Multi-line bash fragment to print on shell startup (welcome / usage). */
  getTerminalBanner?(): string | null;
  /**
   * Bash alias line (e.g. `alias openclaw='/opt/openclaw/node_modules/.bin/openclaw'`).
   * Return null to skip setting any alias.
   */
  getShellAlias?(): string | null;
  /** Prompt label shown in PS1 (e.g. "openclaw"). Defaults to "runtime". */
  getPromptLabel?(): string;

  /**
   * JAR-99 LOW #3 — in-pod diagnostic probes. The /diagnose route dispatches
   * to this method when set; runtimes that don't override it return no
   * additional checks and the route relies on its runtime-agnostic signals
   * (pod status, LLM key configured, etc.) alone. Implementations own the
   * exec calls into the pod and parse the output into the `DiagnosticCheck`
   * shape. Must not throw — return an `{ name, status: "error", detail }`
   * entry for any fatal condition instead.
   */
  runDiagnostics?(ctx: {
    podName: string;
    managedBy: "legacy" | "operator";
  }): Promise<RuntimeDiagnosticCheck[]>;
}

/**
 * Runtime-emitted diagnostic row for the /diagnose route.
 * Matches the route's existing DiagnosticCheck shape.
 */
export interface RuntimeDiagnosticCheck {
  name: string;
  status: "ok" | "warning" | "error" | "skipped";
  detail: string;
  suggestion?: string;
}

/**
 * Runtime deployment topology (JAR-120).
 * Declarative shape the K8s layer dispatches on instead of the
 * legacy per-deployment `managedBy` branch.
 */
export interface RuntimeTopology {
  kind: "k8s-deployment" | "operator-crd";
  operatorGroupVersion?: string;
  containerName: string;
  pvcMountPath: string;
}

/**
 * Runtime-agnostic K8s probe shape. Kept loose on purpose so this module
 * doesn't depend on @kubernetes/client-node. The lifecycle layer coerces
 * these into V1Probe at the call site (JAR-119).
 */
export interface RuntimeProbe {
  httpGet?: {
    path: string;
    port: number | string;
    scheme?: "HTTP" | "HTTPS";
  };
  exec?: { command: string[] };
  tcpSocket?: { port: number | string };
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  failureThreshold?: number;
  successThreshold?: number;
}
