#!/usr/bin/env bash
# Jarble Debug MCP Server — agent-to-agent debugging between Claude Code and OpenClaw bots.
# Requires the Jarble API to be running on localhost:3001 (or set JARBLE_API_URL).
set -euo pipefail

cd "$(dirname "$0")/../jarble-api-main"
exec npx tsx scripts/debug-mcp-server.ts "$@"
