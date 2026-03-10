#!/usr/bin/env bash
# Cross-platform wrapper to start the CodeGraphContext MCP server.
# Resolves the Python interpreter automatically (works on Windows + Unix).
set -euo pipefail

export PYTHONIOENCODING=utf-8

# Try common Python commands in order of preference
if command -v py &>/dev/null; then
  exec py -m codegraphcontext mcp start "$@"
elif command -v python3 &>/dev/null; then
  exec python3 -m codegraphcontext mcp start "$@"
elif command -v python &>/dev/null; then
  exec python -m codegraphcontext mcp start "$@"
else
  echo "Error: Python not found. Install Python 3.10+ and run: pip install codegraphcontext" >&2
  exit 1
fi
