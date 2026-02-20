#!/bin/sh
# ═══════════════════════════════════════════════════════════════════════
# File Watcher — Shared by all Jarble runtime images
# ═══════════════════════════════════════════════════════════════════════
#
# Watches /data/config/ for changes using inotifywait and notifies the
# Jarble API so it can sync PVC config changes back to the database.
#
# This runs as a background process alongside the main runtime gateway.
# It is NOT critical — if it crashes, forward sync (frontend → PVC)
# still works. Reverse sync (PVC → frontend) just stops until restart.
#
# Environment variables:
#   DEPLOYMENT_ID           — Unique deployment ID (from K8s Secret)
#   JARBLE_API_URL          — API base URL (default: K8s internal service)
#   CONFIG_WEBHOOK_SECRET   — Shared secret for authenticating webhook calls
# ═══════════════════════════════════════════════════════════════════════

WATCH_DIR="/data/config"
API_URL="${JARBLE_API_URL:-http://jarble-api.jarble.svc.cluster.local}/api/config-changed"
DEBOUNCE_SECONDS=2

# Ensure watch directory exists
mkdir -p "$WATCH_DIR"

echo "[file-watcher] Watching $WATCH_DIR for changes..."
echo "[file-watcher] Callback: $API_URL"
echo "[file-watcher] Deployment: ${DEPLOYMENT_ID:-unknown}"

# Watch for file modifications, creations, and deletions recursively
inotifywait -m -r -e modify,create,delete,moved_to "$WATCH_DIR" 2>/dev/null | while read dir event file; do
  # Debounce: wait for batch changes to settle (e.g., multiple files written at once)
  sleep "$DEBOUNCE_SECONDS"

  # Drain any queued events during debounce window
  # (inotifywait buffers events; we just want one callback per batch)

  echo "[file-watcher] Change detected: $event $dir$file — notifying API..."

  # Include Authorization header if CONFIG_WEBHOOK_SECRET is set
  AUTH_HEADER=""
  if [ -n "$CONFIG_WEBHOOK_SECRET" ]; then
    AUTH_HEADER="-H \"Authorization: Bearer $CONFIG_WEBHOOK_SECRET\""
  fi

  curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    $AUTH_HEADER \
    -d "{\"deploymentId\":\"$DEPLOYMENT_ID\"}" \
    --connect-timeout 5 \
    --max-time 10 \
    >/dev/null 2>&1 \
    || echo "[file-watcher] Warning: failed to notify API (is it reachable?)"
done

echo "[file-watcher] inotifywait exited — file watching stopped"
