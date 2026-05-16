# bootstrap.ps1 — one-command setup after cloning career-ops (Windows)
#
# Idempotent: safe to re-run. Skips steps that are already done.
#
# Usage (in PowerShell):
#   .\bootstrap.ps1
#
# If PowerShell blocks execution, run once:
#   Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

function Write-Ok($msg)   { Write-Host "✓ $msg" -ForegroundColor Green }
function Write-Warn2($msg) { Write-Host "! $msg" -ForegroundColor Yellow }
function Write-Err2($msg)  { Write-Host "✗ $msg" -ForegroundColor Red }
function Write-Note($msg) { Write-Host "  → $msg" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "career-ops bootstrap"
Write-Host "===================="
Write-Host ""

# ── Step 1: Node.js ───────────────────────────────────────────────────────
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Err2 "Node.js is not installed"
    Write-Note "Install Node 18+ from https://nodejs.org, then re-run this script."
    exit 1
}

$nodeVersion = (& node --version) -replace '^v', ''
$nodeMajor = [int]($nodeVersion -split '\.')[0]
if ($nodeMajor -lt 18) {
    Write-Err2 "Node v$nodeVersion — need 18 or later"
    Write-Note "Upgrade Node from https://nodejs.org, then re-run this script."
    exit 1
}
Write-Ok "Node v$nodeVersion"

# ── Step 2: npm install ───────────────────────────────────────────────────
$bootstrapMarker = "node_modules\.bootstrap-complete"
if ((Test-Path "node_modules") -and (Test-Path $bootstrapMarker)) {
    Write-Ok "Dependencies already installed (delete $bootstrapMarker to reinstall)"
} else {
    Write-Host "Installing dependencies (this takes 1-3 minutes)..."
    try {
        & npm install --silent 2>&1 | Select-Object -Last 3
        New-Item -ItemType File -Path $bootstrapMarker -Force | Out-Null
        Write-Ok "Dependencies installed"
    } catch {
        Write-Err2 "npm install failed"
        Write-Note "Check the error above. Common causes: no internet, permission issues. Try: Remove-Item -Recurse -Force node_modules; .\bootstrap.ps1"
        exit 1
    }
}

# ── Step 3: Playwright browser ────────────────────────────────────────────
$playwrightCheck = node -e "import('playwright').then(p => { const x = p.chromium.executablePath(); require('fs').accessSync(x); console.log('ok'); }).catch(() => process.exit(1))" 2>$null
if ($LASTEXITCODE -eq 0) {
    Write-Ok "Playwright chromium installed"
} else {
    Write-Host "Installing Playwright chromium (this takes 1-2 minutes)..."
    & npx playwright install chromium 2>&1 | Select-Object -Last 3
    if ($LASTEXITCODE -eq 0) {
        Write-Ok "Playwright chromium installed"
    } else {
        Write-Warn2 "Playwright install failed — PDF generation won't work, but everything else will"
        Write-Note "Try again later: npx playwright install chromium"
    }
}

# ── Step 4: Seed template files ───────────────────────────────────────────
function Seed-IfMissing($src, $dst) {
    if (Test-Path $dst) {
        Write-Ok "Already exists: $dst"
    } elseif (Test-Path $src) {
        Copy-Item $src $dst
        Write-Ok "Seeded: $dst (from $src)"
    } else {
        Write-Warn2 "Source missing: $src — cannot seed $dst"
    }
}

Seed-IfMissing "cv.example.md" "cv.md"
Seed-IfMissing "config\profile.example.yml" "config\profile.yml"
Seed-IfMissing "modes\_profile.template.md" "modes\_profile.md"
Seed-IfMissing "templates\portals.example.yml" "portals.yml"

# ── Step 5: Runtime directories ───────────────────────────────────────────
$dirs = @("data", "output", "reports", "batch\logs", "batch\tracker-additions", "jds", "context", "interview-prep")
foreach ($d in $dirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Write-Ok "Created: $d\"
    }
}

# ── Step 6: Tracker stub ─────────────────────────────────────────────────
$trackerPath = "data\applications.md"
if (-not (Test-Path $trackerPath)) {
    @"
# Applications Tracker

| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
|---|------|---------|------|-------|--------|-----|--------|-------|
"@ | Out-File -FilePath $trackerPath -Encoding utf8
    Write-Ok "Created: $trackerPath (empty tracker)"
}

# ── Step 7: Doctor ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "Running doctor..."
Write-Host ""
& node doctor.mjs
if ($LASTEXITCODE -ne 0) {
    Write-Warn2 "doctor reported issues — see above"
}

# ── Step 8: Next steps ───────────────────────────────────────────────────
Write-Host ""
Write-Host @"
Bootstrap complete.

You are NOT done yet — personalization is the next step. Two options:

  Option A (recommended): open Claude Code in this folder and say:
      "I'm new to career-ops. I'm a [your field] targeting [your roles].
       Walk me through setup using AGENTS.md."
    Claude Code will fill in cv.md, profile.yml, _profile.md, portals.yml
    with content appropriate to your field.

  Option B: edit the files manually:
      cv.md                       your full CV
      config\profile.yml          name, email, target roles, comp range
      modes\_profile.md           your archetypes, narrative, deal-breakers
      portals.yml                 companies and keywords to scan
    Then run `npm run doctor` to verify.

To start career-ops:
  claude       # opens Claude Code in this folder
  /career-ops  # shows all available commands

Discord: https://discord.gg/8pRpHETxa4
"@
