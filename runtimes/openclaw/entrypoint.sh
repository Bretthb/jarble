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
# OpenClaw runs directly from /opt/openclaw (baked into the image).
# mcporter and jarble-ui-server.js are also baked in.
# The PVC (/data/) only holds state — no npm install needed.
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
#   components/           — Custom component definitions
#   logs/                 — Application logs
# ═══════════════════════════════════════════════════════════════════════

INIT_MARKER="/data/.initialized"
CONFIG_DIR="/data/config"
OPENCLAW_HOME="/data/.openclaw"
OPENCLAW_STATE="/data/.openclaw/.openclaw"
LOG_DIR="/data/logs"
# Prefer PVC-deployed version (updated by configSync) over baked-in image version
JARBLE_MCP_PVC="/data/config/mcp/jarble-ui-server.js"
JARBLE_MCP_BAKED="/opt/jarble/mcp/jarble-ui-server.js"
if [ -f "$JARBLE_MCP_PVC" ]; then
  JARBLE_MCP="$JARBLE_MCP_PVC"
  echo "[entrypoint] Using PVC-deployed MCP server"
else
  JARBLE_MCP="$JARBLE_MCP_BAKED"
  echo "[entrypoint] Using baked-in MCP server (PVC version not found)"
fi

# Track background process PIDs for cleanup
WATCHER_PID=""
CLEANUP_PID=""
OPENCLAW_PID=""

# ── Graceful shutdown handler ─────────────────────────────────────────
cleanup() {
  echo "[entrypoint] Received shutdown signal, cleaning up..."

  if [ -n "$WATCHER_PID" ] && kill -0 "$WATCHER_PID" 2>/dev/null; then
    echo "[entrypoint] Stopping file watcher (PID $WATCHER_PID)"
    kill "$WATCHER_PID" 2>/dev/null || true
  fi

  if [ -n "$CLEANUP_PID" ] && kill -0 "$CLEANUP_PID" 2>/dev/null; then
    echo "[entrypoint] Stopping cleanup loop (PID $CLEANUP_PID)"
    kill "$CLEANUP_PID" 2>/dev/null || true
  fi

  if [ -n "$OPENCLAW_PID" ] && kill -0 "$OPENCLAW_PID" 2>/dev/null; then
    echo "[entrypoint] Stopping OpenClaw gateway (PID $OPENCLAW_PID)"
    kill -TERM "$OPENCLAW_PID" 2>/dev/null || true

    timeout=25
    while [ $timeout -gt 0 ] && kill -0 "$OPENCLAW_PID" 2>/dev/null; do
      sleep 1
      timeout=$((timeout - 1))
    done

    if kill -0 "$OPENCLAW_PID" 2>/dev/null; then
      echo "[entrypoint] OpenClaw did not exit gracefully, forcing..."
      kill -9 "$OPENCLAW_PID" 2>/dev/null || true
    fi
  fi

  echo "[entrypoint] Shutdown complete"
  exit 0
}

trap cleanup 15 2 3

# Ensure directories exist (PVC may be fresh)
mkdir -p "$CONFIG_DIR" "$OPENCLAW_HOME/workspace" "$OPENCLAW_STATE" "$LOG_DIR" /data/components

# ── Cleanup ephemeral storage ─────────────────────────────────────────
echo "[entrypoint] Cleaning ephemeral storage..."
rm -rf /tmp/* 2>/dev/null || true
rm -rf /var/tmp/* 2>/dev/null || true

# ── First Boot: Write default configs ─────────────────────────────────
if [ ! -f "$INIT_MARKER" ]; then
  echo "[entrypoint] First boot — writing default configs..."
  echo "[entrypoint] Deployment: ${DEPLOYMENT_NAME:-unknown} (${DEPLOYMENT_ID:-unknown})"

  # Write default soul.md if Jarble API hasn't written one yet
  # (Phase 1 ConfigMap init container may have already placed it)
  if [ ! -f "$CONFIG_DIR/soul.md" ]; then
    echo "You are a helpful AI assistant." > "$CONFIG_DIR/soul.md"
    echo "[entrypoint] Created default soul.md"
  fi

  # Generate initial OpenClaw config only if the ConfigMap init container
  # hasn't already placed one (Phase 1 writes to OPENCLAW_STATE)
  if [ ! -f "$OPENCLAW_STATE/openclaw.json" ]; then
    MODEL_REF="${LLM_MODEL:-openrouter/auto}"
    case "$MODEL_REF" in
      */*) ;;
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
    "controlUi": { "dangerouslyAllowHostHeaderOriginFallback": true },
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
  else
    echo "[entrypoint] openclaw.json already present (from ConfigMap), skipping generation"
  fi

  touch "$INIT_MARKER"
  echo "[entrypoint] Initialization complete."
else
  echo "[entrypoint] Already initialized, skipping setup."
  echo "[entrypoint] Deployment: ${DEPLOYMENT_NAME:-unknown} (${DEPLOYMENT_ID:-unknown})"
fi

# ── Register Jarble UI MCP server ─────────────────────────────────────
# mcporter bridges the jarble-ui-server.js (stdio MCP) to OpenClaw's
# skill system, giving the bot render_ui, define_component, etc. tools.
# Re-registers on every start to pick up PVC-deployed updates from configSync.
if [ -f "$JARBLE_MCP" ]; then
  echo "[entrypoint] Registering jarble-ui MCP server ($JARBLE_MCP)..."
  # Remove stale registration if present, then re-add with current path
  /opt/openclaw/node_modules/.bin/mcporter config remove jarble-ui 2>/dev/null || true
  /opt/openclaw/node_modules/.bin/mcporter config add jarble-ui \
    --command node --arg "$JARBLE_MCP" \
    --description "Jarble UI canvas components" \
    --scope home 2>&1 || echo "[entrypoint] Warning: mcporter registration failed (non-fatal)"
  echo "[entrypoint] jarble-ui MCP server registered"
fi

# ── Start file watcher (background) ──────────────────────────────────
if command -v inotifywait >/dev/null 2>&1; then
  /usr/local/bin/file-watcher.sh &
  WATCHER_PID=$!
  echo "[entrypoint] File watcher started in background (PID $WATCHER_PID)"
else
  echo "[entrypoint] Warning: inotifywait not found, file watcher disabled"
fi

# ── Periodic temp cleanup (background) ────────────────────────────────
(
  while true; do
    sleep 3600
    rm -rf /tmp/* 2>/dev/null || true
    rm -rf /var/tmp/* 2>/dev/null || true
    echo "[cleanup] Cleared ephemeral storage at $(date -Iseconds)"
  done
) &
CLEANUP_PID=$!
echo "[entrypoint] Periodic cleanup started (PID $CLEANUP_PID)"

# ── Start OpenClaw Gateway (restart loop for hot reload) ─────────────
export HOME=/data
export PATH="/opt/openclaw/node_modules/.bin:$PATH"

cd /opt/openclaw

while true; do
  # Source env overrides written by configSync (hot reload support)
  if [ -f /data/config/.env ]; then
    echo "[entrypoint] Sourcing /data/config/.env"
    . /data/config/.env
  fi

  echo "[entrypoint] Starting OpenClaw gateway on port 18789..."
  echo "[entrypoint] Provider: ${LLM_PROVIDER:-openrouter}, Model: ${LLM_MODEL:-openrouter/auto}"

  /opt/openclaw/node_modules/.bin/openclaw gateway --port 18789 --bind lan --allow-unconfigured &
  OPENCLAW_PID=$!
  echo "[entrypoint] OpenClaw gateway started (PID $OPENCLAW_PID)"

  echo "$OPENCLAW_PID" > /data/.openclaw.pid

  EXIT_CODE=0
  wait $OPENCLAW_PID || EXIT_CODE=$?

  if [ -f /data/.reload ]; then
    echo "[entrypoint] Reload requested — restarting gateway with updated config..."
    rm -f /data/.reload
    sleep 1
    continue
  fi

  echo "[entrypoint] OpenClaw exited with code $EXIT_CODE"
  rm -f /data/.openclaw.pid
  exit $EXIT_CODE
done
