# scan-and-sync.example.ps1 — recurring scan template for career-ops (Windows)
#
# PowerShell equivalent of scan-and-sync.example.sh. Designed to be triggered
# from Windows Task Scheduler on a schedule (daily, every 3 days, etc.).
#
# Setup:
#   1. Copy this file to scan-and-sync.ps1 (the .ps1 stays gitignored).
#   2. Edit $CareerOpsDir below to point at your clone of this repo.
#   3. Test by running it once manually in PowerShell:
#        .\scan-and-sync.ps1
#   4. Schedule it via Task Scheduler — see docs/SETUP-FOR-BEGINNERS.md.
#
# If you have Claude Code's /schedule skill, you can skip this script entirely
# and just run `/schedule daily 10am /career-ops scan` inside Claude Code.

$ErrorActionPreference = 'Stop'

# ── Configuration ─────────────────────────────────────────────────────────
$CareerOpsDir = "$env:USERPROFILE\Projects\job-finder-ai"
$LogFile = Join-Path $CareerOpsDir "data\scan-and-sync.log"

function Write-Log {
    param([string]$Message)
    $logDir = Split-Path $LogFile -Parent
    if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    "[$timestamp] $Message" | Out-File -FilePath $LogFile -Append -Encoding utf8
}

# ── Pre-flight ────────────────────────────────────────────────────────────
if (-not (Test-Path $CareerOpsDir)) {
    Write-Error "CareerOpsDir does not exist: $CareerOpsDir. Edit this script and set the correct path."
    exit 2
}

Set-Location $CareerOpsDir
Write-Log "=== scan-and-sync started ==="

# ── Step 1: Custom scrapers ──────────────────────────────────────────────
Write-Log "Running scan-all.mjs..."
$scanOut = Join-Path $CareerOpsDir "data\last-scan-all-output.txt"
& node scan-all.mjs *>&1 | Out-File -FilePath $scanOut -Encoding utf8
if ($LASTEXITCODE -ne 0) {
    Write-Log "WARN: scan-all.mjs had errors (exit $LASTEXITCODE). Continuing."
}

# ── Step 2: LLM-powered scan ──────────────────────────────────────────────
if (Get-Command claude -ErrorAction SilentlyContinue) {
    Write-Log "Running claude -p /career-ops scan..."
    $claudeOut = Join-Path $CareerOpsDir "data\last-scan-output.txt"
    & claude -p "/career-ops scan" --allowedTools 'Read,Write,Edit,Glob,Grep,Bash,WebSearch,WebFetch' *>&1 |
        Out-File -FilePath $claudeOut -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
        Write-Log "WARN: claude scan failed (exit $LASTEXITCODE)."
    }
} else {
    Write-Log "INFO: claude CLI not found on PATH. Skipping LLM scan."
}

Write-Log "=== scan-and-sync complete ==="
$today = Get-Date -Format "yyyy-MM-dd"
Write-Host "scan-and-sync complete. New roles in data/new_roles_$today.md (if any)."
