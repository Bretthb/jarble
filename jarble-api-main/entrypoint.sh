#!/bin/sh
set -e

echo "[entrypoint] Running migrations..."
node dist/jarble-api-main/src/db/migrate.pg.js

echo "[entrypoint] Seeding runtime catalog..."
node dist/jarble-api-main/src/db/seed.pg.js

echo "[entrypoint] Starting API server..."
exec node dist/jarble-api-main/src/index.js
