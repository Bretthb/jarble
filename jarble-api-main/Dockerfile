FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source and build
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# Production image
FROM node:22-alpine

WORKDIR /app

# Copy built files and production deps
COPY package*.json ./
RUN npm ci --only=production

COPY --from=builder /app/dist ./dist

# Migration artifacts (drizzle-orm migrator reads these at runtime)
COPY drizzle-pg/ ./drizzle-pg/

# Entrypoint: migrate → seed → start
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/health || exit 1

# Run as non-root
USER node

EXPOSE 3001

CMD ["./entrypoint.sh"]
