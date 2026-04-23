# OpenClaw Leak Audit — JAR-99

_Generated 2026-04-22. Read-only audit; no code changed._

## Summary

- **14 leaks** across **13 files**. Severity breakdown: **6 HIGH**, **5 MEDIUM**, **3 LOW**.
- Existing abstractions (`RuntimeHandler`, `ChatAdapter` registry in `chat/adapters/`, `RuntimeCapabilities.ingress` / `chatTransport`) are already defined for most of these leaks but the API surface has not been migrated to use them. In several cases the runtime ships with a second handler (`zeroclaw.ts`) that declares the right capabilities, yet the call sites still hard-code OpenClaw behavior.
- **A ZeroClaw deployment attempting to start today would not work end-to-end**: botAsk, flowChat, tamboAgent, and the debug chat endpoint all import `chatViaGateway` / `chatViaHTTP` / `chatViaExec` directly from `services/openclawGateway.ts`, bypass the `getChatAdapter()` registry, and exec OpenClaw-specific CLI flags. The registry exists; nothing uses it yet.
- The **one finding to address first** (if budget-limited) is the chat-route cluster — HIGH #1. Routing `tamboAgent.ts` / `flowChat.ts` / `botAsk.ts` / `routes/debug.ts` / `a2aGateway.ts` / `chatWithBot.ts` MCP tool through `getChatAdapter()` unblocks every other HIGH because those files together account for every hot-path OpenClaw import.

## HIGH severity

### 1. `jarble-api-main/src/routes/tamboAgent.ts:42`, `src/routes/flowChat.ts:35`, `src/routes/botAsk.ts:17`, `src/routes/debug.ts:345`, `src/routes/a2aGateway.ts:213`, `src/mcp/tools/chatWithBot.ts:48-54` — chat routes hard-wire `openclawGateway`

**What it does**: Every chat-producing route imports `chatViaGateway` / `chatViaHTTP` / `chatViaExec` directly from `services/openclawGateway.ts` and exec's `npx openclaw agent …` in its fallback path (tamboAgent.ts:1990, flowChat.ts:35, botAsk.ts:17+152, debug.ts:345, a2aGateway.ts:213, chatWithBot.ts:48-54).
**Why it leaks**: These routes never consult `deployment.runtime` when picking a transport. A ZeroClaw deployment routed through any of them would attempt a WS handshake on port 18789 with an Ed25519 challenge that the Axum gateway does not speak, then fall back to `npx openclaw agent` inside the pod — which is not installed on a ZeroClaw image.
**Proposed fix**: (a) Route through the existing `getChatAdapter(deployment.runtime)` registry at `jarble-api-main/src/chat/adapters/index.ts:37-42`. The `openclaw-ws` adapter already wraps the existing helpers (see `chat/adapters/openclaw.ts`); the `http-stream` adapter stub exists for ZeroClaw. The JAR-121 comment in `chat/adapters/types.ts:22-26` explicitly flags the route migration as unfinished follow-up. JAR-99 is that follow-up.

### 2. `jarble-api-main/src/k8s/status.ts:293-294,317` — `getPodAddress` reads only OpenClaw's secret key

**What it does**: Resolves `ip/port/gatewayToken` for proxy routes by reading `OPENCLAW_GATEWAY_TOKEN` out of the deployment's K8s Secret and falling back to `RUNTIME_PORTS["openclaw"]` when no container port is declared.
**Why it leaks**: Any runtime that doesn't use the Ed25519-signed gateway-token auth (declared via `RuntimeCapabilities.ingress.authStrategy = "bearer-header"` on ZeroClaw) has no `OPENCLAW_GATEWAY_TOKEN` in its secret. ZeroClaw's auth is a pairing-code → Bearer token. The hardcoded fallback to port 18789 also overrides whatever the runtime handler declared.
**Proposed fix**: (a) Return a richer shape (e.g. `{ ip, port, auth: { strategy, token }}`) keyed on the deployment's runtime handler's `capabilities.ingress.authStrategy`; populate from per-runtime secret keys (OpenClaw reads `OPENCLAW_GATEWAY_TOKEN`, bearer runtimes read `GATEWAY_BEARER_TOKEN`, etc.). The secret-key naming is already runtime-specific today, so the fix is at the read site, not the write site.

### 3. `jarble-api-main/src/k8s/lifecycle.ts:238-240, 356-357` — base secret unconditionally writes OpenClaw keys

**What it does**: In both the operator and legacy createDeployment paths, the K8s Secret's base stringData includes `OPENCLAW_GATEWAY_TOKEN: gatewayToken` and (operator) `token: gatewayToken` alongside `DEPLOYMENT_ID` / `USER_ID` / `RUNTIME`. This is before merging `config.extraSecretEntries` from the runtime handler.
**Why it leaks**: Every runtime gets an `OPENCLAW_GATEWAY_TOKEN` env var, even ZeroClaw which doesn't recognize it. This is cosmetic for ZeroClaw today (it ignores unknown envs), but it does enforce a specific authentication shape: any runtime whose auth secret key is *not* `OPENCLAW_GATEWAY_TOKEN` has to shim around the base write in its `getSecretEntries`.
**Proposed fix**: (a) Move the token-generation + secret-write into the runtime handler. Add `getBaseSecrets(ctx: { gatewayToken })` to `RuntimeHandler`, or fold the token under `getRuntimeSecrets` split that already exists (types.ts:401). `lifecycle.ts` then writes the union of `{DEPLOYMENT_ID, USER_ID, DEPLOYMENT_NAME, TEMPLATE, RUNTIME}` + handler-declared entries — no OpenClaw defaults in the base path.

### 4. `jarble-api-main/src/k8s/lifecycle.ts:387-388, 546-580` — init-container + Open WebUI sidecar are baked into every deployment

**What it does**: The init script `mkdir -p /data/config /data/logs /data/.openclaw /data/components /data/files /data/skills /data/marketplace /data/open-webui` is invoked for every legacy-mode deployment. Lines 547-580 also unconditionally attach an Open WebUI sidecar that connects to `http://localhost:${gatewayPort}/v1` using the OpenClaw gateway token as its OpenAI API key.
**Why it leaks**: `/data/.openclaw` and `/data/skills` are OpenClaw-specific subdirectories (ZeroClaw uses `/data/config/config.toml`). The Open WebUI sidecar assumes the runtime's gateway serves an OpenAI-compatible `/v1/chat/completions` endpoint with bearer auth — an OpenClaw invariant. ZeroClaw has no such endpoint, so the sidecar will fail its readiness probe on every ZeroClaw pod.
**Proposed fix**: (a) Move both the PVC init-dir list and the Open WebUI sidecar opt-in onto the `RuntimeHandler`. A new `buildPodExtras(ctx: { gatewayPort, gatewayToken })` method could return `{ initDirs: string[], sidecars: V1Container[] }`. OpenClaw's handler returns the current list; ZeroClaw's returns `{ initDirs: ["/data/config"], sidecars: [] }`.

### 5. `jarble-api-main/src/services/configSync.ts:568-576, 1044-1082` — Tier-2 escalation + reload-signal are OpenClaw semantics

**What it does**: The tiered configSync executor (a) escalates from Tier 1 (file-only) to Tier 2 (process restart) when `openclaw.json` contains an `agents.list` entry, and (b) signals a gateway restart by touching `${pvcMount}/.reload` and `kill`-ing the PID read from `${pvcMount}/.openclaw.pid`.
**Why it leaks**: Both the escalation trigger ("does `openclaw.json` include agents.list?") and the restart protocol (`.reload` marker + `.openclaw.pid`) are defined by OpenClaw's entrypoint loop. A runtime that expects a different marker, a different config format, or no in-pod restart at all (e.g. K8s-triggered rollout) cannot participate.
**Proposed fix**: (a) Add an `onConfigChange(files: ConfigFile[]): { needsProcessRestart: boolean }` hook and a `signalProcessRestart(pod, containerName): Promise<boolean>` method to `RuntimeHandler`. The existing `ConfigFileSpec.isGlob` could be extended with a `hotReloadable` flag to drive the escalation, and `signalProcessRestart` moves into the OpenClaw handler verbatim.

### 6. `jarble-api-main/src/services/configSync.ts:1107, 1234`, `src/services/statusReconciler.ts:244` — MCP server hot-sync is hardcoded to the OpenClaw handler's exported `getMcpServerInfo`

**What it does**: `stageMcpServer`, `syncMcpServer`, `syncMcpServerToAllRunning`, and the 15-minute auto-sync cron in `statusReconciler.ts` all `await import("../runtimes/handlers/openclaw.js")` and call `getMcpServerInfo()` regardless of the target deployment's runtime.
**Why it leaks**: The "all running" sweep hits every deployment, not just OpenClaw ones. A ZeroClaw deployment will have the OpenClaw MCP server staged into its PVC — harmless but surprising — and the subsequent `signalGatewayRestart` (same file, line 1194) tries to touch OpenClaw's `.reload` marker on a ZeroClaw pod. The function also throws if the OpenClaw handler's MCP script is unavailable, which would break sync for *all* runtimes.
**Proposed fix**: (a) Gate the MCP sync on `handler.capabilities.nativeCanvas === true` (or a new `shipsJarbleUiMcpServer` capability) and have each handler declare its own `getMcpServerInfo()` via an optional `RuntimeHandler.getMcpServer?(): { content, hash } | null` method. The cross-handler helper in `configSync.ts` iterates registered handlers that return non-null.

## MEDIUM severity

### 1. `jarble-api-main/src/trpc/routers/platformCredentials.ts:18-37` — `PLATFORM_CREDENTIAL_KEYS` and `PLATFORM_ENV_MAP` are OpenClaw-specific

**What it does**: Two constant maps that encode (a) the JSON key shape OpenClaw expects inside `openclaw.json` channels (e.g. `discord.botToken → channels.discord.token`), and (b) the env var name each platform credential should be written as (`DISCORD_BOT_TOKEN`, etc.).
**Why it leaks**: Both maps bake in OpenClaw's layout — ZeroClaw's messaging-platform config shape is unknown today but will differ. The `PLATFORM_ENV_MAP` is also imported by `zeroclaw.ts:30` as a convenience, which couples the runtimes' platform-cred contracts.
**Proposed fix**: (a) Move these maps under each handler — `openclawHandler.getPlatformChannelMapping()` and `openclawHandler.getPlatformEnvMapping()`. The platformCredentials router calls `getHandler(deployment.runtime).getPlatformEnvMapping()` instead of the static constants. The router stays generic; runtimes own their own layouts.

### 2. `jarble-api-main/src/trpc/routers/platformCredentials.ts:283-342` — `pollTelegramPairing` exec's OpenClaw CLI directly

**What it does**: Finds a running pod for the deployment, then exec's `npx openclaw pairing list telegram --json` and `npx openclaw pairing approve telegram ${code} --notify` inside the pod to auto-approve pending Telegram pairing requests.
**Why it leaks**: The CLI invocation is only valid for OpenClaw. A ZeroClaw deployment polling Telegram would hit a `command not found` — but the caller treats the empty result as "waiting", so the user sees a silent spinner instead of a clean error.
**Proposed fix**: (c) This is plausibly OpenClaw-specific today — the Telegram pairing-approval protocol is OpenClaw's design. Either (a) add a `RuntimeHandler.approvePendingPairings?(pod: string, platform: string)` optional method that OpenClaw implements and other runtimes leave undefined (router returns `{ status: "unsupported" }` for them) or (c) narrow the endpoint to OpenClaw deployments only with an up-front `if (runtime !== "openclaw") return { status: "unsupported" }` guard and document it as such.

### 3. `jarble-api-main/src/routes/sse.ts:328-330, 258-281` — WhatsApp QR pairing hardcodes `npx openclaw channels login`

**What it does**: The streaming QR-pairing endpoint exec's `["npx", "openclaw", "channels", "login", "--channel", "whatsapp"]` inside the deployment's pod and uses heuristics on OpenClaw's QR output format ("successfully logged in", "whatsapp connected", "session saved") to detect pairing success.
**Why it leaks**: Only OpenClaw ships a Baileys-based WhatsApp loginflow. ZeroClaw has no equivalent — the endpoint would hang waiting for output that never comes. The heuristic strings are also OpenClaw log-message-specific.
**Proposed fix**: (a) Extract the pairing flow into a `RuntimeHandler.startPairingStream?(platform, pod, onLine): AbortController | null` optional method. The route's stream-exec is the default wrapper; runtimes without a pairing flow return `null` and the route replies with an "unsupported" error.

### 4. `jarble-api-main/src/trpc/routers/deployment/procedures2.ts:514-563, 583-608` — `updateOpenClawVersion` + `getPodConfig` parse OpenClaw-specific paths

**What it does**: (a) `updateOpenClawVersion` runs `npm install openclaw@${target}` inside `/opt/openclaw/` on the pod. (b) `getPodConfig` reads `${home}/.openclaw/openclaw.json` and parses `agents.defaults.model.primary` / `channels` to surface live pod config back to the frontend.
**Why it leaks**: Both procedures are tightly coupled to OpenClaw's pod filesystem layout and package layout. `getPodConfig` is exposed as a runtime-agnostic tRPC query but returns nulls for non-OpenClaw deployments today, not a structured "unsupported".
**Proposed fix**: (b) `updateOpenClawVersion` is legitimately OpenClaw-specific — rename to `updateRuntimeVersion` with a `handler.getVersionUpdateCommand?(target): string[]` hook and keep OpenClaw's CLI string in the handler. (a) For `getPodConfig`, promote it to a generic `handler.readLivePodConfig?(pod): Promise<{ model: string | null, channels: Record<string, { enabled: boolean }> | null }>` and have both handlers implement it. Alternative (c): scope the query to runtimes that declare a `livePodConfig` capability and guard the router on the declaration.

### 5. `jarble-api-main/src/services/deploymentCapabilities.ts:78-81` — `detectSupportsSubagents(runtime) === "openclaw"`

**What it does**: A helper that decides whether a deployment has runtime-native subagent orchestration by matching the runtime slug against the literal string `"openclaw"`.
**Why it leaks**: `RuntimeHandler.supportsNativeSubagents` already exists in `runtimes/types.ts:325` specifically for this. The helper ignores it.
**Proposed fix**: (a) Replace the literal check with `getHandlerOrNull(runtime)?.supportsNativeSubagents ?? false`. This is a two-line change and the cleanest quick win in the whole audit.

## LOW severity

### 1. `jarble-api-main/src/routes/tamboAgent.ts:1278` — env-var name `OPENCLAW_NATIVE_SUBAGENTS`

**What it does**: Controls whether tamboAgent skips the legacy subagent-delegation interception path with `deployment.runtime === "openclaw" && process.env.OPENCLAW_NATIVE_SUBAGENTS === "true"`.
**Why it leaks**: Combining a hardcoded `"openclaw"` slug with an env flag named after the runtime is cosmetic — the behavior still respects `supportsNativeSubagents`, it just gets there via the wrong door. A ZeroClaw deployment couldn't trigger this gate even if it declared `supportsNativeSubagents: true` in the future.
**Proposed fix**: (a) Replace the entire check with `handler.supportsNativeSubagents === true && process.env.RUNTIME_NATIVE_SUBAGENTS !== "false"`. The env var becomes a kill-switch, not an opt-in keyed on OpenClaw.

### 2. `jarble-api-main/src/routes/terminal.ts:203-246` — pod terminal prompts `openclaw>`

**What it does**: When the user opens the in-pod terminal, the bash startup banner prints `OpenClaw Terminal`, aliases `openclaw='/opt/openclaw/node_modules/.bin/openclaw'`, and sets the prompt to `openclaw> `.
**Why it leaks**: A ZeroClaw deployment's terminal would still say "OpenClaw Terminal". Purely cosmetic but user-facing.
**Proposed fix**: (a) Have `RuntimeHandler.getTerminalBanner?()` / `getShellAlias?()` / `getPromptLabel?()` supply the bash fragment; terminal route falls back to a generic `runtime>` prompt when undefined. (c) Alternatively accept the cosmetic leak and scope the terminal to OpenClaw deployments only.

### 3. `jarble-api-main/src/routes/diagnose.ts:238-429` — the `diagnose` route's ~200 lines of OpenClaw CLI probes

**What it does**: The in-pod diagnostics endpoint runs `cat /opt/openclaw/package.json`, `cat ${home}/.openclaw/openclaw.json`, `cat ${pvcMount}/.openclaw.pid`, `npx openclaw --help`, and `npx openclaw doctor`, then formats the output into a checks[] array shown in the UI.
**Why it leaks**: All five probes assume OpenClaw layout + binary. A ZeroClaw deployment's `/diagnose` view would show uniformly failing checks.
**Proposed fix**: (b) The *right* home for this is inside the runtime handler — e.g. `handler.runDiagnostics?(pod): Promise<DiagnosticCheck[]>` — and the route becomes a thin wrapper that dispatches. The OpenClaw-specific probe list moves verbatim into `openclaw.ts`; ZeroClaw can supply its own `zeroclaw doctor` equivalent later.

## Files that are CLEAN (already runtime-agnostic)

- `jarble-api-main/src/trpc/routers/openrouter.ts` — validates LLM provider keys by prefix / remote HTTP call; makes no OpenClaw assumption.
- `jarble-api-main/src/utils/memoryScope.ts` — soul.md memory section is rendered by the OpenClaw handler but the helper itself takes only `MemoryScope` + session id and emits prompt text; suitable for any prompt-driven runtime.
- `Jarble-mvp/views/onboarding/wizardStepConfig.ts` — the "openclaw" / "zeroclaw" keys on `RUNTIME_EXTRA_STEPS` / `RUNTIME_CONFIG_TABS` are **data, not assumptions**: the file is explicitly designed as a per-runtime config table and falls back to `DEFAULT_EXTRA_STEPS` / `DEFAULT_CONFIG_TABS` for unknown runtimes.
- `jarble-api-main/src/runtimes/types.ts` and `src/runtimes/index.ts` — the registry contract is the right shape; the leak is that callers bypass it.
- `jarble-api-main/src/k8s/constants.ts` — the `LEGACY_CONTAINER_NAME` / `OPERATOR_CONTAINER_NAME` / `LEGACY_PVC_MOUNT` / `OPERATOR_PVC_MOUNT` pair is dispatched through `getContainerName(managedBy)` / `getPvcMountPath(managedBy)`, which are correctly treated as runtime-topology primitives. The OpenClaw-ness is isolated to the constant values; callers are clean. (The `managedBy` field itself is documented as "OpenClaw CRD" in `runtimes/types.ts:71` — a LOW that isn't worth filing because the `topology.kind` declaration on handlers supersedes it.)
- `jarble-api-main/src/k8s/secrets.ts:40-47` — preserves `OPENCLAW_GATEWAY_TOKEN` across reconfig writes. Functionally coupled to HIGH #3 — once the base secret shape is runtime-driven, the preserve logic goes with it. Not a separate finding.
- `jarble-api-main/src/chat/adapters/*` (`index.ts`, `types.ts`, `openclaw.ts`, `httpStream.ts`) — this *is* the abstraction. The leak is that no one uses it (HIGH #1).
- `jarble-api-main/src/trpc/routers/deploymentSecrets.ts:20` — includes `OPENCLAW_GATEWAY_TOKEN` in `RESERVED_ENV_VARS`. Correct — users should never be able to override it via custom secrets regardless of runtime.
- `jarble-api-main/src/services/flowDelegation.ts:160-207` — the `sanitizeDelegationError` sanitizer hard-codes `npx openclaw agent` stripping. This is a sanitizer, not a behavior gate — extra runtime-specific patterns are additive. Legitimately safe.

## Side notes

- `services/configSync.ts:485` and `:543` and `:792` each independently re-read `OPENCLAW_GATEWAY_TOKEN` from the K8s Secret. If HIGH #3 lands, these three sites need to move to a generic `readCurrentGatewayToken(deployment)` helper or inherit from the handler's `getRuntimeSecrets` shape. They are not each independent bugs but they are independent "places to fix" once the abstraction settles.
- `routes/tamboAgent.ts:1461-1474` constructs an env-var visibility table for `listEnvVars` with an inline `providerEnvMap`. The same map (in the same shape) exists in `runtimes/handlers/openclaw.ts`. Consolidating into one source of truth is out of scope for this audit but worth noting as part of JAR-99 cleanup.
- `k8s/constants.ts:7` pins `DEFAULT_IMAGE` to `ghcr.io/jarble-ai/openclaw:latest`. Not a leak per se (handlers override via `config.image`), but production deployment startup with an unrecognized runtime slug + no explicit image would boot an OpenClaw pod labeled as "zeroclaw" — worth adding a guard in `lifecycle.ts:createDeployment` that errors when `config.image` is missing for a runtime whose handler declares a different default image.
- The nightly-QA scripts in `scripts/nightly-qa/` reference `openclaw` liberally (fixtures / dashboards). Not in scope — they describe today's deployments, not the API.
