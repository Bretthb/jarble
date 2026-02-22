#!/bin/sh
set -e

# ═══════════════════════════════════════════════════════════════════════
# OpenClaw Entrypoint — Jarble AI Platform
# ═══════════════════════════════════════════════════════════════════════
#
# Graceful shutdown: On SIGTERM (from K8s), we:
#   1. Stop accepting new connections
#   2. Let in-flight requests complete (up to terminationGracePeriodSeconds)
#   3. Clean up background processes
#   4. Exit cleanly
#
#
# OpenClaw runs directly from /opt/openclaw (baked into the image).
# The PVC (/data/) only holds state — no npm install or copy needed.
#
# First boot:  Writes default config (soul.md, openclaw.json)
# Next boots:  Starts the gateway directly
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
CONFIG_DIR="/data/config"
OPENCLAW_HOME="/data/.openclaw"
# OpenClaw's ACTUAL runtime state dir is $HOME/.openclaw/.openclaw/ (double-nested
# because HOME=/data and OpenClaw resolves state dir as $HOME/.openclaw/)
OPENCLAW_STATE="/data/.openclaw/.openclaw"
LOG_DIR="/data/logs"

# Track background process PIDs for cleanup
WATCHER_PID=""
CLEANUP_PID=""
OPENCLAW_PID=""

# ── Graceful shutdown handler ─────────────────────────────────────────
cleanup() {
  echo "[entrypoint] Received shutdown signal, cleaning up..."

  # Stop background processes
  if [ -n "$WATCHER_PID" ] && kill -0 "$WATCHER_PID" 2>/dev/null; then
    echo "[entrypoint] Stopping file watcher (PID $WATCHER_PID)"
    kill "$WATCHER_PID" 2>/dev/null || true
  fi

  if [ -n "$CLEANUP_PID" ] && kill -0 "$CLEANUP_PID" 2>/dev/null; then
    echo "[entrypoint] Stopping cleanup loop (PID $CLEANUP_PID)"
    kill "$CLEANUP_PID" 2>/dev/null || true
  fi

  # Forward SIGTERM to OpenClaw and wait for graceful shutdown
  if [ -n "$OPENCLAW_PID" ] && kill -0 "$OPENCLAW_PID" 2>/dev/null; then
    echo "[entrypoint] Stopping OpenClaw gateway (PID $OPENCLAW_PID)"
    kill -TERM "$OPENCLAW_PID" 2>/dev/null || true

    # Wait up to 25s for graceful shutdown (K8s default is 30s)
    timeout=25
    while [ $timeout -gt 0 ] && kill -0 "$OPENCLAW_PID" 2>/dev/null; do
      sleep 1
      timeout=$((timeout - 1))
    done

    # Force kill if still running
    if kill -0 "$OPENCLAW_PID" 2>/dev/null; then
      echo "[entrypoint] OpenClaw did not exit gracefully, forcing..."
      kill -9 "$OPENCLAW_PID" 2>/dev/null || true
    fi
  fi

  echo "[entrypoint] Shutdown complete"
  exit 0
}

# Register signal handlers (use signal numbers for dash/sh compatibility)
# SIGTERM=15, SIGINT=2, SIGQUIT=3
trap cleanup 15 2 3

# Ensure directories exist (PVC may be fresh)
mkdir -p "$CONFIG_DIR" "$OPENCLAW_HOME/workspace" "$OPENCLAW_STATE" "$LOG_DIR"

# ── Cleanup ephemeral storage ─────────────────────────────────────────
# Clear temp files to prevent ephemeral storage exhaustion
# (K8s evicts pods that exceed ephemeral-storage limits)
echo "[entrypoint] Cleaning ephemeral storage..."
rm -rf /tmp/* 2>/dev/null || true
rm -rf /var/tmp/* 2>/dev/null || true

# ── First Boot: Write default configs ─────────────────────────────────
if [ ! -f "$INIT_MARKER" ]; then
  echo "[entrypoint] First boot — writing default configs..."
  echo "[entrypoint] Deployment: ${DEPLOYMENT_NAME:-unknown} (${DEPLOYMENT_ID:-unknown})"

  # Write default soul.md if Jarble API hasn't written one yet
  if [ ! -f "$CONFIG_DIR/soul.md" ]; then
    echo "You are a helpful AI assistant." > "$CONFIG_DIR/soul.md"
    echo "[entrypoint] Created default soul.md"
  fi

  # Generate initial OpenClaw config
  # This maps Jarble's env vars to OpenClaw's config format
  # Includes WhatsApp channel with dmPolicy: pairing for QR flow
  #
  # IMPORTANT: OpenClaw reads config from $HOME/.openclaw/.openclaw/openclaw.json
  # (double-nested because HOME=/data). The legacy $HOME/.openclaw/openclaw.json
  # is only used for initial migration and NOT read at runtime.
  #
  # Model format: agents.defaults.model.primary (new format, not agent.model)

  # Resolve the model ref — prefix with provider if not already qualified
  MODEL_REF="${LLM_MODEL:-openrouter/auto}"
  case "$MODEL_REF" in
    */*) ;; # already has provider prefix
    *) MODEL_REF="${LLM_PROVIDER:-openrouter}/$MODEL_REF" ;;
  esac

  cat > "$OPENCLAW_STATE/openclaw.json" << OCEOF
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "${MODEL_REF}"
      }
    }
  },
  "gateway": {
    "port": 18789,
    "host": "0.0.0.0",
    "auth": {
      "token": "${OPENCLAW_GATEWAY_TOKEN}"
    },
    "http": {
      "endpoints": {
        "chatCompletions": { "enabled": true }
      }
    }
  },
  "plugins": {
    "entries": {
      "whatsapp": { "enabled": true },
      "telegram": { "enabled": true },
      "discord": { "enabled": true }
    }
  },
  "channels": {
    "whatsapp": {
      "enabled": true,
      "dmPolicy": "pairing"
    }
  }
}
OCEOF
  echo "[entrypoint] Generated openclaw.json config (model: $MODEL_REF)"

  # Mark initialization complete
  touch "$INIT_MARKER"
  echo "[entrypoint] Initialization complete."
else
  echo "[entrypoint] Already initialized, skipping setup."
  echo "[entrypoint] Deployment: ${DEPLOYMENT_NAME:-unknown} (${DEPLOYMENT_ID:-unknown})"
fi

# ── Install mcporter (MCP bridge for Jarble UI tools) ───────────────
# mcporter bridges our jarble-ui MCP server to OpenClaw's skill system,
# enabling the bot to call render_ui, define_component, list_components.
if [ ! -f /data/node_modules/.bin/mcporter ]; then
  echo "[entrypoint] Installing mcporter for MCP bridge..."
  cd /data && npm install --no-save mcporter 2>&1 | tail -1
  cd /opt/openclaw
  echo "[entrypoint] mcporter installed"
fi

# Configure jarble-ui MCP server in mcporter (idempotent)
if [ -f /data/config/mcp/jarble-ui-server.js ] && [ -f /data/node_modules/.bin/mcporter ]; then
  export PATH="/data/node_modules/.bin:$PATH"
  if ! mcporter list jarble-ui >/dev/null 2>&1; then
    echo "[entrypoint] Configuring jarble-ui MCP server in mcporter..."
    mcporter config add jarble-ui --command node --arg /data/config/mcp/jarble-ui-server.js --description "Jarble UI canvas components" --scope home 2>&1 || true
    echo "[entrypoint] jarble-ui MCP server configured"
  fi
fi

# ── Start file watcher (background) ──────────────────────────────────
# Watches /data/config/ for changes and notifies Jarble API so the
# frontend stays in sync with config files modified inside the container.
if command -v inotifywait >/dev/null 2>&1; then
  /usr/local/bin/file-watcher.sh &
  WATCHER_PID=$!
  echo "[entrypoint] File watcher started in background (PID $WATCHER_PID)"
else
  echo "[entrypoint] Warning: inotifywait not found, file watcher disabled"
fi

# ── Periodic temp cleanup (background) ────────────────────────────────
# Runs every hour to prevent ephemeral storage buildup in long-running pods
(
  while true; do
    sleep 3600  # 1 hour
    rm -rf /tmp/* 2>/dev/null || true
    rm -rf /var/tmp/* 2>/dev/null || true
    echo "[cleanup] Cleared ephemeral storage at $(date -Iseconds)"
  done
) &
CLEANUP_PID=$!
echo "[entrypoint] Periodic cleanup started (PID $CLEANUP_PID)"

# ── Start OpenClaw Gateway (restart loop for hot reload) ─────────────
# Set HOME=/data so OpenClaw's config path ($HOME/.openclaw/openclaw.json)
# matches our entrypoint write path (/data/.openclaw/openclaw.json).
# Without this, OpenClaw creates a nested config at $HOME/.openclaw/.openclaw/
export HOME=/data

# Ensure mcporter is on PATH so OpenClaw's mcporter skill can find it
export PATH="/data/node_modules/.bin:$PATH"

cd /opt/openclaw

while true; do
  # Source env overrides written by configSync (hot reload support)
  # This file contains `export KEY='value'` entries for updated secrets
  if [ -f /data/config/.env ]; then
    echo "[entrypoint] Sourcing /data/config/.env"
    . /data/config/.env
  fi

  echo "[entrypoint] Starting OpenClaw gateway on port 18789..."
  echo "[entrypoint] Provider: ${LLM_PROVIDER:-openrouter}, Model: ${LLM_MODEL:-openrouter/auto}"

  # Run openclaw gateway in background (not exec, so trap can catch signals)
  # The --allow-unconfigured flag lets it start even without full platform setup
  npx openclaw gateway --port 18789 --bind lan --allow-unconfigured &
  OPENCLAW_PID=$!
  echo "[entrypoint] OpenClaw gateway started (PID $OPENCLAW_PID)"

  # Write PID file so the Jarble API can signal process restarts
  echo "$OPENCLAW_PID" > /data/.openclaw.pid

  # Wait for OpenClaw to exit (or signal to arrive)
  # Use || true to prevent set -e from exiting on non-zero wait status
  EXIT_CODE=0
  wait $OPENCLAW_PID || EXIT_CODE=$?

  # Check for reload marker (written by configSync before killing the process)
  if [ -f /data/.reload ]; then
    echo "[entrypoint] Reload requested — restarting gateway with updated config..."
    rm -f /data/.reload
    sleep 1
    continue
  fi

  # No reload marker — normal exit or crash, break out of the loop
  echo "[entrypoint] OpenClaw exited with code $EXIT_CODE"
  rm -f /data/.openclaw.pid
  exit $EXIT_CODE
done
