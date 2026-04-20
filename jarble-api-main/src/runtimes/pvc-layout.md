# PVC Layout Contract

**Scope:** `RuntimeHandler.renderConfigs()` path conventions for files written to a deployment's Longhorn PVC at `/data/`.
**Status:** Landed under [JAR-118](https://linear.app/jarble/issue/JAR-118).
**Related:** [JAR-115](https://linear.app/jarble/issue/JAR-115) proposal (Surface 4), `runtimes/types.ts`.

Each deployment mounts a Longhorn PVC at `/data/` inside the runtime pod. `RuntimeHandler.renderConfigs(deployment)` returns a list of `{ path, content }` pairs; paths are **relative to `/data/`** unless they start with `/`, in which case they are treated as absolute inside the pod filesystem (used by OpenClaw for legacy `$HOME/.openclaw/` layout).

This doc is the contract for what paths handlers are allowed to use.

## Reserved prefixes

### ✅ Writable by `renderConfigs()`

| Prefix | Purpose | Used by |
|---|---|---|
| `configs/*` | **Recommended** location for new handler configs | None yet — new runtimes should prefer this |
| `skills/*` | Skill definitions rendered from `DeploymentFields.skills[]` | OpenClaw |
| `mcp/*` | MCP server scripts copied into the pod | OpenClaw |

### ⚠ Writable (legacy — grandfathered, do not extend)

These paths were used by OpenClaw before this contract existed. New runtimes **MUST NOT** use top-level `*.md` / `*.json` paths. Prefer `configs/` / `skills/` / `mcp/` instead.

| Path | Owner | Notes |
|---|---|---|
| `soul.md` | OpenClaw | System prompt |
| `openclaw.json` | OpenClaw | Agent + channel config |
| `subagent-tools.json` | OpenClaw | MCP subagent tool defs |
| `delegation-tools.json` | OpenClaw | Delegation-tool defs |
| `config.toml` | ZeroClaw | TOML config (fine to keep — single file, lightweight runtime) |
| `/home/openclaw/**` | OpenClaw | Legacy `$HOME` layout inside the pod; absolute paths |

### ❌ Forbidden — `renderConfigs()` must NOT write here

Enforced by the conformance lint in `index.test.ts`. Any handler that returns a path under these prefixes will fail CI.

| Prefix | Why forbidden |
|---|---|
| `secrets/*` | K8s `Secret` mount. Populated by the K8s layer via `getSecretEntries`, never by a handler. |
| `memory/*` | Runtime-writable only (the runtime process writes its own state here at runtime, e.g. OpenClaw's `memory/store.json`). A handler writing boot-time content would race against the runtime. |

### `/data/config/*.json` — deprecated OpenClaw tool discovery

The in-pod MCP server (`jarble-ui-server.js`) reads `/data/config/service-tools.json`, `subagent-tools.json`, `delegation-tools.json`, and `platform-skills.json` for OpenClaw's runtime tool discovery. These are **written by OpenClaw internally at runtime, not by `renderConfigs()`**. New runtimes must not create a parallel convention under `/data/config/`.

Tracking removal: see `runtime-abstraction-proposal.md` Surface 3 and JAR-119.

## Why this contract exists

Before JAR-118, there was no rule about what paths a handler was allowed to render. OpenClaw and ZeroClaw landed different conventions (top-level vs. `configs/` vs. absolute `$HOME`), and there was no way to prevent a new runtime from clobbering the K8s Secret mount or the memory directory.

This contract gives future handlers a short, checkable rule:

- Use `configs/` for new stuff.
- Never write to `secrets/` or `memory/`.
- Follow the grandfathered layouts only if you must.

The check is one assertion in `index.test.ts` — any new runtime added to the registry automatically inherits the check, per the JAR-98 conformance design.

## When updating this doc

If a handler starts using a new top-level path, add it to the "grandfathered" table above and explain why it can't go under `configs/`. If you want to **add a new forbidden prefix**, update the `FORBIDDEN_PREFIXES` constant in `index.test.ts` in the same PR.
