# Runtime Abstraction Proposal — Beyond OpenClaw

**Status:** Draft
**Date:** 2026-04-19
**Ticket:** [JAR-115](https://linear.app/jarble/issue/JAR-115)
**Branch:** `feature/jar-115-research-and-recommend-the-next-agentic-runtime-to-integrate`
**Companion doc:** [`runtime-evaluation.md`](./runtime-evaluation.md)

## TL;DR

`RuntimeHandler` (`jarble-api-main/src/runtimes/types.ts`) is a clean strategy pattern for config rendering, secret generation, and validation — but it is **not the whole surface** a runtime has to conform to. Ten additional surfaces currently assume OpenClaw directly: chat transport, gateway-token auth, the Control Panel iframe, the `jarble_ui` canvas-block protocol, the `/data/config/*.json` MCP tool discovery contract, the per-deployment forward-auth middleware, the `/healthz` readiness probe, the config-sync-triggers-pod-restart model, the `supportsNativeSubagents` flag semantics, and the `managedBy: legacy|operator` branching in the K8s layer.

Dropping in a second runtime — especially one with its own native UI (Dify, Letta ADE, Open WebUI) or no UI at all (LangGraph, CrewAI) — requires expressing each of these surfaces as a capability the handler declares, so the platform can dispatch rather than hard-code.

This doc proposes the minimum set of new capabilities. It does **not** change any interfaces — it enumerates what has to change, who owns each change, and how big each change is. The blast-radius table at the end is the input to the integration-epic sizing.

## Why this matters

`JAR-98` (runtime registry conformance test) shipped on 2026-04-19 and `JAR-93` (RuntimeAdapter boundary) is in flight. Both exist to untangle the platform from OpenClaw. The interface itself looks untangled — but the ten surfaces below prove that is a claim, not yet a fact. Until they are abstracted, a second runtime can conform to `RuntimeHandler` and still require bespoke changes in ten other files to actually run.

## How to read this doc

For each surface:

- **Current state** — concrete OpenClaw assumption with `file:line` citation.
- **Proposed shape** — the new capability (typed as TS pseudo-code).
- **Lands in** — which module / registry owns the new shape.
- **Blast radius** — rough count and class of files that have to change.
- **Ticket size** — S (< 1 day), M (1-3 days), L (> 3 days).

All citations are against `develop` as of 2026-04-19.

---

## Surface 1 — Native UI presence

**Current state.** The Control Panel tab is a full-screen iframe into OpenClaw's admin UI, brokered by the API's `adminProxy` and authenticated with an Ed25519-signed gateway token passed via URL fragment. The iframe also listens for `type === "jarble:ui_block"` postMessage events — an OpenClaw-specific canvas-block protocol.

- `Jarble-mvp/components/workspace/ControlPanel.tsx:50` — `GET /api/deployments/:id/admin-token` resolves the per-deployment Ed25519 token.
- `Jarble-mvp/components/workspace/ControlPanel.tsx:60` — iframe src is `/admin/?token=...#token={gatewayToken}` (**url-hash-token** handoff).
- `Jarble-mvp/components/workspace/ControlPanel.tsx:83` — listens for `"jarble:ui_block"` postMessage.
- `jarble-api-main/src/routes/adminProxy.ts:6,100,158` — reverse-proxies `/admin/*` to OpenClaw Control UI on pod port `18789`.
- `Jarble-mvp/app/d/[id]/page.tsx:422,438,909,1156,1248` — chat-mode toggle labeled "Control Panel" renders an **inline** iframe component that uses a **signed session cookie** (`/api/auth/agent-session`), not the URL-hash-token model. **Two auth handoff models exist in production for the same runtime.**

**Proposed shape.** A runtime declares whether it has a native UI, how to resolve its URL, and what auth handoff it needs.

```ts
// RuntimeCapabilities (extension)
readonly nativeUi?: {
  mode: "iframe" | "redirect" | "none";
  // Resolved against the per-deployment pod address.
  pathResolver(deployment: DeploymentFields): string; // e.g. "/admin/" or "/"
  // What the platform has to do to authenticate the embedded UI.
  authHandoff: "url-hash-token" | "cookie" | "none";
  // Optional postMessage protocol name; if set, the workspace surfaces
  // inbound events to the CanvasActionContext.
  postMessageProtocol?: string; // e.g. "jarble:ui_block"
};
```

**Lands in.** `RuntimeCapabilities` (new field), plus a small `NativeUiHost` component in `Jarble-mvp/components/workspace/` that switches on `nativeUi.mode` *and* `authHandoff`. Both the `url-hash-token` and `cookie` handoff paths must be supported at day one — not because a second runtime needs both, but because OpenClaw itself is rendered through both paths today (workspace component + inline chat-page iframe) and neither can regress.

**Blast radius.** ~5 files: `ControlPanel.tsx`, `adminProxy.ts`, `app/d/[id]/page.tsx` (inline iframe component), `runtimes/types.ts`, `runtimes/handlers/openclaw.ts`.

**Ticket size.** **M**. Interface change + proxy route generalization + frontend dispatch.

---

## Surface 2 — Chat transport

**Current state.** The API's chat endpoint imports OpenClaw's three transports directly and hard-codes the retry chain WS → HTTP → exec.

- `jarble-api-main/src/routes/tamboAgent.ts:42` — imports `chatViaGateway, chatViaHTTP, chatViaExec, GatewayResponse`.
- `jarble-api-main/src/routes/tamboAgent.ts:1944,1965,1969` — falls back through the three OpenClaw transports; injects `podAddr.gatewayToken`.
- `jarble-api-main/src/routes/flowChat.ts:35` — imports `chatViaExec` only (flow chat does not do the WS/HTTP retry dance, just direct exec).
- `jarble-api-main/src/routes/botAsk.ts:17` — same for messaging-platform inbound.

**Proposed shape.** A `ChatAdapter` registry keyed by runtime slug, plus a capability flag naming the preferred transport.

```ts
// Sibling registry, not on RuntimeHandler itself (Chat is per-transport, not per-runtime).
export interface ChatAdapter {
  readonly transport: "openclaw-ws" | "http-stream" | "none";
  sendMessage(ctx: ChatContext): Promise<AsyncIterable<ChatEvent>>;
  cancel?(ctx: ChatContext): Promise<void>;
}

// RuntimeCapabilities (extension)
readonly chatTransport: "openclaw-ws" | "http-stream" | "none";
```

`tamboAgent.ts`, `flowChat.ts`, and `botAsk.ts` dispatch on `chatTransport`; each `ChatAdapter` is imported from a per-runtime module under `jarble-api-main/src/chat/adapters/`.

**Lands in.** New `jarble-api-main/src/chat/` directory with `ChatAdapter` type + registry; capabilities extension.

**Blast radius.** ~6 files: three route files, new `chat/` dir (3 files), `runtimes/types.ts`. The three OpenClaw transports become one adapter.

**Ticket size.** **L**. This is the biggest pull. Three routes have embedded retry logic and gateway-token plumbing that has to move.

---

## Surface 3 — Canvas rendering

**Current state.** Canvas rendering is now OpenClaw-native (the legacy `jarble_ui` MCP bridge was dropped in `6006e3b`). But `jarble-ui-server.js` still discovers tools by reading OpenClaw-specific config paths, and the frontend still hard-codes the postMessage protocol name.

- `Jarble-mvp/components/workspace/ControlPanel.tsx:6,83` — hard-coded `"jarble:ui_block"` message type with `component` / `props` shape.
- `jarble-api-main/src/mcp/jarble-ui-server.js:316,322,369,438,4142,7846` — loads tool defs from `/data/config/service-tools.json`, `subagent-tools.json`, `delegation-tools.json`, `platform-skills.json`.

**Proposed shape.** Two capability flags.

```ts
readonly nativeCanvas: boolean;       // true if the runtime emits canvas blocks natively
readonly canvasProtocol?: string;      // postMessage protocol name, e.g. "jarble:ui_block"
```

Runtimes that cannot emit canvas blocks fall through to a text-only path. `NativeUiHost` (Surface 1) wires the `canvasProtocol` to the workspace's `CanvasActionContext`.

**Lands in.** `RuntimeCapabilities`.

**Blast radius.** ~2 files: `ControlPanel.tsx`, `runtimes/types.ts`. The MCP tool-discovery contract (`/data/config/*.json`) is a separate concern tracked under Surface 4.

**Ticket size.** **S**.

---

## Surface 4 — Config surface (PVC layout)

**Current state.** `renderConfigs` on the handler interface returns `{ path, content }[]` pairs — but the *paths it is allowed to use* are not documented, and several consumers assume specific paths.

- `jarble-api-main/src/k8s/config.ts:344` — writes env vars to `/data/config/.env`.
- `jarble-api-main/src/services/configSync.ts:70,240,329` — assumes `soul.md` is the state-of-record.
- `jarble-api-main/src/mcp/jarble-ui-server.js:322,369,438,4142` — reads `/data/config/service-tools.json`, `subagent-tools.json`, `delegation-tools.json`, `platform-skills.json`.

**Proposed shape.** Document the PVC-layout contract, don't change the interface. Reserved path prefixes:

```
/data/secrets/*       — K8s Secret mount, NOT handler-writable
/data/configs/*       — handler-writable (renderConfigs)
/data/skills/*        — handler-writable
/data/memory/*        — runtime-writable at runtime, not on boot
/data/config/*.json   — DEPRECATED OpenClaw tool-discovery path (Surface 3)
```

A new `jarble-api-main/src/runtimes/pvc-layout.md` captures the contract. Runtimes that do not use `/data/configs/` simply return an empty `renderConfigs()`.

**Lands in.** Documentation + a lint in the conformance test (`JAR-98`) that rejects paths outside reserved prefixes.

**Blast radius.** ~1 file (docs) + 1 test.

**Ticket size.** **S**.

---

## Surface 5 — Pod ingress & auth middleware

**Current state.** Every deployment gets a Service + Ingress + forward-auth middleware auto-created on boot. The middleware is named `agent-forward-auth` and assumes OpenClaw's gateway-token signature validation.

- `jarble-api-main/src/k8s/lifecycle.ts:589,614,624,626` — creates the ingress, attaches `agent-forward-auth` + `jarble-strip-frame-deny` Traefik CRDs.

**Proposed shape.** Per-runtime ingress template. The handler declares an auth strategy; the lifecycle layer renders the middleware.

```ts
// RuntimeCapabilities (extension)
readonly ingress?: {
  subdomain: "per-deployment" | "shared" | "none";
  authStrategy: "gateway-token" | "bearer-header" | "cookie-session" | "none";
  // Optional extra Traefik middlewares the handler wants attached.
  extraMiddlewares?: string[];
};
```

The `agent-forward-auth` Traefik middleware stays, but becomes one of several pre-registered strategies.

**Lands in.** `RuntimeCapabilities` + a small ingress-template module in `jarble-api-main/src/k8s/ingress/`.

**Blast radius.** ~3 files: `k8s/lifecycle.ts`, new `k8s/ingress/templates.ts`, `runtimes/types.ts`.

**Ticket size.** **M**.

---

## Surface 6 — Model-switch semantics

**Current state.** Changing provider / model / API key / memory scope triggers a full pod restart, coordinated by a Postgres advisory lock in `configSync.ts` (JAR-86).

- `jarble-api-main/src/trpc/routers/deployment/procedures1.ts:1297` — comment: "API key, provider, model, or memory scope changes require a pod restart."
- `jarble-api-main/src/services/configSync.ts` — three-tier escalation (SIGHUP → hot file-watcher reload → full restart). Any LLM env-var change escalates to Tier 3 because env vars are baked into the pod spec; the runtime has no hot-swap path.

**Proposed shape.**

```ts
// RuntimeCapabilities (extension)
readonly modelSwitch: "hot" | "restart" | "recreate";
```

`configSync.ts` dispatches: `hot` writes the config and signals the pod via file-watcher; `restart` writes and rolls the deployment; `recreate` tears down and re-creates the pod (needed for runtimes that bake the model into the image — uncommon, but the zeroclaw stub demonstrates).

**Lands in.** `RuntimeCapabilities` + a switch in `configSync.ts` + the deployment-router comment is replaced by handler dispatch.

**Blast radius.** ~2 files: `configSync.ts`, `runtimes/types.ts`.

**Ticket size.** **S**.

---

## Surface 7 — Subagents

**Current state.** The interface already has `supportsNativeSubagents?: boolean` (`types.ts:185`), and only OpenClaw sets it (`handlers/openclaw.ts:171`). The API branches on it: when `true`, subagent delegations are rendered as runtime-native agent defs; when `false`, the legacy `collectLlmCompletion` interception path is used.

**Proposed shape.** Keep the flag. Add a contract note for runtimes with a different subagent model (CrewAI's role-based crew, AutoGen's conversation-based delegation) — they can still set `supportsNativeSubagents: true` as long as they translate `DeploymentFields.subagents[]` into their native shape inside `renderConfigs()`.

**Lands in.** Doc-only change on `types.ts`.

**Blast radius.** 1 file.

**Ticket size.** **S**.

---

## Surface 8 — Secret injection

**Current state.** `getSecretEntries` returns one flat `Record<string, string>` mixing LLM secrets (`OPENROUTER_API_KEY`, `LLM_PROVIDER`, `LLM_MODEL`), runtime secrets (`GATEWAY_TOKEN`), and platform secrets (`TELEGRAM_BOT_TOKEN`, `DISCORD_BOT_TOKEN`, …).

**Proposed shape.** Three methods.

```ts
// RuntimeHandler (extension; keep getSecretEntries as a default-impl sum for back-compat)
getLlmSecrets(d: DeploymentFields): Record<string, string>;
getRuntimeSecrets(d: DeploymentFields): Record<string, string>;
getPlatformSecrets(d: DeploymentFields): Record<string, string>;
```

A non-LLM runtime (LangGraph stub routing through its own API) returns `{}` from `getLlmSecrets` and the K8s Secret doesn't get `LLM_*` envs.

**Lands in.** `RuntimeHandler` + caller in `k8s/config.ts`.

**Blast radius.** ~4 files: interface, both handlers, `k8s/config.ts`.

**Ticket size.** **M**.

---

## Surface 9 — Health / readiness probes

**Current state.** Liveness and readiness probes both call `/healthz` on the pod's runtime container.

- `jarble-api-main/src/k8s/lifecycle.ts:518,520,528,530,563,568` — hard-coded `/healthz` path.

**Proposed shape.**

```ts
// RuntimeHandler (extension)
getProbes?(d: DeploymentFields): {
  liveness?: k8s.V1Probe;
  readiness?: k8s.V1Probe;
  startup?: k8s.V1Probe;
};
```

Default (if the handler doesn't implement it): the current `/healthz` shape, so the OpenClaw handler needs no change.

**Lands in.** `RuntimeHandler` + `k8s/lifecycle.ts`.

**Blast radius.** ~2 files.

**Ticket size.** **S**.

---

## Surface 10 — Deployment model (legacy vs operator)

**Current state.** `managedBy: "legacy" | "operator"` on `DeploymentFields` branches K8s behavior: operator mode uses the OpenClaw CRD and a different PVC mount path / container name.

- `jarble-api-main/src/k8s/configmap.ts:42-43` — `managedBy === "operator"` changes config key encoding.
- `jarble-api-main/src/k8s/constants.ts:82,88,93` — `LEGACY_CONTAINER_NAME = "runtime"`, `getContainerName(managedBy)`, `getPvcMountPath(managedBy)`.
- `jarble-api-main/src/k8s/components.ts:19-20,47-48` — all config/exec operations branch on `managedBy`.

**Proposed shape.** The runtime handler owns its deployment topology. Introduce a `DeploymentTopology` descriptor:

```ts
// RuntimeHandler (extension)
readonly topology: {
  kind: "k8s-deployment" | "operator-crd";
  operatorGroupVersion?: string; // e.g. "openclaw.io/v1alpha1"
  containerName: string;
  pvcMountPath: string;
};
```

The `managedBy` DB column survives as an override for per-deployment experiments, but the default is the handler's `topology.kind`.

**Lands in.** `RuntimeHandler` + `k8s/constants.ts` + `k8s/components.ts` + `k8s/configmap.ts`.

**Blast radius.** ~5 files.

**Ticket size.** **M**.

---

## Summary — blast-radius table

Rough sizing for the follow-up tickets, in descending ticket size:

| # | Surface | New shape lands in | Size | Files |
|---|---------|--------------------|------|-------|
| 2 | Chat transport | New `chat/adapters/` registry + `chatTransport` cap | **L** | ~6 |
| 1 | Native UI presence | `RuntimeCapabilities.nativeUi` + `NativeUiHost` component | **M** | ~5 |
| 10 | Deployment model | `RuntimeHandler.topology` | **M** | ~5 |
| 8 | Secret injection split | Three handler methods | **M** | ~4 |
| 5 | Ingress / auth middleware | `RuntimeCapabilities.ingress` + ingress templates | **M** | ~3 |
| 6 | Model-switch semantics | `RuntimeCapabilities.modelSwitch` | **S** | ~2 |
| 9 | Health probes | `RuntimeHandler.getProbes` | **S** | ~2 |
| 3 | Canvas rendering flags | `RuntimeCapabilities.nativeCanvas` + `canvasProtocol` | **S** | ~2 |
| 4 | PVC-layout contract | Doc + conformance lint | **S** | ~2 |
| 7 | Subagent contract note | Doc-only on `types.ts` | **S** | 1 |

**Total:** 1 L + 4 M + 5 S ≈ 2.5–3 engineering weeks spread across the interface, K8s layer, chat routes, and frontend workspace. The top-pick second-runtime integration (see `runtime-evaluation.md`) will need most of the M- and L-sized work done first. The S-sized items can land opportunistically alongside other deployment-router / K8s work.

## Sequencing

1. **First** — Surfaces 4 (PVC contract) and 7 (subagent note) land as the audit doc's own PR. Zero code risk.
2. **Then** — Surfaces 3 (canvas flags) and 9 (probes) can land with `JAR-99` (OpenClaw leak audit) as low-risk cleanups.
3. **Then** — Surfaces 6 (modelSwitch) and 5 (ingress) because they unblock any non-OpenClaw runtime from booting at all.
4. **Then** — Surface 8 (secret split) because non-LLM runtimes cannot ship without it.
5. **Then** — Surface 10 (topology) because it's the K8s-layer dependency for any runtime that does not use the OpenClaw CRD.
6. **Then** — Surfaces 1 (native UI) and 2 (chat transport) because they are the largest and benefit most from the rest of the abstractions already existing.

Only after all ten are landed can the recommended second runtime (see companion doc) be integrated without bespoke, OpenClaw-assuming code.

## Out of scope

- Interface *implementation* — this doc proposes shapes; PRs land the changes.
- New runtimes themselves — tracked under the integration epic.
- Marketplace / monetization UX — `JAR-79`.
- `RuntimeAdapter` boundary redesign — `JAR-93`.

## References

- Runtime interface: `jarble-api-main/src/runtimes/types.ts`, `jarble-api-main/src/runtimes/index.ts`
- Handlers: `jarble-api-main/src/runtimes/handlers/openclaw.ts`, `zeroclaw.ts`
- Related tickets: JAR-93, JAR-98 (done), JAR-99, JAR-100, JAR-101, JAR-79
