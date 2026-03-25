#!/usr/bin/env bash
# Jarble Debug MCP Server — agent-to-agent debugging between Claude Code and OpenClaw bots.
# Requires the Jarble API to be running on localhost:3001 (or set JARBLE_API_URL).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR/../jarble-api-main"

# Use node directly with the local tsx, falling back to npx-cli.js
NODE="C:/nvm4w/nodejs/node.exe"
NPX="C:/nvm4w/nodejs/node_modules/npm/bin/npx-cli.js"

if [ -f "node_modules/.bin/tsx" ]; then
  exec "$NODE" node_modules/.bin/tsx scripts/debug-mcp-server.ts "$@"
else
  exec "$NODE" "$NPX" tsx scripts/debug-mcp-server.ts "$@"
fi
