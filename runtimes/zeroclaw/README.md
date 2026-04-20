# ZeroClaw Runtime

Jarble-packaged ZeroClaw runtime image. Wraps the upstream Rust binary
with our entrypoint + PVC layout + file-watcher conventions.

- **Upstream:** [zeroclaw-labs/zeroclaw](https://github.com/zeroclaw-labs/zeroclaw) (mirror at [theonlyhennygod/zeroclaw](https://github.com/theonlyhennygod/zeroclaw))
- **License:** Apache-2.0 + MIT (dual). See upstream [LICENSE-APACHE](https://github.com/zeroclaw-labs/zeroclaw/blob/main/LICENSE-APACHE) / [LICENSE-MIT](https://github.com/zeroclaw-labs/zeroclaw/blob/main/LICENSE-MIT).
- **Handler:** `jarble-api-main/src/runtimes/handlers/zeroclaw.ts`
- **JAR ticket:** [JAR-123](https://linear.app/jarble/issue/JAR-123)

## What the image does

Extracts the upstream ZeroClaw Rust binary (~3.4 MB) from `ghcr.io/theonlyhennygod/zeroclaw:latest` and runs it inside a slim Debian image with our standard PVC layout (`/data/config`, `/data/zeroclaw-data`, `/data/logs`), entrypoint bootstrap script, and inotify-based file-watcher.

## Port decision — 3000

Upstream binds `127.0.0.1:42617` by default. The entrypoint overrides via CLI:

```sh
exec zeroclaw gateway --port 3000 --host "[::]"
```

Port 3000 was picked for our image because:
1. `--port` is a first-class CLI flag upstream, so no binary patching required.
2. `3000` is consistent with our other runtime images and with the handler's `capabilities.ingress.port` declaration in `zeroclaw.ts`.
3. `[::]` binds IPv6 + IPv4 for K8s Service discovery.

The `ZEROCLAW_ALLOW_PUBLIC_BIND=true` env var is also set — upstream requires it to disable the safety prompt when binding a non-localhost address.

## Native UI — bundled React dashboard

Upstream ships a React 19 + Vite 6 + Tailwind 4 dashboard **embedded directly in the gateway Rust binary** (Axum serves it). Features: real-time chat, memory browser, config editor, cron manager, tool inspector.

The handler declares:

```ts
nativeUi: {
  mode: "iframe",
  pathResolver: () => "/",
  authHandoff: "bearer-header",
}
```

`NativeUiHost` (JAR-121) will iframe the dashboard into the Workspace's Control Panel tab — **conditional on the pairing-code spike** below.

## Pairing-code spike — biggest open risk

The upstream dashboard authenticates via a 6-digit **pairing code** that a human enters once to mint a Bearer token:

```
Dashboard → X-Pairing-Code header → /pair endpoint → Bearer token (persisted)
```

For a multi-tenant SaaS, this flow is manual-only out of the box. Before we ship the iframe path in the Control Panel, we need to answer:

1. **Can the gateway mint pairing codes programmatically?** Read the upstream Rust source for `PairingGuard` / `/pair` handlers. Look for:
   - A CLI command like `zeroclaw admin issue-token`.
   - An env var that pre-provisions a token at startup (`ZEROCLAW_ADMIN_TOKEN=…`).
   - An admin endpoint that skips pairing when an upstream secret matches.
2. **If not programmatic: patch upstream to add a headless token-provisioning endpoint.** Dual Apache-2.0/MIT allows maintaining a small fork; upstreaming the patch is preferred.
3. **X-Frame-Options / CSP.** Boot this image locally and check response headers on `/` and `/pair`. If the dashboard emits `X-Frame-Options: DENY` or a restrictive `Content-Security-Policy: frame-ancestors 'none'`, iframing is blocked until upstream adds a config knob or we wrap the response in our own proxy.

**If the spike fails**, fall back to **text-only Control Panel** for ZeroClaw deployments and track the iframe path as a follow-up. That is the scoped `plan B` in JAR-123.

## Chat transport

Handler declares `chatTransport: "http-stream"`. The `ChatAdapter` registry landed under JAR-121 (`src/chat/adapters/`) returns a stubbed `httpStreamChatAdapter` for any ZeroClaw deployment. Route migrations (`tamboAgent.ts` / `flowChat.ts` / `botAsk.ts`) still have to happen before real chat round-trips work — that work is part of the **live-access portion** of JAR-123 (see below).

## Probes

The Dockerfile `HEALTHCHECK` uses `zeroclaw doctor` (exec-based). K8s probes in `src/k8s/lifecycle.ts` consult the handler's `getProbes()` which returns a **TCP-socket** probe against the gateway port — enough to confirm the Axum listener is up without guessing at an HTTP health path.

The real HTTP health path (if any — upstream docs do not mention one) should be confirmed during the live boot test and the probe upgraded to `httpGet` in a follow-up.

## Configuration surface

ZeroClaw reads a TOML config rendered by `renderConfigs()` in the handler:

```toml
[agent]
name = "<deployment name>"
provider = "<llm provider>"
```

Plus env vars:
- `PROVIDER` (e.g. `openrouter`, `anthropic`, `openai`) — selected by the wizard.
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` — per-provider BYOK, via K8s Secret.
- `ZEROCLAW_ALLOW_PUBLIC_BIND=true` — Dockerfile default.

## Offline scaffolding (this PR)

This PR lands everything that can be landed without a live K3s cluster:
- Upstream license + URL recorded here.
- Port reconciliation confirmed (3000 via CLI flag).
- Handler capability declarations landed under JAR-118 → JAR-121.
- Seed description updated in `src/db/seed.pg.ts`.
- Spike question list above.

## Live-access TODO (remaining JAR-123 work)

The items below need an engineer with access to dev.jarble.ai + the K3s cluster. They are not satisfied by the offline scaffolding PR.

- [ ] Run the pairing-code spike (upstream source read + local boot header check).
- [ ] Boot a ZeroClaw deployment against dev.jarble.ai end-to-end.
- [ ] Wire `tamboAgent.ts` / `flowChat.ts` / `botAsk.ts` to dispatch through the `ChatAdapter` registry for ZeroClaw deployments.
- [ ] Implement `NativeUiHost` (JAR-121 component) and route the Control Panel tab through it based on `capabilities.nativeUi`.
- [ ] Playwright trace: deploy → send 3 chat messages → confirm iframe loads (or text fallback) → tear down cleanly. Attach to the PR.
- [ ] Hide skills / system-prompt / subagents wizard steps when `capabilities.hasSkills: false` / `hasSystemPrompt: false` is declared (overlaps with [JAR-100](https://linear.app/jarble/issue/JAR-100)).
- [ ] Audit script: ensure no file outside `src/runtimes/handlers/openclaw.ts` or `services/openclawGateway.ts` contains the string `"openclaw"` after route migration. Rolls in the check from the canceled [JAR-122](https://linear.app/jarble/issue/JAR-122).
