#!/usr/bin/env bash
# start-career-ops.command — double-clickable launcher for macOS
#
# Double-click this file in Finder. macOS will open Terminal, cd into this
# repo's folder, and start Claude Code with career-ops loaded.
#
# First-time setup: right-click → Open → Open anyway (Gatekeeper may flag
# it the first time because it's unsigned). After that, double-click works.

# Resolve this script's directory (handles spaces and symlinks)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

clear
echo "career-ops"
echo "=========="
echo "Folder: $SCRIPT_DIR"
echo

if ! command -v claude >/dev/null 2>&1; then
  echo "Claude Code is not installed (no 'claude' command found on PATH)."
  echo
  echo "Install it from: https://docs.claude.com/claude-code"
  echo "macOS quick install: curl -fsSL https://claude.ai/install.sh | bash"
  echo
  echo "After install, close and re-open this launcher."
  echo
  read -p "Press Enter to close..."
  exit 1
fi

if [ ! -f cv.md ] || [ ! -f config/profile.yml ]; then
  echo "Looks like this is your first session (cv.md or profile.yml missing)."
  echo "Running setup first..."
  echo
  bash bootstrap.sh
  echo
  echo "Now launching Claude Code. When it opens, say:"
  echo "  'I'm new to career-ops. Walk me through setup using AGENTS.md.'"
  echo
  read -p "Press Enter to continue..."
fi

exec claude
