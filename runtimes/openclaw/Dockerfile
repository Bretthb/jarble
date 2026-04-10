# ═══════════════════════════════════════════════════════════════════════
# OpenClaw Runtime Image — Jarble AI Platform
# ═══════════════════════════════════════════════════════════════════════
#
# Self-contained image with OpenClaw, mcporter, and the Jarble UI MCP
# server pre-installed. No npm install on boot — ready in seconds.
#
# Baked in:
#   /opt/openclaw/           — OpenClaw runtime + node_modules
#   /opt/jarble/mcp/         — Jarble UI MCP server (jarble-ui-server.js)
#   /opt/openclaw/node_modules/.bin/mcporter — MCP bridge
#
# Build:  docker build -t ghcr.io/jarble-ai/openclaw:latest .
# Run:    docker run -v mydata:/data -p 18789:18789 ghcr.io/jarble-ai/openclaw:latest
# ═══════════════════════════════════════════════════════════════════════

FROM node:22-bookworm-slim

# ── System dependencies ───────────────────────────────────────────────
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    tini \
    ca-certificates \
    inotify-tools \
    curl \
    && rm -rf /var/lib/apt/lists/*

# ── Pre-install OpenClaw + mcporter ───────────────────────────────────
# Both installed to /opt/openclaw/ — baked into the image layer.
# mcporter bridges our Jarble UI MCP server to OpenClaw's skill system.
# Pin to specific version for reproducibility; bump to update.
ARG OPENCLAW_VERSION=2026.3.13
WORKDIR /opt/openclaw
RUN npm init -y && \
    npm install openclaw@${OPENCLAW_VERSION} mcporter && \
    npx openclaw plugins enable whatsapp && \
    chown -R node:node /opt/openclaw

# ── Install OTel bridge dependencies (JAR-51 Phase 2) ────────────────
# Minimal set: SDK + OTLP exporter + auto-instrumentations (HTTP/fetch).
# Enables cross-pod trace stitching — the bridge reads TRACEPARENT from
# the env and attaches LLM call spans under the API caller's trace.
# ~12MB installed footprint. Kept in /opt/openclaw/node_modules alongside
# the OpenClaw runtime so NODE_OPTIONS=--require can find them.
RUN npm install --no-save \
    @opentelemetry/api@^1.9.1 \
    @opentelemetry/sdk-node@^0.214.0 \
    @opentelemetry/exporter-trace-otlp-http@^0.214.0 \
    @opentelemetry/resources@^2.6.1 \
    @opentelemetry/sdk-trace-node@^2.6.1 \
    @opentelemetry/semantic-conventions@^1.40.0 \
    @opentelemetry/auto-instrumentations-node@^0.72.0

# ── Copy OTel bridge preload script ─────────────────────────────────
# MUST live under /opt/openclaw/ so Node.js require() resolves the
# @opentelemetry/* packages from /opt/openclaw/node_modules/.
COPY otel-bridge.cjs /opt/openclaw/otel-bridge.cjs

# ── Copy Jarble UI MCP server ────────────────────────────────────────
# Zero-dependency Node.js script that exposes render_ui, define_component,
# list_components, component_reference tools via stdio MCP protocol.
#
# IMPORTANT: jarble-ui-server.js is NOT committed to runtimes/openclaw/.
# The canonical source lives at jarble-api-main/src/mcp/jarble-ui-server.js
# and CI copies it into this build context fresh on every build (see
# .github/workflows/deploy-runtimes.yml). For local builds run:
#   cp jarble-api-main/src/mcp/jarble-ui-server.js runtimes/openclaw/
# before invoking `docker build`.
COPY jarble-ui-server.js /opt/jarble/mcp/jarble-ui-server.js
RUN chown -R node:node /opt/jarble

# ── Create PVC directory structure ────────────────────────────────────
# Fallback dirs for local testing (in prod, /data/ is a Longhorn PVC mount)
RUN mkdir -p /data/config /data/logs /data/.openclaw/workspace /data/components \
    && chown -R node:node /data

# ── Copy entrypoint + file watcher ───────────────────────────────────
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY file-watcher.sh /usr/local/bin/file-watcher.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/file-watcher.sh

# ── Environment defaults ─────────────────────────────────────────────
ENV NODE_ENV=production
ENV HOME=/data
ENV OPENCLAW_HOME=/data/.openclaw
# JAR-51 Phase 2: preload the OTel bridge for ALL Node.js processes in
# the container — both the long-lived gateway (started by entrypoint.sh)
# and one-shot `openclaw agent` processes (started via kubectl exec from
# chatViaExec). This MUST be a Dockerfile ENV, not an entrypoint export,
# because kubectl exec processes don't inherit entrypoint-set env vars.
# The bridge is a no-op when LANGFUSE/OTEL keys are absent — zero overhead.
ENV NODE_OPTIONS="--require /opt/openclaw/otel-bridge.cjs"
WORKDIR /opt/openclaw

# ── Run as non-root user ─────────────────────────────────────────────
USER node

EXPOSE 18789 18790

ENTRYPOINT ["tini", "--", "/usr/local/bin/entrypoint.sh"]
