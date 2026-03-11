#!/usr/bin/env bash
# Setup script for CodeGraphContext (graph DB for code analysis)
#
# Prerequisites:
#   - Python 3.10+ (py launcher on Windows, python3 on Unix)
#   - Docker (for Neo4j)
#
# Usage:
#   bash scripts/codegraph/setup.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== CodeGraphContext Setup ==="

# 1. Find Python
PYTHON=""
if command -v py &>/dev/null; then
  PYTHON="py"
elif command -v python3 &>/dev/null; then
  PYTHON="python3"
elif command -v python &>/dev/null; then
  PYTHON="python"
else
  echo "ERROR: Python not found. Install Python 3.10+ first."
  exit 1
fi
echo "Using Python: $($PYTHON --version)"

# 2. Install codegraphcontext
echo ""
echo "Installing codegraphcontext..."
$PYTHON -m pip install codegraphcontext --quiet

# 3. Start Neo4j via Docker
echo ""
echo "Starting Neo4j container..."
cd "$SCRIPT_DIR"
docker compose up -d

# 4. Wait for Neo4j Bolt port to be ready (not just process running)
echo "Waiting for Neo4j to accept connections..."
for i in $(seq 1 60); do
  if docker logs jarble-codegraph --tail 5 2>&1 | grep -q "Started\."; then
    echo "Neo4j is ready."
    break
  fi
  if [ "$i" -eq 60 ]; then
    echo "WARNING: Neo4j did not start within 120s. Check: docker logs jarble-codegraph"
    exit 1
  fi
  sleep 2
done

# 5. Configure cgc
export PYTHONIOENCODING=utf-8
CGC_DIR="$HOME/.codegraphcontext"
mkdir -p "$CGC_DIR"

# Only write config if credentials aren't already set
if ! grep -q "NEO4J_URI" "$CGC_DIR/.env" 2>/dev/null; then
  echo "Configuring cgc for Neo4j..."
  $PYTHON -m codegraphcontext config set DEFAULT_DATABASE neo4j 2>/dev/null || true
  # Append credentials to .env
  cat >> "$CGC_DIR/.env" <<'EOF'

# ===== Database Credentials =====
NEO4J_URI=bolt://localhost:7687
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=codegraph
NEO4J_DATABASE=neo4j
EOF
else
  echo "cgc already configured for Neo4j."
fi

# 6. Index the repository
echo ""
echo "Indexing repository (this takes 5-10 minutes on first run)..."
cd "$REPO_ROOT"
$PYTHON -m codegraphcontext index .

echo ""
echo "=== Setup Complete ==="
echo ""
echo "The graph database is ready. Tools available:"
echo "  cgc find name <function>       - Find a function/class"
echo "  cgc analyze callers <function> - Find callers"
echo "  cgc analyze calls <function>   - Find callees"
echo "  cgc analyze dead-code          - Find unused code"
echo "  cgc analyze complexity         - Cyclomatic complexity"
echo "  cgc stats                      - Database statistics"
echo ""
echo "Claude Code MCP server is configured in .claude/settings.json."
echo "Restart Claude Code to activate the MCP tools."
