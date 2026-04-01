# ═══════════════════════════════════════════════════════════════════════
# Jarble Frontend — Multi-stage Docker Build
# ═══════════════════════════════════════════════════════════════════════
#
# Build context: monorepo root (not Jarble-mvp/)
#
#   docker build -f Jarble-mvp/Dockerfile \
#     --build-arg NEXT_PUBLIC_API_URL=https://api.jarble.ai \
#     --build-arg NEXT_PUBLIC_APP_URL=https://jarble.ai \
#     --build-arg NEXT_PUBLIC_AUTH0_DOMAIN=... \
#     --build-arg NEXT_PUBLIC_AUTH0_CLIENT_ID=... \
#     --build-arg NEXT_PUBLIC_AUTH0_AUDIENCE=https://api.jarble.ai \
#     -t jarble-frontend .
#
# ═══════════════════════════════════════════════════════════════════════

# ---- Stage 1: Install deps + generate API types ----
FROM node:22-alpine AS deps

WORKDIR /app

# API deps (needed for type generation only)
COPY jarble-api-main/package*.json ./jarble-api-main/
COPY jarble-api-main/tsconfig.json jarble-api-main/tsconfig.declarations.json ./jarble-api-main/
RUN cd jarble-api-main && npm ci

# Shared package (raw TS, consumed via transpilePackages)
COPY shared/ ./shared/

# Generate API type declarations (.d.ts files → jarble-api-main/dist/)
COPY jarble-api-main/src/ ./jarble-api-main/src/
RUN cd jarble-api-main && npm run build:types

# Frontend deps — pnpm matches CI pipeline (ci.yml uses pnpm@10.4.1)
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
COPY Jarble-mvp/package.json Jarble-mvp/pnpm-lock.yaml Jarble-mvp/.npmrc ./Jarble-mvp/
RUN cd Jarble-mvp && pnpm install --frozen-lockfile


# ---- Stage 2: Build Next.js ----
FROM node:22-alpine AS builder

WORKDIR /app

# Copy deps + generated types from stage 1
COPY --from=deps /app/jarble-api-main ./jarble-api-main
COPY --from=deps /app/shared ./shared
COPY --from=deps /app/Jarble-mvp/node_modules ./Jarble-mvp/node_modules

# Copy frontend source
COPY Jarble-mvp/ ./Jarble-mvp/

# NEXT_PUBLIC_* vars are baked into JS bundles at build time
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_AUTH0_DOMAIN
ARG NEXT_PUBLIC_AUTH0_CLIENT_ID
ARG NEXT_PUBLIC_AUTH0_AUDIENCE
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_SENTRY_DSN

ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_AUTH0_DOMAIN=$NEXT_PUBLIC_AUTH0_DOMAIN \
    NEXT_PUBLIC_AUTH0_CLIENT_ID=$NEXT_PUBLIC_AUTH0_CLIENT_ID \
    NEXT_PUBLIC_AUTH0_AUDIENCE=$NEXT_PUBLIC_AUTH0_AUDIENCE \
    NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=$NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY \
    NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN

RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
RUN cd Jarble-mvp && pnpm run build


# ---- Stage 3: Production runtime ----
FROM node:22-alpine AS runner

WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# sharp for next/image optimization (not in package.json, installed separately)
RUN npm install --no-save sharp@0.33

# Standalone output: server.js at root, static/public need manual copy
COPY --from=builder /app/Jarble-mvp/.next/standalone ./
COPY --from=builder /app/Jarble-mvp/.next/static ./.next/static
COPY --from=builder /app/Jarble-mvp/public ./public

USER nextjs

EXPOSE 3000

ENV PORT=3000 \
    HOSTNAME="0.0.0.0" \
    NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "server.js"]
