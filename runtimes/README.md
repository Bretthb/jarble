# Jarble Agent Harness Images

Base Docker images for each **Agent Harness** that runs on Jarble's infrastructure platform. Each image wraps an open-source agent harness with Jarble's entrypoint script and PVC directory layout, so the platform can boot, configure, and tear it down identically regardless of which harness a deployment selected.

Jarble itself is harness-agnostic. **OpenClaw is the only harness shipping to end users today.** Additional harness images can live in this directory once they implement the `RuntimeHandler` interface (see `jarble-api-main/src/runtimes/handlers/`); the directory and interface keep their existing "runtime" code identifiers — only the user-facing and architectural term is "harness".

## Harnesses

| Harness | Status | Language | Base Image | Gateway Port | GHCR |
|---------|--------|----------|------------|--------------|------|
| **OpenClaw** | Shipping | TypeScript/Node.js 22 | `node:22-bookworm-slim` | 18789 | `ghcr.io/jarble-ai/openclaw:latest` |
| **ZeroClaw** | In progress (see JAR-123) | Rust (~3.4MB binary) | `debian:bookworm-slim` | 3000 | `ghcr.io/jarble-ai/zeroclaw:latest` |

The webchat UI is **always provided by the harness itself**. Jarble does not ship its own chat UI — the per-deployment subdomain proxies through to whichever webchat the selected harness serves (OpenClaw's webchat for the only currently-shipping harness).

## Architecture

```
Container (stateless)          PVC /data/ (persistent)
┌──────────────────────┐      ┌────────────────────────────┐
│ OS + harness deps    │      │ .initialized               │
│ entrypoint.sh        │──────│ config/     (Jarble writes) │
│ (no app data)        │mount │ runtime/    (install dir)   │
│                      │      │ logs/                       │
└──────────────────────┘      └────────────────────────────┘
```

**Key principle:** the container is stateless. All persistent data lives on the PVC at `/data/`. On first boot the entrypoint installs the harness binary and writes default configs. On subsequent boots it starts directly.

## PVC Directory Layout

### OpenClaw (`/data/`)

```
/data/
├── .initialized              # Marker: first boot complete
├── .openclaw/                # OpenClaw home directory
│   ├── openclaw.json         # Harness config (model, provider)
│   └── workspace/            # OpenClaw workspace data
├── config/                   # Jarble-managed config files
│   ├── soul.md               # System prompt / personality
│   ├── skills/               # Skill definitions
│   └── platforms/            # Platform credentials
├── runtime/                  # npm installation directory
│   ├── package.json
│   └── node_modules/openclaw/
└── logs/
    └── install.log           # First-boot install log
```

### ZeroClaw (`/data/`) — work in progress

```
/data/
├── .initialized              # Marker: first boot complete
├── zeroclaw-data/            # ZeroClaw internal data (SQLite, etc.)
├── config/                   # Jarble-managed config files
│   └── config.toml           # ZeroClaw configuration
└── logs/
```

## Environment Variables

Injected by K8s Secret (`secret-{deploymentId}`). Each harness reads different env var names:

### OpenClaw

| Env Var | Description |
|---------|-------------|
| `DEPLOYMENT_ID` | Unique deployment identifier |
| `DEPLOYMENT_NAME` | Human-readable name |
| `OPENROUTER_API_KEY` | LLM provider API key |
| `LLM_PROVIDER` | Provider name (openrouter, openai, anthropic, google) |
| `LLM_MODEL` | Model identifier |

### ZeroClaw

| Env Var | Description |
|---------|-------------|
| `DEPLOYMENT_ID` | Unique deployment identifier |
| `DEPLOYMENT_NAME` | Human-readable name |
| `API_KEY` | LLM provider API key |
| `PROVIDER` | Provider name (default: openrouter) |
| `ZEROCLAW_MODEL` | Model identifier (optional) |

## Building Locally

```bash
# OpenClaw
docker build -t openclaw-test runtimes/openclaw/

# ZeroClaw
docker build -t zeroclaw-test runtimes/zeroclaw/

# Test with a volume
docker run --rm -v /tmp/testdata:/data -p 18789:18789 openclaw-test
docker run --rm -v /tmp/testdata:/data -p 3000:3000 zeroclaw-test
```

## Publishing to GHCR

Images are automatically built and pushed by GitHub Actions when files under `runtimes/` change on the `main` branch.

**Workflow:** `.github/workflows/deploy-runtimes.yml`

**Manual trigger:** Actions → "Deploy Runtimes" → "Run workflow" → select harness.

**Tags:**
- `ghcr.io/jarble-ai/{harness}:latest` — Latest build from main
- `ghcr.io/jarble-ai/{harness}:sha-{commit}` — Specific commit

## Upstream Projects

- **OpenClaw:** [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
- **ZeroClaw:** [github.com/zeroclaw-labs/zeroclaw](https://github.com/zeroclaw-labs/zeroclaw) (mirrored at `theonlyhennygod/zeroclaw`)
