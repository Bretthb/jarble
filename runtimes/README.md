# Jarble Runtime Container Images

Base Docker images for each runtime that runs on the Jarble AI platform. Each image wraps an open-source runtime with Jarble's entrypoint script and PVC directory layout.

## Runtimes

| Runtime | Language | Base Image | Gateway Port | GHCR |
|---------|----------|------------|-------------|------|
| **OpenClaw** | TypeScript/Node.js 22 | `node:22-bookworm-slim` | 18789 | `ghcr.io/jarble-ai/openclaw:latest` |
| **ZeroClaw** | Rust (~3.4MB binary) | `debian:bookworm-slim` | 3000 | `ghcr.io/jarble-ai/zeroclaw:latest` |

## Architecture

```
Container (stateless)          PVC /data/ (persistent)
┌──────────────────────┐      ┌────────────────────────────┐
│ OS + runtime deps    │      │ .initialized               │
│ entrypoint.sh        │──────│ config/     (Jarble writes) │
│ (no app data)        │mount │ runtime/    (npm install)   │
│                      │      │ logs/                       │
└──────────────────────┘      └────────────────────────────┘
```

**Key principle:** The container is stateless. All persistent data lives on the PVC at `/data/`. On first boot, the entrypoint installs the runtime and creates default configs. On subsequent boots, it starts directly.

## PVC Directory Layout

### OpenClaw (`/data/`)

```
/data/
├── .initialized              # Marker: first boot complete
├── .openclaw/                # OpenClaw home directory
│   ├── openclaw.json         # Runtime config (model, provider)
│   └── workspace/            # OpenClaw workspace data
├── config/                   # Jarble-managed config files
│   ├── soul.md               # System prompt / personality
│   ├── skills/               # Skill definitions (future)
│   └── platforms/            # Platform credentials (future)
├── runtime/                  # npm installation directory
│   ├── package.json
│   └── node_modules/openclaw/
└── logs/
    └── install.log           # First-boot install log
```

### ZeroClaw (`/data/`)

```
/data/
├── .initialized              # Marker: first boot complete
├── zeroclaw-data/            # ZeroClaw internal data (SQLite, etc.)
├── config/                   # Jarble-managed config files
│   └── config.toml           # ZeroClaw configuration
└── logs/
```

## Environment Variables

Injected by K8s Secret (`secret-{deploymentId}`). Each runtime reads different env var names:

### OpenClaw

| Env Var | Description |
|---------|-------------|
| `DEPLOYMENT_ID` | Unique deployment identifier |
| `DEPLOYMENT_NAME` | Human-readable name |
| `OPENROUTER_API_KEY` | LLM provider API key |
| `LLM_PROVIDER` | Provider name (openrouter, openai, etc.) |
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

**Workflow:** `.github/workflows/build-runtime-images.yml`

**Manual trigger:** Go to Actions > "Build Runtime Images" > "Run workflow" > Select runtime.

**Tags:**
- `ghcr.io/jarble-ai/{runtime}:latest` — Latest build from main
- `ghcr.io/jarble-ai/{runtime}:{sha}` — Specific commit

## Upstream Projects

- **OpenClaw:** [github.com/openclaw/openclaw](https://github.com/openclaw/openclaw)
- **ZeroClaw:** [github.com/openagen/zeroclaw](https://github.com/openagen/zeroclaw)
