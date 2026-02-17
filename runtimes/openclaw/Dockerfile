# ═══════════════════════════════════════════════════════════════════════
# OpenClaw Base Image — Jarble AI Platform
# ═══════════════════════════════════════════════════════════════════════
#
# Stateless container that bootstraps the OpenClaw runtime on first boot.
# Config + node_modules live on persistent storage (PVC mounted at /data/).
#
# OpenClaw: TypeScript/Node.js AI assistant with WhatsApp, Telegram,
# Discord, Slack, and other channel integrations.
#
# Build:  docker build -t ghcr.io/jarble-ai/openclaw:latest .
# Run:    docker run -v mydata:/data -p 18789:18789 ghcr.io/jarble-ai/openclaw:latest
# ═══════════════════════════════════════════════════════════════════════

FROM node:22-bookworm-slim

# ── System dependencies ───────────────────────────────────────────────
# OpenClaw uses Baileys (WhatsApp gateway) — HTTP-based, no browser needed.
# Install minimal deps: git (for some npm packages), tini (PID 1 init).
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    tini \
    ca-certificates \
    inotify-tools \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Create PVC directory structure ────────────────────────────────────
# These directories are created in the image as fallbacks.
# In production, /data/ is a Longhorn PVC mount — these ensure the
# entrypoint works even without a volume (for local testing).
RUN mkdir -p /data/config /data/runtime /data/logs /data/.openclaw/workspace

# ── Copy entrypoint + file watcher ─────────────────────────────────
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY file-watcher.sh /usr/local/bin/file-watcher.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/file-watcher.sh

# ── Environment defaults ─────────────────────────────────────────────
# These can be overridden by K8s Secret env vars
ENV NODE_ENV=production
ENV HOME=/data
ENV OPENCLAW_HOME=/data/.openclaw

# ── Working directory ────────────────────────────────────────────────
WORKDIR /data/runtime

# ── Ports ────────────────────────────────────────────────────────────
# 18789: Gateway API (main)
# 18790: Bridge (platform connections)
EXPOSE 18789 18790

# ── Use tini as PID 1 for proper signal handling ────────────────────
ENTRYPOINT ["tini", "--", "/usr/local/bin/entrypoint.sh"]
