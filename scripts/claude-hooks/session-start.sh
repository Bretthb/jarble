#!/usr/bin/env bash
# Claude Code SessionStart hook — syncs portable memory to/from local memory
# Runs at the beginning of every Claude Code session.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
COMMITTED_MEMORY="$REPO_ROOT/.claude/memory"

# Find local Claude memory directory by searching ~/.claude/projects/
# Claude uses a path-encoded directory name like C--Users-brett-develop-monorepo
find_local_memory() {
  local projects_dir="$HOME/.claude/projects"
  if [[ ! -d "$projects_dir" ]]; then
    return 1
  fi

  # Get the repo basename to match against project directory names
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
  # No local memory dir found — create it and seed from committed
  LOCAL_MEMORY="$HOME/.claude/projects/$(basename "$REPO_ROOT")/memory"
  mkdir -p "$LOCAL_MEMORY"
  if [[ -d "$COMMITTED_MEMORY" ]]; then
    cp "$COMMITTED_MEMORY"/*.md "$LOCAL_MEMORY/" 2>/dev/null || true
  fi
  NEW_MACHINE_NOTE="NEW MACHINE DETECTED. Memory restored from git. Things that did NOT transfer: (1) .claude/settings.local.json (tool permission allowlists) — you will be re-prompted to approve tools. (2) Installed Claude Code skills — run 'claude skills install' to reinstall. (3) .env files — copy manually (API: jarble-api-main/.env, Frontend: Jarble-mvp/.env.local). Inform the user of these on first interaction."
  echo "{\"additionalContext\":\"$NEW_MACHINE_NOTE\"}"
  exit 0
fi

# Both directories exist — sync based on which is newer
if [[ ! -f "$COMMITTED_MEMORY/MEMORY.md" ]]; then
  # No committed memory yet — copy local to committed
  cp "$LOCAL_MEMORY"/*.md "$COMMITTED_MEMORY/" 2>/dev/null || true
  echo '{"additionalContext":"Local memory copied to committed (first sync)"}'
  exit 0
fi

# Compare timestamps — use MEMORY.md as the reference file
LOCAL_TS=$(stat -c %Y "$LOCAL_MEMORY/MEMORY.md" 2>/dev/null || stat -f %m "$LOCAL_MEMORY/MEMORY.md" 2>/dev/null || echo 0)
COMMITTED_TS=$(stat -c %Y "$COMMITTED_MEMORY/MEMORY.md" 2>/dev/null || stat -f %m "$COMMITTED_MEMORY/MEMORY.md" 2>/dev/null || echo 0)

if [[ "$COMMITTED_TS" -gt "$LOCAL_TS" ]]; then
  # Committed is newer — restore to local (switching machines)
  cp "$COMMITTED_MEMORY"/*.md "$LOCAL_MEMORY/" 2>/dev/null || true
  SWITCH_NOTE="Memory restored from git (switching machines). Reminder: .claude/settings.local.json (permissions), installed skills, and .env files do not transfer — see CLAUDE.md Developer Portability section."
  echo "{\"additionalContext\":\"$SWITCH_NOTE\"}"
elif [[ "$LOCAL_TS" -gt "$COMMITTED_TS" ]]; then
  # Local is newer — copy to committed (normal case)
  cp "$LOCAL_MEMORY"/*.md "$COMMITTED_MEMORY/" 2>/dev/null || true
  echo '{"additionalContext":"Local memory is current (synced to committed)"}'
else
  echo '{"additionalContext":"Memory is in sync"}'
fi
