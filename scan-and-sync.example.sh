#!/usr/bin/env bash
# scan-and-sync.example.sh — recurring scan template for career-ops
#
# Runs the deterministic scrapers and the LLM-powered portals.yml scan,
# writes new roles to data/pipeline.md and the daily digest. Designed for
# cron / launchd / Task Scheduler — no interactive prompts.
#
# Setup:
#   1. Copy this file to scan-and-sync.sh and make it executable:
#        cp scan-and-sync.example.sh scan-and-sync.sh
#        chmod +x scan-and-sync.sh
#   2. Edit CAREER_OPS_DIR below to point at your clone of this repo.
#   3. (macOS / Linux) Test by running it once manually:
#        ./scan-and-sync.sh
#   4. Schedule it. See docs/SETUP-FOR-BEGINNERS.md for cron / launchd setup.
#
# If you have Claude Code's /schedule skill installed, you can skip this
# script entirely and just run `/schedule daily 10am /career-ops scan`
# inside Claude Code. That's the easier path for non-technical users.

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────
# Replace with the absolute path to your job-finder-ai clone.
CAREER_OPS_DIR="$HOME/Projects/job-finder-ai"

# Optional: keep a rolling log here so you can see what happened.
LOG_FILE="$CAREER_OPS_DIR/data/scan-and-sync.log"

# ── Helpers ───────────────────────────────────────────────────────────────
log() {
  mkdir -p "$(dirname "$LOG_FILE")"
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" >> "$LOG_FILE"
}

# ── Pre-flight ────────────────────────────────────────────────────────────
if [ ! -d "$CAREER_OPS_DIR" ]; then
  echo "CAREER_OPS_DIR does not exist: $CAREER_OPS_DIR" >&2
  echo "Edit this script and set CAREER_OPS_DIR to your clone path." >&2
  exit 2
fi

cd "$CAREER_OPS_DIR"
log "=== scan-and-sync started ==="

# ── Step 1: Custom scrapers (Greenhouse/Lever/JSearch/Wellfound/remote) ──
# No LLM cost. Fast. Writes to data/pipeline.md and data/new_roles_<date>.md.
log "Running scan-all.mjs..."
node scan-all.mjs >> "$CAREER_OPS_DIR/data/last-scan-all-output.txt" 2>&1 || {
  log "WARN: scan-all.mjs had errors (exit $?). Continuing."
}

# ── Step 2: LLM-powered scan over portals.yml tracked companies ──────────
# Uses Claude Code in headless mode. Requires `claude` on PATH.
if command -v claude >/dev/null 2>&1; then
  log "Running claude -p /career-ops scan..."
  claude -p "/career-ops scan" \
    --allowedTools 'Read,Write,Edit,Glob,Grep,Bash,WebSearch,WebFetch' \
    >> "$CAREER_OPS_DIR/data/last-scan-output.txt" 2>&1 || {
      log "WARN: claude scan failed (exit $?). See data/last-scan-output.txt."
    }
else
  log "INFO: claude CLI not found on PATH. Skipping LLM scan."
fi

# ── (Optional) Step 3: Obsidian publishing ───────────────────────────────
# Uncomment if you use Obsidian sync and have OBSIDIAN_VAULT_PATH set in .env.
# log "Running score-and-publish.mjs..."
# node score-and-publish.mjs >> "$CAREER_OPS_DIR/data/last-publish-output.txt" 2>&1 || {
#   log "WARN: score-and-publish.mjs failed (exit $?)."
# }

log "=== scan-and-sync complete ==="
echo "scan-and-sync complete. New roles in data/new_roles_$(date +%Y-%m-%d).md (if any)."
