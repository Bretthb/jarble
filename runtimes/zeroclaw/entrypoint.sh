#!/bin/sh
set -e

# ═══════════════════════════════════════════════════════════════════════
# ZeroClaw Entrypoint — Jarble AI Platform
# ═══════════════════════════════════════════════════════════════════════
#
# First boot:  Writes default config, marks initialized
# Next boots:  Starts the gateway directly
#
# PVC layout (/data/):
#   .initialized          — Marker file (first boot complete)
#   zeroclaw-data/        — ZeroClaw's internal data directory
#   config/               — Jarble-managed config files
#     config.toml         — ZeroClaw runtime configuration
#   logs/                 — Application logs
#
# Environment variables (injected by K8s Secret):
#   DEPLOYMENT_ID         — Unique deployment identifier
#   DEPLOYMENT_NAME       — Human-readable deployment name
#   API_KEY               — LLM provider API key (or ZEROCLAW_API_KEY)
#   PROVIDER              — LLM provider (default: openrouter)
#   ZEROCLAW_MODEL        — Model identifier (optional override)
# ═══════════════════════════════════════════════════════════════════════

INIT_MARKER="/data/.initialized"
CONFIG_DIR="/data/config"
DATA_DIR="/data/zeroclaw-data"
LOG_DIR="/data/logs"

# Ensure directories exist (PVC may be fresh)
mkdir -p "$CONFIG_DIR" "$DATA_DIR" "$LOG_DIR"

# ── First Boot: Write default config ─────────────────────────────────
if [ ! -f "$INIT_MARKER" ]; then
  echo "[entrypoint] First boot — initializing ZeroClaw runtime..."
  echo "[entrypoint] Deployment: ${DEPLOYMENT_NAME:-unknown} (${DEPLOYMENT_ID:-unknown})"

  # Write default config.toml if Jarble API hasn't written one yet
  if [ ! -f "$CONFIG_DIR/config.toml" ]; then
    cat > "$CONFIG_DIR/config.toml" << ZCEOF
# ZeroClaw Configuration — Managed by Jarble AI Platform
# See https://github.com/openagen/zeroclaw for full options

[agent]
name = "${DEPLOYMENT_NAME:-My Bot}"

[provider]
default = "${PROVIDER:-openrouter}"
ZCEOF
    echo "[entrypoint] Created default config.toml"
  fi

  # Mark initialization complete
  touch "$INIT_MARKER"
  echo "[entrypoint] Initialization complete."
else
  echo "[entrypoint] Already initialized, skipping setup."
  echo "[entrypoint] Deployment: ${DEPLOYMENT_NAME:-unknown} (${DEPLOYMENT_ID:-unknown})"
fi

# ── Start ZeroClaw Gateway ───────────────────────────────────────────
echo "[entrypoint] Starting ZeroClaw gateway on port 3000..."
echo "[entrypoint] Provider: ${PROVIDER:-openrouter}"

# ZeroClaw reads API_KEY and PROVIDER from env vars directly
# The --host [::] binds to all interfaces (needed for K8s service discovery)
exec zeroclaw gateway --port 3000 --host "[::]"
