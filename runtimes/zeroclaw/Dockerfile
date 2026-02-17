# ═══════════════════════════════════════════════════════════════════════
# ZeroClaw Base Image — Jarble AI Platform
# ═══════════════════════════════════════════════════════════════════════
#
# Wraps the upstream ZeroClaw Rust binary with Jarble's entrypoint
# and PVC directory layout. ZeroClaw is a ~3.4MB binary — ultra-lightweight.
#
# ZeroClaw: Rust-based autonomous AI assistant framework.
# Supports 22+ AI providers, SQLite w/ hybrid search, modular architecture.
#
# Build:  docker build -t ghcr.io/jarble-ai/zeroclaw:latest .
# Run:    docker run -v mydata:/data -p 3000:3000 ghcr.io/jarble-ai/zeroclaw:latest
# ═══════════════════════════════════════════════════════════════════════

# ── Stage 1: Pull binary from upstream GHCR image ────────────────────
# Instead of compiling from source (slow, needs full Rust toolchain),
# we extract the pre-built binary from the upstream release image.
FROM ghcr.io/theonlyhennygod/zeroclaw:latest AS upstream

# ── Stage 2: Production image ────────────────────────────────────────
# Using Debian slim instead of distroless so we can run shell scripts
# for the entrypoint bootstrap logic.
FROM debian:bookworm-slim

# Install minimal runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tini \
    inotify-tools \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy ZeroClaw binary from upstream image
COPY --from=upstream /usr/local/bin/zeroclaw /usr/local/bin/zeroclaw
RUN chmod +x /usr/local/bin/zeroclaw

# ── Create PVC directory structure ────────────────────────────────────
RUN mkdir -p /data/config /data/zeroclaw-data /data/logs

# ── Copy entrypoint + file watcher ─────────────────────────────────
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
COPY file-watcher.sh /usr/local/bin/file-watcher.sh
RUN chmod +x /usr/local/bin/entrypoint.sh /usr/local/bin/file-watcher.sh

# ── Environment defaults ─────────────────────────────────────────────
# ZeroClaw reads these env vars directly
ENV PROVIDER=openrouter
ENV ZEROCLAW_ALLOW_PUBLIC_BIND=true
ENV HOME=/data

# ── Working directory ────────────────────────────────────────────────
WORKDIR /data

# ── Ports ────────────────────────────────────────────────────────────
# 3000: Gateway API
EXPOSE 3000

# ── Health check ─────────────────────────────────────────────────────
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD zeroclaw doctor || exit 1

# ── Use tini as PID 1 for proper signal handling ────────────────────
ENTRYPOINT ["tini", "--", "/usr/local/bin/entrypoint.sh"]
