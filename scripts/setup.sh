#!/usr/bin/env bash
# Jarble developer environment setup
# Usage: bash scripts/setup.sh
# Run after cloning on a new machine to restore Claude Code context and install dependencies.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
echo "=== Jarble Developer Setup ==="
echo "Repo: $REPO_ROOT"

# --- Platform detection ---
PLATFORM="unknown"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  Darwin*)              PLATFORM="mac" ;;
  Linux*)               PLATFORM="linux" ;;
esac
echo "Platform: $PLATFORM"

# --- Restore Claude Code memory ---
COMMITTED_MEMORY="$REPO_ROOT/.claude/memory"
if [[ -d "$COMMITTED_MEMORY" ]]; then
  # Find or create local memory directory
  LOCAL_MEMORY=""
  PROJECTS_DIR="$HOME/.claude/projects"

  if [[ -d "$PROJECTS_DIR" ]]; then
    repo_name="$(basename "$REPO_ROOT")"
    for dir in "$PROJECTS_DIR"/*/; do
      if [[ "$(basename "$dir")" == *"$repo_name"* ]] && [[ -d "${dir}memory" ]]; then
        LOCAL_MEMORY="${dir}memory"
        break
      fi
    done
  fi

  if [[ -z "$LOCAL_MEMORY" ]]; then
    # Create a basic local memory directory
    LOCAL_MEMORY="$PROJECTS_DIR/$(basename "$REPO_ROOT")/memory"
    mkdir -p "$LOCAL_MEMORY"
    echo "Created local memory directory: $LOCAL_MEMORY"
  fi

  # Copy committed memory → local
  file_count=$(ls -1 "$COMMITTED_MEMORY"/*.md 2>/dev/null | wc -l)
  cp "$COMMITTED_MEMORY"/*.md "$LOCAL_MEMORY/" 2>/dev/null || true
  echo "Restored $file_count memory files to local Claude storage"
else
  echo "No committed memory found — skipping memory restore"
fi

# --- Install Claude Code skills ---
if command -v claude &>/dev/null; then
  if [[ -f "$REPO_ROOT/skills-lock.json" ]]; then
    echo "Installing Claude Code skills from skills-lock.json..."
    skill_count=$(grep -c '"name"' "$REPO_ROOT/skills-lock.json" 2>/dev/null || echo "0")
    echo "  ($skill_count skills tracked — install via 'claude skills install' if needed)"
  fi
else
  echo "Claude CLI not found — skip skill installation (install from claude.ai/code)"
fi

# --- Install npm dependencies ---
echo ""
echo "Installing npm dependencies..."

for pkg_dir in "Jarble-mvp" "jarble-api-main"; do
  if [[ -f "$REPO_ROOT/$pkg_dir/package.json" ]]; then
    echo "  $pkg_dir..."
    (cd "$REPO_ROOT/$pkg_dir" && npm install --silent 2>&1 | tail -1) || echo "  ⚠ $pkg_dir install had warnings"
  fi
done

# --- Summary ---
echo ""
echo "=== Setup Complete ==="
echo "Branch: $(cd "$REPO_ROOT" && git branch --show-current)"

if [[ -f "$COMMITTED_MEMORY/MEMORY.md" ]]; then
  echo ""
  echo "Latest memory summary:"
  head -5 "$COMMITTED_MEMORY/MEMORY.md" | sed 's/^/  /'
fi

echo ""
echo "Next steps:"
echo "  1. Copy .env files (API: jarble-api-main/.env, Frontend: Jarble-mvp/.env.local)"
echo "  2. Start API:      cd jarble-api-main && npm run dev"
echo "  3. Start Frontend: cd Jarble-mvp && npm run dev"
echo "  4. See CLAUDE.md for full reference"
