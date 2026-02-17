#!/bin/sh
set -e

# ═══════════════════════════════════════════════════════════════════════
# OpenClaw Entrypoint — Jarble AI Platform
# ═══════════════════════════════════════════════════════════════════════
#
# First boot:  Installs openclaw from npm, writes default config
# Next boots:  Starts the gateway directly from persistent storage
#
# PVC layout (/data/):
#   .initialized          — Marker file (first boot complete)
#   .openclaw/            — OpenClaw home directory
#     openclaw.json       — Runtime config (model, provider, etc.)
#     workspace/          — OpenClaw workspace data
#   config/               — Jarble-managed config files
#     soul.md             — System prompt / personality
#     skills/             — Skill definitions (future)
#     platforms/          — Platform credentials (future)
#   runtime/              — npm installation directory
#     node_modules/       — OpenClaw + dependencies
#     package.json        — npm package manifest
#   logs/                 — Application logs
#
# Environment variables (injected by K8s Secret):
#   DEPLOYMENT_ID         — Unique deployment identifier
#   DEPLOYMENT_NAME       — Human-readable deployment name
#   OPENROUTER_API_KEY    — LLM provider API key
#   LLM_PROVIDER          — Provider name (openrouter, openai, anthropic, etc.)
#   LLM_MODEL             — Model identifier (e.g., openrouter/auto)
# ═══════════════════════════════════════════════════════════════════════

INIT_MARKER="/data/.initialized"
RUNTIME_DIR="/data/runtime"
CONFIG_DIR="/data/config"
OPENCLAW_HOME="/data/.openclaw"
LOG_DIR="/data/logs"

# Ensure directories exist (PVC may be fresh)
mkdir -p "$RUNTIME_DIR" "$CONFIG_DIR" "$OPENCLAW_HOME/workspace" "$LOG_DIR"

# ── First Boot: Install OpenClaw ─────────────────────────────────────
if [ ! -f "$INIT_MARKER" ]; then
  echo "[entrypoint] First boot — initializing OpenClaw runtime..."
  echo "[entrypoint] Deployment: ${DEPLOYMENT_NAME:-unknown} (${DEPLOYMENT_ID:-unknown})"

  cd "$RUNTIME_DIR"

  # Initialize npm project
  if [ ! -f "package.json" ]; then
    npm init -y 2>/dev/null || true
  fi

  # Install OpenClaw from public npm registry
  echo "[entrypoint] Installing openclaw@latest..."
  npm install openclaw@latest 2>&1 | tee "$LOG_DIR/install.log"

  # Write default soul.md if Jarble API hasn't written one yet
  if [ ! -f "$CONFIG_DIR/soul.md" ]; then
    echo "You are a helpful AI assistant." > "$CONFIG_DIR/soul.md"
    echo "[entrypoint] Created default soul.md"
  fi

  # Generate initial OpenClaw config
  # This maps Jarble's env vars to OpenClaw's config format
  cat > "$OPENCLAW_HOME/openclaw.json" << OCEOF
{
  "agent": {
    "model": "${LLM_MODEL:-openrouter/auto}",
    "provider": "${LLM_PROVIDER:-openrouter}"
  },
  "gateway": {
    "port": 18789,
    "host": "0.0.0.0"
  }
}
OCEOF
  echo "[entrypoint] Generated openclaw.json config"

  # Mark initialization complete
  touch "$INIT_MARKER"
  echo "[entrypoint] Initialization complete."
else
  echo "[entrypoint] Already initialized, skipping install."
  echo "[entrypoint] Deployment: ${DEPLOYMENT_NAME:-unknown} (${DEPLOYMENT_ID:-unknown})"
fi

# ── Start file watcher (background) ──────────────────────────────────
# Watches /data/config/ for changes and notifies Jarble API so the
# frontend stays in sync with config files modified inside the container.
if command -v inotifywait >/dev/null 2>&1; then
  /usr/local/bin/file-watcher.sh &
  echo "[entrypoint] File watcher started in background"
else
  echo "[entrypoint] Warning: inotifywait not found, file watcher disabled"
fi

# ── Start OpenClaw Gateway ───────────────────────────────────────────
cd "$RUNTIME_DIR"
echo "[entrypoint] Starting OpenClaw gateway on port 18789..."
echo "[entrypoint] Provider: ${LLM_PROVIDER:-openrouter}, Model: ${LLM_MODEL:-openrouter/auto}"

# Run openclaw gateway with LAN binding (needed for K8s service discovery)
# The --allow-unconfigured flag lets it start even without full platform setup
exec npx openclaw gateway --port 18789 --bind lan --allow-unconfigured
