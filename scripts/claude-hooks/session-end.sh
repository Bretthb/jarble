#!/usr/bin/env bash
# Claude Code Stop hook — copies local memory to committed directory and stages for git
# Runs at the end of every Claude Code session.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMMITTED_MEMORY="$REPO_ROOT/.claude/memory"
COMMITTED_AGENT_MEMORY="$REPO_ROOT/.claude/agent-memory"

# Find local Claude memory directory
find_local_memory() {
  local projects_dir="$HOME/.claude/projects"
  if [[ ! -d "$projects_dir" ]]; then
    return 1
  fi

  local repo_name
  repo_name="$(basename "$REPO_ROOT")"

  for dir in "$projects_dir"/*/; do
    if [[ "$(basename "$dir")" == *"$repo_name"* ]] && [[ -d "${dir}memory" ]]; then
      echo "${dir}memory"
      return 0
    fi
  done
  return 1
}

LOCAL_MEMORY="$(find_local_memory 2>/dev/null || true)"

if [[ -z "$LOCAL_MEMORY" ]]; then
  exit 0
fi

# Copy local memory files → committed
mkdir -p "$COMMITTED_MEMORY"
cp "$LOCAL_MEMORY"/*.md "$COMMITTED_MEMORY/" 2>/dev/null || true

# Stage memory changes for next commit
cd "$REPO_ROOT"
git add .claude/memory/ 2>/dev/null || true
git add .claude/agent-memory/ 2>/dev/null || true

# Check for new agent memory findings that should be promoted to rules
AGENT_CHANGES=$(git diff --cached --name-only .claude/agent-memory/ 2>/dev/null | head -5)
if [[ -n "$AGENT_CHANGES" ]]; then
  echo "{\"additionalContext\":\"Agent memory was updated this session. Review these for findings worth promoting to .claude/rules/: $AGENT_CHANGES\"}"
fi
