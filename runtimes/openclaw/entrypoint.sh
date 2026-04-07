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

# ── No-op MCP path detection ──────────────────────────────────────────
# OpenClaw 2026.x has no first-class MCP integration — verified live in
# docs/audits/qa-bot-teams-2026-04-07.md. We previously selected between
# a PVC-deployed and a baked-in jarble-ui-server.js path here and exported
# JARBLE_MCP for the mcporter registration block below — but neither
# OpenClaw nor mcporter actually consumes the result at agent-turn time.
# The PVC copy at /data/config/mcp/jarble-ui-server.js IS still authoritative,
# but it is consumed by the Jarble API's proxy path:
#   POST /api/deployments/:id/mcp/invoke  →  canvasFiles.ts  →
#     kubectl exec node -e "require('/data/config/mcp/jarble-ui-server.js').executeTool(...)"
# No registration needed inside the pod.

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

# ── jarble-ui tools: no in-pod registration ───────────────────────────
# OpenClaw has no first-class MCP integration. The previous block here ran
# `mcporter config add jarble-ui ...` but mcporter is treated by OpenClaw
# as a *skill* (an external CLI it could shell out to via `exec`), not as
# a first-class tool source. On the live pod mcporter even reports
# `✗ missing` because OpenClaw's skill detection can't find the binary,
# and even if it could, OpenClaw's tool list at agent-turn time is hard-
# coded — adding a server with mcporter changes nothing.
#
# jarble-ui tools are exposed through the Jarble API's canvasFiles proxy
# instead — see kubectl-exec node -e "require('/data/config/mcp/jarble-ui-server.js')"
# in jarble-api-main/src/routes/canvasFiles.ts. Full audit:
# docs/audits/qa-bot-teams-2026-04-07.md.

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
