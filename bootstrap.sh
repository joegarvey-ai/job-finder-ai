#!/usr/bin/env bash
# bootstrap.sh — one-command setup after cloning career-ops (job-finder-ai)
#
# Idempotent: safe to re-run. Skips steps that are already done.
#
# Usage:
#   bash bootstrap.sh
#
# This script is designed to be driven either by a human at the terminal
# or by Claude Code itself (e.g., after the user says "set me up").
# It does NOT prompt for personal data — that part is the AI agent's job
# via the onboarding flow defined in AGENTS.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

# ── Pretty output helpers ──────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[32m'; YELLOW='\033[33m'; RED='\033[31m'; DIM='\033[2m'; NC='\033[0m'
else
  GREEN=''; YELLOW=''; RED=''; DIM=''; NC=''
fi

ok()   { printf "${GREEN}✓${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}!${NC} %s\n" "$1"; }
err()  { printf "${RED}✗${NC} %s\n" "$1"; }
note() { printf "${DIM}  → %s${NC}\n" "$1"; }

echo
echo "career-ops bootstrap"
echo "===================="
echo

# ── Step 1: Node.js ────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is not installed"
  note "Install Node 18+ from https://nodejs.org, then re-run this script."
  exit 1
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [ "$NODE_MAJOR" -lt 18 ]; then
  err "Node $(node --version) — need 18 or later"
  note "Upgrade Node from https://nodejs.org, then re-run this script."
  exit 1
fi
ok "Node $(node --version)"

# ── Step 2: npm install ────────────────────────────────────────────────────
if [ -d node_modules ] && [ -f node_modules/.bootstrap-complete ]; then
  ok "Dependencies already installed (delete node_modules/.bootstrap-complete to reinstall)"
else
  echo "Installing dependencies (this takes 1-3 minutes)..."
  if npm install --silent 2>&1 | tail -3; then
    touch node_modules/.bootstrap-complete
    ok "Dependencies installed"
  else
    err "npm install failed"
    note "Check the error above. Common causes: no internet, permission issues, or corrupted node_modules/. Try: rm -rf node_modules && bash bootstrap.sh"
    exit 1
  fi
fi

# ── Step 3: Playwright browser ─────────────────────────────────────────────
if node -e "import('playwright').then(p => { const x = p.chromium.executablePath(); require('fs').accessSync(x); })" 2>/dev/null; then
  ok "Playwright chromium installed"
else
  echo "Installing Playwright chromium (this takes 1-2 minutes)..."
  if npx playwright install chromium 2>&1 | tail -3; then
    ok "Playwright chromium installed"
  else
    warn "Playwright install failed — PDF generation won't work, but everything else will"
    note "Try again later: npx playwright install chromium"
  fi
fi

# ── Step 4: Seed template files (idempotent — only copies if missing) ─────
seed_if_missing() {
  local src="$1" dst="$2"
  if [ -f "$dst" ]; then
    ok "Already exists: $dst"
  elif [ -f "$src" ]; then
    cp "$src" "$dst"
    ok "Seeded: $dst (from $src)"
  else
    warn "Source missing: $src — cannot seed $dst"
  fi
}

# cv.md, profile.yml, portals.yml, and modes/_profile.md are seeded from
# templates so the AI agent has a starting point to customize. Onboarding
# (per AGENTS.md First Run) replaces the placeholder content with real
# values pulled from the user's CV and stated field.
seed_if_missing "cv.example.md" "cv.md"
seed_if_missing "config/profile.example.yml" "config/profile.yml"
seed_if_missing "modes/_profile.template.md" "modes/_profile.md"
seed_if_missing "templates/portals.example.yml" "portals.yml"

# ── Step 5: Ensure runtime directories exist ──────────────────────────────
for dir in data output reports batch/logs batch/tracker-additions jds context interview-prep; do
  if [ ! -d "$dir" ]; then
    mkdir -p "$dir"
    ok "Created: $dir/"
  fi
done

# ── Step 6: Tracker stub ──────────────────────────────────────────────────
if [ ! -f "data/applications.md" ]; then
  cat > data/applications.md <<'EOF'
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
EOF
  ok "Created: data/applications.md (empty tracker)"
fi

# ── Step 7: Run doctor for the final verification ─────────────────────────
echo
echo "Running doctor..."
echo
if node doctor.mjs; then
  echo
else
  warn "doctor reported issues — see above"
fi

# ── Step 8: Next-step message ─────────────────────────────────────────────
cat <<'EOF'

Bootstrap complete.

You are NOT done yet — personalization is the next step. Two options:

  Option A (recommended): open Claude Code in this folder and say:
      "I'm new to career-ops. I'm a [your field] targeting [your roles].
       Walk me through setup using AGENTS.md."
    Claude Code will fill in cv.md, profile.yml, _profile.md, portals.yml
    with content appropriate to your field.

  Option B: edit the files manually:
      cv.md                       your full CV
      config/profile.yml          name, email, target roles, comp range
      modes/_profile.md           your archetypes, narrative, deal-breakers
      portals.yml                 companies and keywords to scan
    Then run `npm run doctor` to verify.

To start career-ops:
  claude       # opens Claude Code in this folder
  /career-ops  # shows all available commands

Discord: https://discord.gg/8pRpHETxa4
EOF
