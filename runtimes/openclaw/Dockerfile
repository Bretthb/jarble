# ═══════════════════════════════════════════════════════════════════════
# OpenClaw Pre-built Image — Jarble AI Platform
# ═══════════════════════════════════════════════════════════════════════
#
# Pre-built image with OpenClaw already installed for instant startup.
# No npm install on first boot — ready to serve in seconds.
#
# OpenClaw: TypeScript/Node.js AI assistant with WhatsApp, Telegram,
# Discord, Slack, and other channel integrations.
#
# Build:  docker build -t ghcr.io/jarble-ai/openclaw:prebuilt .
# Run:    docker run -v mydata:/data -p 18789:18789 ghcr.io/jarble-ai/openclaw:prebuilt
#
# Note: This is a test image. Production images will include pre-installed
# skills and additional plugins.
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

# ── Pre-install OpenClaw ──────────────────────────────────────────────
# Install to /opt/openclaw/ so it's baked into the image.
# OpenClaw runs directly from here — no copy to PVC needed.
WORKDIR /opt/openclaw
RUN npm init -y && \
    npm install openclaw@latest && \
    npx openclaw plugins enable whatsapp && \
    chown -R node:node /opt/openclaw

# ── Create PVC directory structure ────────────────────────────────────
# These directories are created in the image as fallbacks.
# In production, /data/ is a Longhorn PVC mount — these ensure the
# entrypoint works even without a volume (for local testing).
# Owned by node user (uid 1000) for non-root execution.
RUN mkdir -p /data/config /data/logs /data/.openclaw/workspace \
    && chown -R node:node /data

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
# OpenClaw runs from /opt/openclaw (node_modules baked into image)
WORKDIR /opt/openclaw

# ── Run as non-root user ──────────────────────────────────────────────
# node:22-bookworm-slim includes a 'node' user with uid 1000
USER node

# ── Ports ────────────────────────────────────────────────────────────
# 18789: Gateway API (main)
# 18790: Bridge (platform connections)
EXPOSE 18789 18790

# ── Use tini as PID 1 for proper signal handling ────────────────────
ENTRYPOINT ["tini", "--", "/usr/local/bin/entrypoint.sh"]
