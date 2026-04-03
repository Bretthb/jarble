FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY jarble-api-main/package*.json ./jarble-api-main/
RUN cd jarble-api-main && npm ci

# Copy shared package (resolved via tsconfig paths)
COPY shared/ ./shared/

# Copy source and build
COPY jarble-api-main/tsconfig.json ./jarble-api-main/
COPY jarble-api-main/src/ ./jarble-api-main/src/
RUN cd jarble-api-main && npm run build

# Production image
FROM node:22-alpine

WORKDIR /app

# Copy built files and production deps
COPY jarble-api-main/package*.json ./
RUN npm ci --omit=dev

# Copy compiled output preserving directory structure
# tsc outputs to dist/jarble-api-main/src/ and dist/shared/ (rootDir is monorepo root)
COPY --from=builder /app/jarble-api-main/dist ./dist

# Resolve @jarble/component-manifest path alias at runtime
# tsc compiles shared/ to dist/shared/ but Node.js needs a real module path
RUN mkdir -p node_modules/@jarble && ln -s /app/dist/shared/component-manifest node_modules/@jarble/component-manifest

# Migration artifacts (drizzle-orm migrator reads these at runtime)
COPY jarble-api-main/drizzle-pg/ ./drizzle-pg/

# MCP server (not compiled by tsc — runs as plain JS)
COPY jarble-api-main/src/mcp/jarble-ui-server.js ./dist/jarble-api-main/src/mcp/jarble-ui-server.js

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Run as non-root
USER node

EXPOSE 3001

CMD ["sh", "-c", "node dist/jarble-api-main/src/db/migrate.pg.js && node dist/jarble-api-main/src/db/seed.pg.js && node dist/jarble-api-main/src/index.js"]
