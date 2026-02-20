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
mkdir -p "$RUNTIME_DIR" "$CONFIG_DIR" "$OPENCLAW_HOME/workspace" "$LOG_DIR"

# ── Cleanup ephemeral storage ─────────────────────────────────────────
# Clear temp files to prevent ephemeral storage exhaustion
# (K8s evicts pods that exceed ephemeral-storage limits)
echo "[entrypoint] Cleaning ephemeral storage..."
rm -rf /tmp/* 2>/dev/null || true
rm -rf /.npm/_cacache 2>/dev/null || true
rm -rf /var/tmp/* 2>/dev/null || true

# ── First Boot: Initialize from pre-built image ─────────────────────
if [ ! -f "$INIT_MARKER" ]; then
  echo "[entrypoint] First boot — initializing OpenClaw runtime..."
  echo "[entrypoint] Deployment: ${DEPLOYMENT_NAME:-unknown} (${DEPLOYMENT_ID:-unknown})"

  cd "$RUNTIME_DIR"

  # Check if pre-built OpenClaw exists in image
  if [ -d "/opt/openclaw/node_modules/openclaw" ]; then
    echo "[entrypoint] Copying pre-built OpenClaw from image (instant startup)..."
    cp -r /opt/openclaw/package.json /opt/openclaw/package-lock.json /opt/openclaw/node_modules "$RUNTIME_DIR/" 2>/dev/null || true
    echo "[entrypoint] Pre-built OpenClaw copied successfully"
  else
    # Fallback: install from npm (slower, for non-prebuilt images)
    echo "[entrypoint] No pre-built OpenClaw found, installing from npm..."
    if [ ! -f "package.json" ]; then
      npm init -y 2>/dev/null || true
    fi
    npm install openclaw@latest 2>&1 | tee "$LOG_DIR/install.log"
    npx openclaw plugins enable whatsapp 2>&1 || echo "[entrypoint] Warning: could not enable whatsapp plugin"
  fi

  # Write default soul.md if Jarble API hasn't written one yet
  if [ ! -f "$CONFIG_DIR/soul.md" ]; then
    echo "You are a helpful AI assistant." > "$CONFIG_DIR/soul.md"
    echo "[entrypoint] Created default soul.md"
  fi

  # Generate initial OpenClaw config
  # This maps Jarble's env vars to OpenClaw's config format
  # Includes WhatsApp channel with dmPolicy: pairing for QR flow
  cat > "$OPENCLAW_HOME/openclaw.json" << OCEOF
{
  "agent": {
    "model": "${LLM_MODEL:-openrouter/auto}",
    "provider": "${LLM_PROVIDER:-openrouter}"
  },
  "gateway": {
    "port": 18789,
    "host": "0.0.0.0"
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
  echo "[entrypoint] Generated openclaw.json config"

  # Mark initialization complete
  touch "$INIT_MARKER"
  echo "[entrypoint] Initialization complete."
else
  echo "[entrypoint] Already initialized, skipping setup."
  echo "[entrypoint] Deployment: ${DEPLOYMENT_NAME:-unknown} (${DEPLOYMENT_ID:-unknown})"
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
    rm -rf /.npm/_cacache 2>/dev/null || true
    rm -rf /var/tmp/* 2>/dev/null || true
    echo "[cleanup] Cleared ephemeral storage at $(date -Iseconds)"
  done
) &
CLEANUP_PID=$!
echo "[entrypoint] Periodic cleanup started (PID $CLEANUP_PID)"

# ── Start OpenClaw Gateway ───────────────────────────────────────────
cd "$RUNTIME_DIR"
echo "[entrypoint] Starting OpenClaw gateway on port 18789..."
echo "[entrypoint] Provider: ${LLM_PROVIDER:-openrouter}, Model: ${LLM_MODEL:-openrouter/auto}"

# Run openclaw gateway in foreground (not exec, so trap can catch signals)
# The --allow-unconfigured flag lets it start even without full platform setup
npx openclaw gateway --port 18789 --bind lan --allow-unconfigured &
OPENCLAW_PID=$!
echo "[entrypoint] OpenClaw gateway started (PID $OPENCLAW_PID)"

# Wait for OpenClaw to exit (or signal to arrive)
wait $OPENCLAW_PID
EXIT_CODE=$?

echo "[entrypoint] OpenClaw exited with code $EXIT_CODE"
exit $EXIT_CODE
