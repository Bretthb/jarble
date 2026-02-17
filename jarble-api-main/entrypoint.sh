#!/bin/sh
set -e

echo "[entrypoint] Running migrations..."
node dist/db/migrate.pg.js

echo "[entrypoint] Seeding runtime catalog..."
node dist/db/seed.pg.js

echo "[entrypoint] Starting API server..."
exec node dist/index.js
